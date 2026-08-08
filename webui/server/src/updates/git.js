import { repoRoot } from '../config/paths.js'
import { failedDependency } from '../lib/errors.js'
import { run } from '../lib/exec.js'

/**
 * ASCII unit separator. git's `%x1f` emits this byte, and it cannot appear in
 * a commit subject — unlike any printable delimiter, which eventually would.
 */
const FIELD = String.fromCharCode(0x1f)

async function git(args, opts = {}) {
  return run('git', ['-C', repoRoot, ...args], { allowFailure: true, ...opts })
}

/**
 * What separates the working tree from its upstream branch.
 *
 * `dirty` matters: the box is where the user hacks on the scripts, so a
 * `git pull` that would stash or conflict must be refused with a clear reason
 * rather than attempted.
 */
export async function updateStatus({ fetch = false } = {}) {
  const upstream = await git(['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{u}'])
  if (upstream.code !== 0) {
    throw failedDependency(
      'Der aktuelle Branch hat keinen Upstream. Setze ihn mit: git branch --set-upstream-to=origin/main',
    )
  }
  const tracking = upstream.stdout.trim()
  const [remote] = tracking.split('/')

  if (fetch) {
    const result = await git(['fetch', '--quiet', remote], { timeoutMs: 120_000 })
    if (result.code !== 0) {
      throw failedDependency(
        `git fetch schlug fehl: ${(result.stderr || result.stdout).trim().split('\n').slice(-1)[0]}`,
      )
    }
  }

  const counts = await git(['rev-list', '--left-right', '--count', `HEAD...${tracking}`])
  const [ahead, behind] = counts.stdout.trim().split(/\s+/).map(Number)

  const status = await git(['status', '--porcelain'])
  const dirtyFiles = status.stdout
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)

  const logResult = await git([
    'log',
    `--pretty=format:%H${FIELD}%h${FIELD}%an${FIELD}%aI${FIELD}%s`,
    `HEAD..${tracking}`,
  ])
  const commits = logResult.stdout
    .split('\n')
    .filter(Boolean)
    .map((line) => {
      const [sha, shortSha, author, date, subject] = line.split(FIELD)
      return { sha, shortSha, author, date, subject }
    })

  // Knowing what changed lets the updater skip npm ci and the frontend build
  // when nothing under webui/ moved — most updates then take a second.
  const changed = await git(['diff', '--name-only', `HEAD..${tracking}`])
  const changedFiles = changed.stdout.split('\n').filter(Boolean)
  const needsInstall = changedFiles.some((f) => f === 'webui/package-lock.json' || f === 'webui/package.json')
  const needsBuild = changedFiles.some((f) => f.startsWith('webui/web/') || f.startsWith('webui/shared/'))

  return {
    branch: tracking,
    remote,
    ahead: Number.isFinite(ahead) ? ahead : 0,
    behind: Number.isFinite(behind) ? behind : 0,
    dirty: dirtyFiles.length > 0,
    dirtyFiles: dirtyFiles.slice(0, 20),
    commits,
    needsInstall,
    needsBuild,
    changedFiles: changedFiles.slice(0, 100),
    canUpdate: dirtyFiles.length === 0 && Number.isFinite(behind) && behind > 0,
  }
}
