import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link } from 'react-router-dom'

import { del, get, post } from '../api/client.js'
import { PageHead } from '../components/Layout.jsx'
import { ConfirmDialog } from '../components/Modal.jsx'
import { useToast } from '../components/Toast.jsx'
import { formatDate, shortImage } from '../components/format.js'
import { StartServerDialog } from './StartServerDialog.jsx'

export function Servers() {
  const toast = useToast()
  const queryClient = useQueryClient()
  const [starting, setStarting] = useState(false)
  const [pendingDelete, setPendingDelete] = useState(null)

  const servers = useQuery({
    queryKey: ['servers'],
    queryFn: () => get('/servers'),
    refetchInterval: 5000,
  })

  const action = useMutation({
    mutationFn: ({ name, verb }) => post(`/servers/${encodeURIComponent(name)}/${verb}`),
    onSuccess: (_data, { name, verb }) => {
      const label = { start: 'gestartet', stop: 'gestoppt', restart: 'neu gestartet' }[verb]
      toast.success(`'${name}' ${label}.`)
      queryClient.invalidateQueries({ queryKey: ['servers'] })
    },
    onError: (err) => toast.error(err),
  })

  const remove = useMutation({
    mutationFn: (name) => del(`/servers/${encodeURIComponent(name)}`),
    onSuccess: (_data, name) => {
      toast.success(`'${name}' entfernt.`)
      setPendingDelete(null)
      queryClient.invalidateQueries({ queryKey: ['servers'] })
    },
    onError: (err) => toast.error(err),
  })

  const list = servers.data?.servers ?? []

  return (
    <>
      <PageHead
        title="Server"
        description="llama.cpp-Container, die über dieses Interface angelegt wurden."
      >
        <button className="btn btn-primary" type="button" onClick={() => setStarting(true)}>
          Server starten
        </button>
      </PageHead>

      {servers.isError ? (
        <div className="alert alert-danger">{servers.error.message}</div>
      ) : servers.isLoading ? (
        <div className="empty">Wird geladen …</div>
      ) : list.length === 0 ? (
        <div className="empty">
          Noch kein Server angelegt. Über „Server starten“ geht es los.
        </div>
      ) : (
        <div className="card table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Modell</th>
                <th>Image</th>
                <th>Port</th>
                <th>Angelegt</th>
                <th aria-label="Aktionen" />
              </tr>
            </thead>
            <tbody>
              {list.map((server) => (
                <tr key={server.name}>
                  <td>
                    <div className="row">
                      <span
                        className={`dot ${server.running ? 'dot-ok' : server.state === 'exited' ? 'dot-danger' : 'dot-warn'}`}
                        title={server.status}
                      />
                      <Link to={`/servers/${encodeURIComponent(server.name)}`}>{server.name}</Link>
                    </div>
                    <span className="small faint">{server.status}</span>
                  </td>
                  <td className="small mono" style={{ maxWidth: 280 }}>
                    <span className="truncate" title={server.modelPath} style={{ display: 'block' }}>
                      {server.modelPath ?? '–'}
                    </span>
                  </td>
                  <td className="small">{shortImage(server.image)}</td>
                  <td className="small mono">{server.hostPort ?? '–'}</td>
                  <td className="small faint nowrap">{formatDate(server.createdAt)}</td>
                  <td>
                    <div className="row wrap" style={{ justifyContent: 'flex-end' }}>
                      {server.running ? (
                        <button
                          type="button"
                          className="btn btn-sm"
                          disabled={action.isPending}
                          onClick={() => action.mutate({ name: server.name, verb: 'stop' })}
                        >
                          Stoppen
                        </button>
                      ) : (
                        <button
                          type="button"
                          className="btn btn-sm"
                          disabled={action.isPending}
                          onClick={() => action.mutate({ name: server.name, verb: 'start' })}
                        >
                          Starten
                        </button>
                      )}
                      <button
                        type="button"
                        className="btn btn-sm btn-danger"
                        onClick={() => setPendingDelete(server.name)}
                      >
                        Entfernen
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {starting ? <StartServerDialog onClose={() => setStarting(false)} /> : null}

      {pendingDelete ? (
        <ConfirmDialog
          title="Server entfernen"
          danger
          confirmLabel="Entfernen"
          busy={remove.isPending}
          message={
            <>
              <p>
                Container <code>{pendingDelete}</code> wird gestoppt und gelöscht. Das Modell auf
                der Platte bleibt unangetastet.
              </p>
            </>
          }
          onConfirm={() => remove.mutate(pendingDelete)}
          onClose={() => setPendingDelete(null)}
        />
      ) : null}
    </>
  )
}
