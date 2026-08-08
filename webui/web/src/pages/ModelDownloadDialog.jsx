import { useMemo, useState } from 'react'
import { useMutation, useQuery } from '@tanstack/react-query'

import { get, post, qs } from '../api/client.js'
import { JobProgress } from '../components/JobProgress.jsx'
import { Modal } from '../components/Modal.jsx'
import { useToast } from '../components/Toast.jsx'
import { formatBytes, formatNumber } from '../components/format.js'

/**
 * Find a repository on Hugging Face, pick quantisations, download.
 *
 * Files are grouped by folder because that is how these repos are laid out —
 * one directory per quantisation — and picking any shard selects the whole set,
 * since a partial set cannot be loaded.
 */
export function ModelDownloadDialog({ onClose }) {
  const toast = useToast()
  const [query, setQuery] = useState('')
  const [submitted, setSubmitted] = useState('')
  const [repo, setRepo] = useState(null)
  const [selected, setSelected] = useState(new Set())
  const [jobId, setJobId] = useState(null)

  const search = useQuery({
    queryKey: ['hf-search', submitted],
    queryFn: () => get(`/models/hf/search${qs({ q: submitted })}`),
    enabled: submitted.length > 0,
    retry: false,
  })

  const files = useQuery({
    queryKey: ['hf-files', repo],
    queryFn: () => get(`/models/hf/files${qs({ repo })}`),
    enabled: Boolean(repo),
    retry: false,
  })

  const folders = useMemo(() => {
    const map = new Map()
    for (const file of files.data?.files ?? []) {
      const key = file.dir || '(Wurzel)'
      const group = map.get(key) ?? { dir: key, files: [], totalBytes: 0 }
      group.files.push(file)
      group.totalBytes += file.size
      map.set(key, group)
    }
    return [...map.values()].sort((a, b) => a.dir.localeCompare(b.dir))
  }, [files.data])

  const selectedBytes = useMemo(() => {
    let sum = 0
    for (const file of files.data?.files ?? []) if (selected.has(file.path)) sum += file.size
    return sum
  }, [files.data, selected])

  const start = useMutation({
    mutationFn: () => post('/models/downloads', { repo, include: [...selected] }),
    onSuccess: (data) => setJobId(data.jobId),
    onError: (err) => toast.error(err),
  })

  function toggleFolder(folder) {
    setSelected((prev) => {
      const next = new Set(prev)
      const allIn = folder.files.every((f) => next.has(f.path))
      for (const file of folder.files) {
        if (allIn) next.delete(file.path)
        else next.add(file.path)
      }
      return next
    })
  }

  if (jobId) {
    return (
      <Modal
        title="Modell wird geladen"
        onClose={onClose}
        footer={
          <button type="button" className="btn" onClick={onClose}>
            Schließen
          </button>
        }
      >
        <p className="small muted">
          Der Download läuft im Hintergrund weiter, auch wenn du dieses Fenster schließt.
        </p>
        <JobProgress
          jobId={jobId}
          onFinished={(job) => {
            if (job.status === 'done') toast.success('Download abgeschlossen.')
            if (job.status === 'failed') toast.error(job.error ?? 'Download fehlgeschlagen.')
          }}
        />
      </Modal>
    )
  }

  return (
    <Modal
      title="Modell herunterladen"
      wide
      onClose={onClose}
      footer={
        <>
          <span className="grow small faint">
            {selected.size > 0
              ? `${selected.size} Datei(en), ${formatBytes(selectedBytes)}`
              : 'Nichts ausgewählt'}
          </span>
          <button type="button" className="btn" onClick={onClose}>
            Abbrechen
          </button>
          <button
            type="button"
            className="btn btn-primary"
            disabled={selected.size === 0 || start.isPending}
            onClick={() => start.mutate()}
          >
            {start.isPending ? 'Startet …' : 'Herunterladen'}
          </button>
        </>
      }
    >
      <div className="stack">
        <form
          className="row"
          onSubmit={(e) => {
            e.preventDefault()
            setSubmitted(query.trim())
            setRepo(null)
            setSelected(new Set())
          }}
        >
          <input
            type="search"
            className="grow"
            placeholder="z. B. unsloth Qwen3 GGUF"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <button type="submit" className="btn" disabled={!query.trim()}>
            Suchen
          </button>
        </form>

        {search.isError ? <div className="alert alert-danger small">{search.error.message}</div> : null}

        {!repo && search.data ? (
          <div className="picker">
            {search.data.results.length === 0 ? (
              <div className="empty small">Kein Treffer.</div>
            ) : (
              search.data.results.map((r) => (
                <button
                  type="button"
                  key={r.id}
                  className="picker-item"
                  onClick={() => {
                    setRepo(r.id)
                    setSelected(new Set())
                  }}
                >
                  <span className="grow truncate">
                    <strong>{r.id}</strong>
                    {r.gated ? <span className="badge badge-warn" style={{ marginLeft: 8 }}>gated</span> : null}
                  </span>
                  <span className="small faint nowrap">
                    {formatNumber(r.downloads)} Downloads
                  </span>
                </button>
              ))
            )}
          </div>
        ) : null}

        {repo ? (
          <div className="stack-sm">
            <div className="row-between">
              <strong className="truncate">{repo}</strong>
              <button
                type="button"
                className="btn btn-sm btn-ghost"
                onClick={() => {
                  setRepo(null)
                  setSelected(new Set())
                }}
              >
                Anderes Repository
              </button>
            </div>

            {files.isLoading ? <div className="empty small">Dateien werden gelesen …</div> : null}
            {files.isError ? <div className="alert alert-danger small">{files.error.message}</div> : null}

            {files.data && folders.length === 0 ? (
              <div className="empty small">Dieses Repository enthält keine GGUF-Dateien.</div>
            ) : null}

            {folders.map((folder) => {
              const allIn = folder.files.every((f) => selected.has(f.path))
              const someIn = !allIn && folder.files.some((f) => selected.has(f.path))
              return (
                <label key={folder.dir} className={`picker-item${allIn ? ' selected' : ''}`}>
                  <input
                    type="checkbox"
                    style={{ width: 'auto', marginTop: 4 }}
                    checked={allIn}
                    ref={(el) => el && (el.indeterminate = someIn)}
                    onChange={() => toggleFolder(folder)}
                  />
                  <span className="grow truncate">
                    <strong>{folder.dir}</strong>
                    <br />
                    <span className="mono">
                      {folder.files.length} Datei(en)
                      {folder.files.length > 1 ? ' — mehrteiliges Modell' : ''}
                    </span>
                  </span>
                  <span className="small nowrap right">{formatBytes(folder.totalBytes)}</span>
                </label>
              )
            })}
          </div>
        ) : null}
      </div>
    </Modal>
  )
}
