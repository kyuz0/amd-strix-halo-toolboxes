import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { del, get, post, qs } from '../api/client.js'
import { JobProgress } from '../components/JobProgress.jsx'
import { PageHead } from '../components/Layout.jsx'
import { Modal } from '../components/Modal.jsx'
import { useToast } from '../components/Toast.jsx'
import { formatBytes, formatDate } from '../components/format.js'

export function Images() {
  const toast = useToast()
  const queryClient = useQueryClient()
  const [pullJob, setPullJob] = useState(null)

  const images = useQuery({ queryKey: ['images'], queryFn: () => get('/images') })

  const check = useMutation({
    mutationFn: () => post('/images/check-updates'),
    onSuccess: (data) => {
      queryClient.setQueryData(['images'], { images: data.images })
      toast.success(
        data.rateLimited
          ? 'Docker Hub hat gedrosselt — die Prüfung pausiert für 24 Stunden.'
          : 'Update-Prüfung abgeschlossen.',
      )
    },
    onError: (err) => toast.error(err),
  })

  const pull = useMutation({
    mutationFn: (ref) => post('/images/pull', { ref }),
    onSuccess: (data, ref) => setPullJob({ id: data.jobId, ref }),
    onError: (err) => toast.error(err),
  })

  const remove = useMutation({
    mutationFn: (ref) => del(`/images${qs({ ref })}`),
    onSuccess: (_data, ref) => {
      toast.success(`${ref} entfernt.`)
      queryClient.invalidateQueries({ queryKey: ['images'] })
    },
    onError: (err) => toast.error(err),
  })

  const list = images.data?.images ?? []
  const updates = list.filter((i) => i.updateAvailable).length

  return (
    <>
      <PageHead
        title="Images"
        description="Die llama-server-Toolboxes dieses Repositories. Die Update-Prüfung vergleicht Digests, ohne etwas herunterzuladen."
      >
        <button className="btn" type="button" onClick={() => check.mutate()} disabled={check.isPending}>
          {check.isPending ? 'Prüft …' : 'Auf Updates prüfen'}
        </button>
      </PageHead>

      {updates > 0 ? (
        <div className="alert alert-info small">
          Für {updates} Image{updates === 1 ? '' : 's'} liegt ein neuerer Build vor. Ein Pull
          wirkt sich erst auf einen Server aus, wenn dieser neu angelegt wird.
        </div>
      ) : null}

      {images.isError ? (
        <div className="alert alert-danger">{images.error.message}</div>
      ) : images.isLoading ? (
        <div className="empty">Wird geladen …</div>
      ) : (
        <div className="card-grid">
          {list.map((image) => (
            <section className="card stack-sm" key={image.ref}>
              <div className="row-between">
                <h2>{image.tag}</h2>
                {image.updateAvailable ? (
                  <span className="badge badge-info">Update verfügbar</span>
                ) : image.installed ? (
                  <span className="badge badge-ok">aktuell</span>
                ) : (
                  <span className="badge">nicht installiert</span>
                )}
              </div>

              {image.description ? <p className="small muted">{image.description}</p> : null}

              <dl className="kv small">
                {image.installed ? (
                  <>
                    <dt>Größe</dt>
                    <dd>{formatBytes(image.sizeBytes)}</dd>
                    <dt>Lokal seit</dt>
                    <dd>{formatDate(image.createdAt)}</dd>
                  </>
                ) : null}
                {image.newestBuildAt ? (
                  <>
                    <dt>Neuester Build</dt>
                    <dd>{formatDate(image.newestBuildAt)}</dd>
                  </>
                ) : null}
                <dt>Zuletzt geprüft</dt>
                <dd>{image.remoteCheckedAt ? formatDate(image.remoteCheckedAt) : 'nie'}</dd>
              </dl>

              {image.usedBy.length ? (
                <p className="small faint">Verwendet von: {image.usedBy.join(', ')}</p>
              ) : null}

              <div className="row wrap">
                <button
                  type="button"
                  className={`btn btn-sm${image.updateAvailable || !image.installed ? ' btn-primary' : ''}`}
                  disabled={pull.isPending}
                  onClick={() => pull.mutate(image.ref)}
                >
                  {image.installed ? 'Neu pullen' : 'Pullen'}
                </button>
                {image.installed ? (
                  <button
                    type="button"
                    className="btn btn-sm btn-danger"
                    disabled={remove.isPending || image.usedBy.length > 0}
                    title={image.usedBy.length ? 'Wird von einem Server verwendet' : ''}
                    onClick={() => remove.mutate(image.ref)}
                  >
                    Entfernen
                  </button>
                ) : null}
              </div>
            </section>
          ))}
        </div>
      )}

      {pullJob ? (
        <Modal
          title={`Image wird geladen: ${pullJob.ref}`}
          onClose={() => setPullJob(null)}
          footer={
            <button type="button" className="btn" onClick={() => setPullJob(null)}>
              Schließen
            </button>
          }
        >
          <JobProgress
            jobId={pullJob.id}
            onFinished={(job) => {
              queryClient.invalidateQueries({ queryKey: ['images'] })
              if (job.status === 'done') toast.success('Image geladen.')
              if (job.status === 'failed') toast.error(job.error ?? 'Pull fehlgeschlagen.')
            }}
          />
        </Modal>
      ) : null}
    </>
  )
}
