import { useQuery } from '@tanstack/react-query'

import { get, qs } from '../api/client.js'
import { formatBytes, formatNumber } from './format.js'

const CONTEXTS = [8192, 16384, 32768, 65536, 131072]

/**
 * VRAM estimate for the selected model, with each context size checked against
 * the live GTT budget.
 *
 * GTT is the number that matters on Strix Halo: it is the slice of unified
 * memory the iGPU may use (the `amdgpu.gttsize` boot parameter), and exceeding
 * it is what turns a model load into a crash.
 */
export function VramEstimate({ modelPath, gttTotal, onPick }) {
  const estimate = useQuery({
    queryKey: ['estimate', modelPath],
    queryFn: () => get(`/models/estimate${qs({ path: modelPath, contexts: CONTEXTS.join(',') })}`),
    enabled: Boolean(modelPath),
    retry: false,
    staleTime: 10 * 60_000,
  })

  if (!modelPath) return null
  if (estimate.isLoading) return <p className="small muted">VRAM-Schätzung läuft …</p>
  if (estimate.isError) {
    return <p className="small faint">VRAM-Schätzung nicht verfügbar: {estimate.error.message}</p>
  }

  const data = estimate.data
  if (!data?.rows?.length) return null

  return (
    <div className="stack-sm">
      <div className="row-between">
        <h3>VRAM-Schätzung</h3>
        <span className="small faint">
          Modell {formatBytes(data.modelSizeBytes)}
          {data.maxContext ? ` · max. ${formatNumber(data.maxContext)} Tokens` : ''}
        </span>
      </div>

      <div className="table-wrap">
        <table className="table">
          <thead>
            <tr>
              <th>Context</th>
              <th>KV-Cache</th>
              <th>Gesamt</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {data.rows.map((row) => {
              const overBudget = gttTotal ? row.totalBytes > gttTotal : false
              const overTrained = data.maxContext ? row.ctxSize > data.maxContext : false
              return (
                <tr key={row.ctxSize}>
                  <td className="mono">{formatNumber(row.ctxSize)}</td>
                  <td className="mono small">{formatBytes(row.kvBytes)}</td>
                  <td className="mono small">{formatBytes(row.totalBytes)}</td>
                  <td className="right">
                    {overBudget ? (
                      <span className="badge badge-danger">über GTT-Budget</span>
                    ) : overTrained ? (
                      <span className="badge badge-warn">über Trainingskontext</span>
                    ) : (
                      <button type="button" className="btn btn-sm" onClick={() => onPick?.(row.ctxSize)}>
                        Übernehmen
                      </button>
                    )}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      {data.warning ? <p className="small faint">{data.warning}</p> : null}
      {gttTotal ? (
        <p className="small faint">GTT-Budget dieser Maschine: {formatBytes(gttTotal)}.</p>
      ) : null}
    </div>
  )
}
