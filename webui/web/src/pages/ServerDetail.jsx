import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, useNavigate, useParams } from 'react-router-dom'

import { del, get, post } from '../api/client.js'
import { PageHead } from '../components/Layout.jsx'
import { LogView } from '../components/LogView.jsx'
import { useToast } from '../components/Toast.jsx'
import { formatDate } from '../components/format.js'

export function ServerDetail() {
  const { name } = useParams()
  const toast = useToast()
  const navigate = useNavigate()
  const queryClient = useQueryClient()

  const key = ['server', name]
  const server = useQuery({
    queryKey: key,
    queryFn: () => get(`/servers/${encodeURIComponent(name)}`),
    refetchInterval: 5000,
  })

  const health = useQuery({
    queryKey: ['server-health', name],
    queryFn: () => get(`/servers/${encodeURIComponent(name)}/health`),
    refetchInterval: 10000,
    enabled: Boolean(server.data?.server?.running),
  })

  const action = useMutation({
    mutationFn: (verb) => post(`/servers/${encodeURIComponent(name)}/${verb}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: key })
      queryClient.invalidateQueries({ queryKey: ['servers'] })
    },
    onError: (err) => toast.error(err),
  })

  const remove = useMutation({
    mutationFn: () => del(`/servers/${encodeURIComponent(name)}`),
    onSuccess: () => {
      toast.success(`'${name}' entfernt.`)
      queryClient.invalidateQueries({ queryKey: ['servers'] })
      navigate('/servers')
    },
    onError: (err) => toast.error(err),
  })

  if (server.isError) {
    return (
      <>
        <PageHead title={name} />
        <div className="alert alert-danger">{server.error.message}</div>
        <Link to="/servers">Zurück zur Übersicht</Link>
      </>
    )
  }

  const s = server.data?.server

  return (
    <>
      <PageHead
        title={name}
        description={s ? `${s.image} — ${s.status}` : 'Wird geladen …'}
      >
        {s?.running ? (
          <button className="btn" type="button" onClick={() => action.mutate('stop')} disabled={action.isPending}>
            Stoppen
          </button>
        ) : (
          <button className="btn" type="button" onClick={() => action.mutate('start')} disabled={action.isPending}>
            Starten
          </button>
        )}
        <button className="btn" type="button" onClick={() => action.mutate('restart')} disabled={action.isPending}>
          Neu starten
        </button>
        <button className="btn btn-danger" type="button" onClick={() => remove.mutate()} disabled={remove.isPending}>
          Entfernen
        </button>
      </PageHead>

      {s ? (
        <div className="card-grid">
          <section className="card">
            <div className="card-head">
              <h2>Konfiguration</h2>
              <span className={`badge ${s.running ? 'badge-ok' : 'badge-warn'}`}>{s.state}</span>
            </div>
            <dl className="kv">
              <dt>Modell</dt>
              <dd>{s.modelPath ?? '–'}</dd>
              <dt>Image</dt>
              <dd>{s.image ?? '–'}</dd>
              <dt>Host-Port</dt>
              <dd>{s.hostPort ?? '–'} → 11434</dd>
              <dt>Context Size</dt>
              <dd>{s.ctxSize ?? '–'}</dd>
              <dt>GPU Layers</dt>
              <dd>{s.gpuLayers ?? '–'}</dd>
              <dt>Threads</dt>
              <dd>{s.threads ?? '–'}</dd>
              <dt>Zusatzargumente</dt>
              <dd>{s.extraArgs || '–'}</dd>
              <dt>Angelegt</dt>
              <dd>{formatDate(s.createdAt)}</dd>
              {s.exitCode !== null && s.exitCode !== undefined && !s.running ? (
                <>
                  <dt>Exit-Code</dt>
                  <dd>{s.exitCode}</dd>
                </>
              ) : null}
            </dl>
          </section>

          <section className="card">
            <div className="card-head">
              <h2>Erreichbarkeit</h2>
              {health.data ? (
                <span className={`badge ${health.data.reachable ? 'badge-ok' : 'badge-warn'}`}>
                  {health.data.reachable ? 'antwortet' : 'keine Antwort'}
                </span>
              ) : null}
            </div>
            {s.running ? (
              <dl className="kv">
                <dt>Endpunkt</dt>
                <dd>http://&lt;host&gt;:{s.hostPort}/v1</dd>
                <dt>Status</dt>
                <dd>{health.data?.status ?? health.data?.reason ?? 'wird geprüft …'}</dd>
              </dl>
            ) : (
              <p className="muted small">Der Container läuft nicht.</p>
            )}
          </section>

          {s.command ? (
            <section className="card" style={{ gridColumn: '1 / -1' }}>
              <div className="card-head">
                <h2>Aufruf im Container</h2>
                <span className="small faint">
                  Vergleichbar mit einem manuellen run-llama-server.sh-Start
                </span>
              </div>
              <pre className="logbox" style={{ height: 'auto', maxHeight: 200 }}>
                {s.command.join(' ')}
              </pre>
            </section>
          ) : null}
        </div>
      ) : null}

      <section className="card">
        <LogView name={name} />
      </section>
    </>
  )
}
