import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { del, get, post, qs } from '../api/client.js'
import { PageHead } from '../components/Layout.jsx'
import { ConfirmDialog } from '../components/Modal.jsx'
import { useToast } from '../components/Toast.jsx'
import { formatBytes, formatDate } from '../components/format.js'
import { ModelDownloadDialog } from './ModelDownloadDialog.jsx'
import { StartServerDialog } from './StartServerDialog.jsx'

export function Models() {
  const toast = useToast()
  const queryClient = useQueryClient()
  const [pendingDelete, setPendingDelete] = useState(null)
  const [startFrom, setStartFrom] = useState(null)
  const [downloading, setDownloading] = useState(false)

  const models = useQuery({ queryKey: ['models'], queryFn: () => get('/models') })

  const refresh = useMutation({
    mutationFn: () => post('/models/refresh'),
    onSuccess: (data) => {
      queryClient.setQueryData(['models'], data)
      toast.success('Modellverzeichnis neu eingelesen.')
    },
    onError: (err) => toast.error(err),
  })

  const remove = useMutation({
    mutationFn: ({ key, force }) => del(`/models${qs({ key, force: force ? '1' : '' })}`),
    onSuccess: (result) => {
      toast.success(`${result.deleted.length} Datei(en) gelöscht, ${formatBytes(result.freedBytes)} frei.`)
      setPendingDelete(null)
      queryClient.invalidateQueries({ queryKey: ['models'] })
      queryClient.invalidateQueries({ queryKey: ['servers'] })
    },
    onError: (err) => {
      if (err.code === 'conflict') {
        setPendingDelete((p) => (p ? { ...p, blockedBy: err.details?.servers ?? [], message: err.message } : p))
      } else {
        toast.error(err)
      }
    },
  })

  const data = models.data
  const groups = data?.groups ?? []

  return (
    <>
      <PageHead
        title="Modelle"
        description={data ? `GGUF-Dateien in ${data.modelsDir}` : 'GGUF-Dateien im Modellverzeichnis.'}
      >
        <button className="btn" type="button" onClick={() => refresh.mutate()} disabled={refresh.isPending}>
          {refresh.isPending ? 'Liest ein …' : 'Neu einlesen'}
        </button>
        <button className="btn btn-primary" type="button" onClick={() => setDownloading(true)}>
          Modell herunterladen
        </button>
      </PageHead>

      {data?.disk?.freeBytes != null ? (
        <p className="small faint">
          {formatBytes(data.disk.freeBytes)} von {formatBytes(data.disk.totalBytes)} frei ·{' '}
          {groups.length} Modell(e), zusammen{' '}
          {formatBytes(groups.reduce((sum, g) => sum + g.totalBytes, 0))}
        </p>
      ) : null}

      {data?.unreadable ? (
        <div className="alert alert-danger">
          Das Modellverzeichnis ist nicht lesbar: {data.unreadable}
        </div>
      ) : null}

      {data?.partials?.length ? (
        <div className="alert alert-info small">
          {data.partials.length} unvollständige Datei(en) im Verzeichnis — vermutlich ein
          laufender oder abgebrochener Download.
        </div>
      ) : null}

      {models.isError ? (
        <div className="alert alert-danger">{models.error.message}</div>
      ) : models.isLoading ? (
        <div className="empty">Wird geladen …</div>
      ) : groups.length === 0 ? (
        <div className="empty">Noch keine GGUF-Datei gefunden.</div>
      ) : (
        <div className="card table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Modell</th>
                <th>Ordner</th>
                <th className="right">Größe</th>
                <th>Teile</th>
                <th>Geändert</th>
                <th aria-label="Aktionen" />
              </tr>
            </thead>
            <tbody>
              {groups.map((group) => (
                <tr key={group.key}>
                  <td><strong>{group.name}</strong></td>
                  <td className="small mono faint" style={{ maxWidth: 260 }}>
                    <span className="truncate" style={{ display: 'block' }} title={group.dir}>
                      {group.dir || '.'}
                    </span>
                  </td>
                  <td className="right mono small nowrap">{formatBytes(group.totalBytes)}</td>
                  <td className="small">
                    {group.expectedShards > 1 ? (
                      <span className={`badge ${group.complete ? '' : 'badge-warn'}`}>
                        {group.shardCount}/{group.expectedShards}
                      </span>
                    ) : (
                      <span className="faint">1</span>
                    )}
                  </td>
                  <td className="small faint nowrap">{formatDate(group.mtime)}</td>
                  <td>
                    <div className="row" style={{ justifyContent: 'flex-end' }}>
                      <button
                        type="button"
                        className="btn btn-sm"
                        disabled={!group.complete}
                        title={group.complete ? '' : 'Unvollständiges Shard-Set'}
                        onClick={() => setStartFrom(group.primary)}
                      >
                        Server starten
                      </button>
                      <button
                        type="button"
                        className="btn btn-sm btn-danger"
                        onClick={() => setPendingDelete({ key: group.key, group })}
                      >
                        Löschen
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {downloading ? <ModelDownloadDialog onClose={() => setDownloading(false)} /> : null}

      {startFrom ? (
        <StartServerDialog initial={{ modelPath: startFrom }} onClose={() => setStartFrom(null)} />
      ) : null}

      {pendingDelete ? (
        <ConfirmDialog
          title="Modell löschen"
          danger
          confirmLabel={pendingDelete.blockedBy?.length ? 'Server stoppen und löschen' : 'Löschen'}
          busy={remove.isPending}
          message={
            <div className="stack-sm">
              <p>
                <strong>{pendingDelete.group.name}</strong> — {pendingDelete.group.files.length}{' '}
                Datei(en), {formatBytes(pendingDelete.group.totalBytes)}. Das lässt sich nicht
                rückgängig machen.
              </p>
              {pendingDelete.blockedBy?.length ? (
                <div className="alert alert-warn small">
                  {pendingDelete.message} Beim Fortfahren
                  {pendingDelete.blockedBy.length === 1 ? ' wird dieser Server' : ' werden diese Server'}{' '}
                  vorher gestoppt.
                </div>
              ) : null}
            </div>
          }
          onConfirm={() =>
            remove.mutate({ key: pendingDelete.key, force: Boolean(pendingDelete.blockedBy?.length) })
          }
          onClose={() => setPendingDelete(null)}
        />
      ) : null}
    </>
  )
}
