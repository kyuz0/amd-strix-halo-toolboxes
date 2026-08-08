import { useCallback, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'

import { get } from '../api/client.js'
import { useEventStream } from '../api/sse.js'
import { PageHead } from '../components/Layout.jsx'
import { StatTile } from '../components/Sparkline.jsx'
import { formatBytes, formatDuration, shortImage } from '../components/format.js'

const MAX_HISTORY = 300

export function Dashboard() {
  const [history, setHistory] = useState([])
  const [latest, setLatest] = useState(null)
  const [autostart, setAutostart] = useState(null)

  const onSnapshot = useCallback((data) => {
    setHistory(data.history ?? [])
    setLatest({ ...data, containers: data.containers })
    setAutostart(data.autostart ?? null)
  }, [])

  const onTick = useCallback((sample) => {
    setLatest(sample)
    setHistory((prev) => [...prev.slice(-(MAX_HISTORY - 1)), sample])
  }, [])

  const state = useEventStream('/system/events', { snapshot: onSnapshot, tick: onTick })

  const servers = useQuery({
    queryKey: ['servers'],
    queryFn: () => get('/servers'),
    refetchInterval: 5000,
  })
  const images = useQuery({ queryKey: ['images'], queryFn: () => get('/images') })

  const gpu = latest?.gpu
  const cpu = latest?.cpu
  const memory = latest?.memory
  const running = (servers.data?.servers ?? []).filter((s) => s.running)
  const updates = (images.data?.images ?? []).filter((i) => i.updateAvailable)

  const series = (pick) => history.map(pick)

  return (
    <>
      <PageHead
        title="Übersicht"
        description="Auslastung der Box und alles, was gerade läuft."
      >
        <span className={`badge ${state === 'open' ? 'badge-ok' : 'badge-warn'}`}>
          {state === 'open' ? 'live' : state}
        </span>
      </PageHead>

      {updates.length > 0 ? (
        <div className="alert alert-info small">
          Für {updates.map((i) => i.tag).join(', ')} liegt ein neuerer Build vor —{' '}
          <Link to="/images">zu den Images</Link>.
        </div>
      ) : null}

      {autostart?.failed?.length ? (
        <div className="alert alert-warn small">
          Autostart fehlgeschlagen für{' '}
          {autostart.failed.map((f) => `${f.name} (${f.error})`).join('; ')}.
        </div>
      ) : null}

      {gpu ? (
        <div className="card-grid">
          <StatTile
            label="GPU-Auslastung"
            value={gpu.busyPercent != null ? `${gpu.busyPercent} %` : '–'}
            values={series((s) => s.gpu?.busyPercent)}
            max={100}
          />
          <StatTile
            label="GTT belegt"
            value={gpu.gttUsed != null ? formatBytes(gpu.gttUsed) : '–'}
            secondary={gpu.gttTotal ? `von ${formatBytes(gpu.gttTotal)} Budget` : null}
            values={series((s) => s.gpu?.gttUsed)}
            max={gpu.gttTotal ?? undefined}
            color="var(--info)"
          />
          <StatTile
            label="VRAM belegt"
            value={gpu.vramUsed != null ? formatBytes(gpu.vramUsed) : '–'}
            secondary={gpu.vramTotal ? `von ${formatBytes(gpu.vramTotal)}` : null}
            values={series((s) => s.gpu?.vramUsed)}
            max={gpu.vramTotal ?? undefined}
            color="var(--info)"
          />
          {gpu.temperatureC != null ? (
            <StatTile
              label="Temperatur"
              value={`${gpu.temperatureC.toFixed(0)} °C`}
              secondary={gpu.powerW != null ? `${gpu.powerW.toFixed(1)} W` : null}
              values={series((s) => s.gpu?.temperatureC)}
              color="var(--warn)"
            />
          ) : null}
        </div>
      ) : (
        <div className="empty small">
          Keine AMD-GPU in sysfs gefunden — die GPU-Kacheln bleiben leer. Auf einem
          Entwicklungsrechner ist das normal.
        </div>
      )}

      <div className="card-grid">
        <StatTile
          label="CPU"
          value={cpu?.busyPercent != null ? `${cpu.busyPercent} %` : '–'}
          secondary={cpu?.cores ? `${cpu.cores} Kerne · Load ${cpu.load?.[0]?.toFixed(2)}` : null}
          values={series((s) => s.cpu?.busyPercent)}
          max={100}
          color="var(--ok)"
        />
        <StatTile
          label="Arbeitsspeicher"
          value={memory?.usedBytes != null ? formatBytes(memory.usedBytes) : '–'}
          secondary={memory?.totalBytes ? `von ${formatBytes(memory.totalBytes)}` : null}
          values={series((s) => s.memory?.usedBytes)}
          max={memory?.totalBytes ?? undefined}
          color="var(--ok)"
        />
        <StatTile
          label="Laufzeit"
          value={latest?.uptime ? formatDuration(latest.uptime) : '–'}
          secondary={`${running.length} Server aktiv`}
        />
      </div>

      <section className="card">
        <div className="card-head">
          <h2>Laufende Server</h2>
          <Link to="/servers" className="small">
            Alle anzeigen
          </Link>
        </div>
        {running.length === 0 ? (
          <p className="muted small">Derzeit läuft kein Server.</p>
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Modell</th>
                  <th>Image</th>
                  <th>Port</th>
                  <th>CPU</th>
                  <th>Speicher</th>
                </tr>
              </thead>
              <tbody>
                {running.map((server) => {
                  const stats = latest?.containers?.find((c) => c.name === server.name)
                  return (
                    <tr key={server.name}>
                      <td>
                        <Link to={`/servers/${encodeURIComponent(server.name)}`}>{server.name}</Link>
                      </td>
                      <td className="small mono" style={{ maxWidth: 240 }}>
                        <span className="truncate" style={{ display: 'block' }}>
                          {server.modelPath}
                        </span>
                      </td>
                      <td className="small">{shortImage(server.image)}</td>
                      <td className="small mono">{server.hostPort}</td>
                      <td className="small mono">{stats?.cpu ?? '–'}</td>
                      <td className="small mono">{stats?.memory ?? '–'}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </>
  )
}
