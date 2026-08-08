import { useEffect, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { get, post } from '../api/client.js'
import { JobProgress } from '../components/JobProgress.jsx'
import { PageHead } from '../components/Layout.jsx'
import { useToast } from '../components/Toast.jsx'
import { formatDate } from '../components/format.js'

export function Updates() {
  const toast = useToast()
  const queryClient = useQueryClient()
  const [jobId, setJobId] = useState(null)
  const [restarting, setRestarting] = useState(false)

  const status = useQuery({ queryKey: ['update-status'], queryFn: () => get('/updates/app') })
  const version = useQuery({ queryKey: ['version'], queryFn: () => get('/version') })

  const check = useMutation({
    mutationFn: () => post('/updates/app/check'),
    onSuccess: (data) => {
      queryClient.setQueryData(['update-status'], (old) => ({ ...old, ...data }))
      toast.success(data.behind > 0 ? `${data.behind} neue Commits gefunden.` : 'Alles aktuell.')
    },
    onError: (err) => toast.error(err),
  })

  const apply = useMutation({
    mutationFn: () => post('/updates/app/apply'),
    onSuccess: (data) => {
      setJobId(data.jobId)
      setRestarting(true)
    },
    onError: (err) => toast.error(err),
  })

  // While the update runs, the service restarts under us. Poll /version until
  // the SHA changes, then reload — the asset hashes changed too, so a soft
  // refresh would leave the old bundle in place.
  useEffect(() => {
    if (!restarting) return undefined
    const before = version.data?.sha
    const timer = setInterval(async () => {
      try {
        const fresh = await get('/version')
        if (before && fresh.sha && fresh.sha !== before) {
          clearInterval(timer)
          window.location.reload()
        }
      } catch {
        // The service is down mid-restart; keep polling.
      }
    }, 3000)
    return () => clearInterval(timer)
  }, [restarting, version.data?.sha])

  const s = status.data

  return (
    <>
      <PageHead
        title="Updates"
        description="Neue Commits im Repository anzeigen und die Anwendung aktualisieren."
      >
        <button className="btn" type="button" onClick={() => check.mutate()} disabled={check.isPending}>
          {check.isPending ? 'Prüft …' : 'Auf Updates prüfen'}
        </button>
      </PageHead>

      {status.isError ? <div className="alert alert-danger">{status.error.message}</div> : null}

      <section className="card stack-sm">
        <div className="card-head">
          <h2>Aktueller Stand</h2>
          {s?.behind > 0 ? (
            <span className="badge badge-info">{s.behind} Commits zurück</span>
          ) : s ? (
            <span className="badge badge-ok">aktuell</span>
          ) : null}
        </div>
        <dl className="kv">
          <dt>Commit</dt>
          <dd>{version.data?.shortSha ?? '–'}</dd>
          <dt>Branch</dt>
          <dd>{s?.branch ?? version.data?.branch ?? '–'}</dd>
          <dt>Zuletzt geprüft</dt>
          <dd>{s ? 'soeben' : '–'}</dd>
        </dl>
      </section>

      {s?.dirty ? (
        <div className="alert alert-warn">
          <strong>Das Repository hat lokale Änderungen.</strong> Ein Update wird deshalb
          abgelehnt — sonst gingen deine Anpassungen verloren.
          <ul className="small mono">
            {s.dirtyFiles.map((f) => (
              <li key={f}>{f}</li>
            ))}
          </ul>
        </div>
      ) : null}

      {s?.commits?.length ? (
        <section className="card">
          <div className="card-head">
            <h2>Neue Commits</h2>
            {s.canUpdate ? (
              <button
                className="btn btn-primary"
                type="button"
                onClick={() => apply.mutate()}
                disabled={apply.isPending || restarting}
              >
                {restarting ? 'Update läuft …' : 'Update anwenden'}
              </button>
            ) : null}
          </div>

          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Commit</th>
                  <th>Beschreibung</th>
                  <th>Autor</th>
                  <th>Datum</th>
                </tr>
              </thead>
              <tbody>
                {s.commits.map((commit) => (
                  <tr key={commit.sha}>
                    <td className="mono small">{commit.shortSha}</td>
                    <td>{commit.subject}</td>
                    <td className="small faint nowrap">{commit.author}</td>
                    <td className="small faint nowrap">{formatDate(commit.date)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {s.needsInstall || s.needsBuild ? (
            <p className="small faint" style={{ marginTop: 'var(--space-3)' }}>
              Dieses Update erfordert{' '}
              {[s.needsInstall && 'npm ci', s.needsBuild && 'einen Frontend-Build']
                .filter(Boolean)
                .join(' und ')}
              . Der Dienst startet anschließend neu.
            </p>
          ) : (
            <p className="small faint" style={{ marginTop: 'var(--space-3)' }}>
              Keine Abhängigkeiten oder Frontend-Dateien geändert — das Update geht schnell.
            </p>
          )}
        </section>
      ) : s && !s.dirty ? (
        <div className="empty">Keine neuen Commits.</div>
      ) : null}

      {jobId ? (
        <section className="card">
          <h2>Update-Fortschritt</h2>
          <p className="small muted">
            Der Dienst startet gleich neu. Die Seite lädt automatisch neu, sobald er wieder
            antwortet.
          </p>
          <JobProgress jobId={jobId} />
        </section>
      ) : null}

      {s?.lastLog ? (
        <section className="card stack-sm">
          <div className="card-head">
            <h2>Letztes Update</h2>
            <span
              className={`badge ${s.lastLog.failed ? 'badge-danger' : s.lastLog.succeeded ? 'badge-ok' : ''}`}
            >
              {s.lastLog.failed ? 'fehlgeschlagen' : s.lastLog.succeeded ? 'erfolgreich' : 'unklar'}
            </span>
          </div>
          <span className="small faint">{formatDate(s.lastLog.at)}</span>
          <pre className="logbox" style={{ height: 200 }}>
            {s.lastLog.lines.join('\n')}
          </pre>
        </section>
      ) : null}
    </>
  )
}
