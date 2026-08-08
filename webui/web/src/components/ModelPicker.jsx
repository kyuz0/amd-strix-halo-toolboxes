import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'

import { get } from '../api/client.js'
import { formatBytes } from './format.js'

/**
 * Pick a model from what is actually on disk.
 *
 * Only the primary shard is selectable — that is the only path llama.cpp
 * accepts for a multi-part model — and incomplete shard sets are shown but
 * disabled, since starting one would fail at load time.
 */
export function ModelPicker({ value, onChange }) {
  const [filter, setFilter] = useState('')
  const models = useQuery({ queryKey: ['models'], queryFn: () => get('/models') })

  const groups = useMemo(() => {
    const all = models.data?.groups ?? []
    const needle = filter.trim().toLowerCase()
    if (!needle) return all
    return all.filter((g) => g.key.toLowerCase().includes(needle))
  }, [models.data, filter])

  if (models.isLoading) return <div className="empty small">Modelle werden gesucht …</div>
  if (models.isError) return <div className="alert alert-danger small">{models.error.message}</div>

  const all = models.data?.groups ?? []
  if (all.length === 0) {
    return (
      <div className="empty small">
        Im Verzeichnis <code>{models.data?.modelsDir}</code> wurde keine GGUF-Datei gefunden.
      </div>
    )
  }

  return (
    <div className="stack-sm">
      <input
        type="search"
        placeholder="Modelle filtern …"
        value={filter}
        onChange={(e) => setFilter(e.target.value)}
      />
      <div className="picker">
        {groups.length === 0 ? (
          <div className="empty small">Kein Treffer.</div>
        ) : (
          groups.map((group) => {
            const selected = value === group.primary
            return (
              <button
                type="button"
                key={group.key}
                className={`picker-item${selected ? ' selected' : ''}`}
                disabled={!group.complete}
                onClick={() => onChange(group.primary)}
                title={group.complete ? group.primary : 'Unvollständiges Shard-Set'}
              >
                <span className="grow truncate">
                  <span className="mono">{group.dir || '.'}</span>
                  <br />
                  <strong>{group.name}</strong>
                </span>
                <span className="right nowrap small">
                  {formatBytes(group.totalBytes)}
                  {group.expectedShards > 1 ? (
                    <>
                      <br />
                      <span className={group.complete ? 'faint' : 'badge badge-warn'}>
                        {group.shardCount}/{group.expectedShards} Teile
                      </span>
                    </>
                  ) : null}
                </span>
              </button>
            )
          })
        )}
      </div>
    </div>
  )
}
