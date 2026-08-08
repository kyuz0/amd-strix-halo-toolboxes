import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'

import { del, get } from '../api/client.js'
import { useEventStream } from '../api/sse.js'
import { formatBytes, formatDuration } from './format.js'

/**
 * Live view of a single job: progress bar, rate, ETA, and the raw output
 * behind a disclosure.
 */
export function JobProgress({ jobId, onFinished }) {
  const queryClient = useQueryClient()
  const [progress, setProgress] = useState(null)
  const [status, setStatus] = useState(null)
  const [lines, setLines] = useState([])
  const [showLog, setShowLog] = useState(false)

  const initial = useQuery({
    queryKey: ['job', jobId],
    queryFn: () => get(`/jobs/${jobId}`),
    enabled: Boolean(jobId),
    staleTime: Infinity,
  })

  useEventStream(jobId ? `/jobs/${jobId}/events` : null, {
    progress: (data) => setProgress(data),
    status: (data) => {
      setStatus(data)
      if (['done', 'failed', 'cancelled'].includes(data.status)) {
        queryClient.invalidateQueries({ queryKey: ['models'] })
        queryClient.invalidateQueries({ queryKey: ['images'] })
        onFinished?.(data)
      }
    },
    log: (data) => setLines((prev) => [...prev.slice(-400), data.line]),
    message: (data) => setStatus((s) => (s ? { ...s, message: data.message } : s)),
  })

  const job = status ?? initial.data?.job
  const p = progress ?? job?.progress
  if (!job) return <div className="small muted">Job wird geladen …</div>

  const finished = ['done', 'failed', 'cancelled', 'interrupted'].includes(job.status)
  const pct = p?.pct

  return (
    <div className="stack-sm">
      <div className="row-between">
        <span className="truncate">{job.title}</span>
        <span
          className={`badge ${
            job.status === 'done'
              ? 'badge-ok'
              : job.status === 'failed'
                ? 'badge-danger'
                : job.status === 'running'
                  ? 'badge-info'
                  : ''
          }`}
        >
          {job.status}
        </span>
      </div>

      {!finished ? (
        <div className={`progress${pct == null ? ' progress-indeterminate' : ''}`}>
          <div style={{ width: `${pct ?? 100}%` }} />
        </div>
      ) : null}

      <div className="row-between small faint">
        <span>
          {p?.done != null && p?.total != null
            ? `${formatBytes(p.done)} / ${formatBytes(p.total)}${pct != null ? ` (${pct} %)` : ''}`
            : (job.message ?? '')}
        </span>
        <span>
          {p?.rate ? `${formatBytes(p.rate)}/s` : ''}
          {p?.eta ? ` · noch ${formatDuration(p.eta)}` : ''}
        </span>
      </div>

      {job.error ? <div className="alert alert-danger small">{job.error}</div> : null}

      <div className="row">
        <button type="button" className="btn btn-sm btn-ghost" onClick={() => setShowLog((v) => !v)}>
          {showLog ? 'Ausgabe ausblenden' : 'Ausgabe anzeigen'}
        </button>
        {!finished ? (
          <button
            type="button"
            className="btn btn-sm btn-danger"
            onClick={() => del(`/jobs/${jobId}`).catch(() => {})}
          >
            Abbrechen
          </button>
        ) : null}
      </div>

      {showLog ? (
        <pre className="logbox" style={{ height: 180 }}>
          {(initial.data?.logs ?? []).map((e) => e.value).concat(lines).join('\n') || 'Noch keine Ausgabe.'}
        </pre>
      ) : null}
    </div>
  )
}
