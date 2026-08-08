import { useEffect, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { get, post, put } from '../api/client.js'
import { PageHead } from '../components/Layout.jsx'
import { useToast } from '../components/Toast.jsx'

export function Settings() {
  const toast = useToast()
  const queryClient = useQueryClient()
  const { data, isLoading } = useQuery({ queryKey: ['settings'], queryFn: () => get('/settings') })

  const [form, setForm] = useState(null)
  const [hfToken, setHfToken] = useState('')

  useEffect(() => {
    if (data?.settings) setForm(data.settings)
  }, [data])

  const save = useMutation({
    mutationFn: (patch) => put('/settings', patch),
    onSuccess: () => {
      toast.success('Einstellungen gespeichert.')
      setHfToken('')
      queryClient.invalidateQueries({ queryKey: ['settings'] })
    },
    onError: (err) => toast.error(err),
  })

  if (isLoading || !form) {
    return (
      <>
        <PageHead title="Einstellungen" />
        <div className="empty">Wird geladen …</div>
      </>
    )
  }

  const field = (key, value) => setForm((f) => ({ ...f, [key]: value }))
  const num = (key) => (e) => field(key, Number(e.target.value))

  function onSubmit(event) {
    event.preventDefault()
    const patch = { ...form }
    if (hfToken.trim()) patch.hfToken = hfToken.trim()
    save.mutate(patch)
  }

  return (
    <>
      <PageHead
        title="Einstellungen"
        description="Modellverzeichnis, Standardwerte für neue Server und Zugangsdaten."
      />

      <form className="stack" onSubmit={onSubmit}>
        <section className="card stack">
          <h2>Pfade und Netzwerk</h2>
          <div className="form-grid">
            <div className="field" style={{ gridColumn: '1 / -1' }}>
              <label htmlFor="modelsDir">Modellverzeichnis</label>
              <input
                id="modelsDir"
                type="text"
                value={form.modelsDir}
                onChange={(e) => field('modelsDir', e.target.value)}
              />
              <span className="hint">
                Absoluter Pfad auf dem Host. Wird in den Containern nach /workspace/models
                gemountet.
              </span>
            </div>
            <div className="field">
              <label htmlFor="bindAddress">Bind-Adresse</label>
              <input
                id="bindAddress"
                type="text"
                value={form.bindAddress}
                onChange={(e) => field('bindAddress', e.target.value)}
              />
              <span className="hint">Erst nach einem Neustart des Dienstes wirksam.</span>
            </div>
            <div className="field">
              <label htmlFor="port">Port</label>
              <input id="port" type="number" value={form.port} onChange={num('port')} />
              <span className="hint">Erst nach einem Neustart des Dienstes wirksam.</span>
            </div>
          </div>
        </section>

        <section className="card stack">
          <h2>Standardwerte für neue Server</h2>
          <div className="form-grid">
            <div className="field" style={{ gridColumn: '1 / -1' }}>
              <label htmlFor="defaultImage">Image</label>
              <input
                id="defaultImage"
                type="text"
                value={form.defaultImage}
                onChange={(e) => field('defaultImage', e.target.value)}
              />
            </div>
            <div className="field">
              <label htmlFor="defaultCtxSize">Context Size</label>
              <input
                id="defaultCtxSize"
                type="number"
                value={form.defaultCtxSize}
                onChange={num('defaultCtxSize')}
              />
            </div>
            <div className="field">
              <label htmlFor="defaultGpuLayers">GPU Layers</label>
              <input
                id="defaultGpuLayers"
                type="number"
                value={form.defaultGpuLayers}
                onChange={num('defaultGpuLayers')}
              />
            </div>
            <div className="field">
              <label htmlFor="defaultThreads">Threads</label>
              <input
                id="defaultThreads"
                type="number"
                value={form.defaultThreads}
                onChange={num('defaultThreads')}
              />
            </div>
          </div>
        </section>

        <section className="card stack">
          <h2>Downloads und Images</h2>
          <div className="form-grid">
            <div className="field">
              <label htmlFor="maxConcurrentDownloads">Parallele Downloads</label>
              <input
                id="maxConcurrentDownloads"
                type="number"
                min="1"
                max="3"
                value={form.maxConcurrentDownloads}
                onChange={num('maxConcurrentDownloads')}
              />
              <span className="hint">
                Netz und Platte sind der Flaschenhals — mehr als einer bringt selten etwas.
              </span>
            </div>
            <div className="field">
              <label htmlFor="imageCheckIntervalHours">Image-Prüfung (Stunden)</label>
              <input
                id="imageCheckIntervalHours"
                type="number"
                min="1"
                max="168"
                value={form.imageCheckIntervalHours}
                onChange={num('imageCheckIntervalHours')}
              />
            </div>
          </div>

          <label className="row small">
            <input
              type="checkbox"
              style={{ width: 'auto' }}
              checked={form.useHfTransfer}
              onChange={(e) => field('useHfTransfer', e.target.checked)}
            />
            hf_transfer verwenden (schneller, aber der Fortschritt ist gröber)
          </label>

          <label className="row small">
            <input
              type="checkbox"
              style={{ width: 'auto' }}
              checked={form.allowCustomImages}
              onChange={(e) => field('allowCustomImages', e.target.checked)}
            />
            Beliebige Image-Referenzen erlauben
          </label>
          {form.allowCustomImages ? (
            <div className="alert alert-warn small">
              Container erhalten <code>/dev/kfd</code> und <code>seccomp=unconfined</code>. Nutze
              das nur für Images, denen du vertraust.
            </div>
          ) : null}
        </section>

        <section className="card stack">
          <h2>Hugging Face</h2>
          <div className="field">
            <label htmlFor="hfToken">Zugriffstoken</label>
            <input
              id="hfToken"
              type="password"
              autoComplete="off"
              placeholder={
                data.hfToken.configured
                  ? `gesetzt (${data.hfToken.hint}) — zum Ändern neu eingeben`
                  : 'nicht gesetzt'
              }
              value={hfToken}
              onChange={(e) => setHfToken(e.target.value)}
            />
            <span className="hint">
              Nur für gated Repositories nötig. Wird gespeichert, aber nie wieder ausgegeben.
            </span>
          </div>
        </section>

        <div className="row">
          <button className="btn btn-primary" type="submit" disabled={save.isPending}>
            {save.isPending ? 'Wird gespeichert …' : 'Speichern'}
          </button>
        </div>
      </form>

      <PasswordCard />
    </>
  )
}

function PasswordCard() {
  const toast = useToast()
  const [current, setCurrent] = useState('')
  const [next, setNext] = useState('')

  const change = useMutation({
    mutationFn: () => post('/auth/password', { currentPassword: current, newPassword: next }),
    onSuccess: () => {
      toast.success('Passwort geändert.')
      setCurrent('')
      setNext('')
    },
    onError: (err) => toast.error(err),
  })

  return (
    <section className="card stack">
      <h2>Passwort ändern</h2>
      <form
        className="form-grid"
        onSubmit={(e) => {
          e.preventDefault()
          change.mutate()
        }}
      >
        <div className="field">
          <label htmlFor="current">Aktuelles Passwort</label>
          <input
            id="current"
            type="password"
            autoComplete="current-password"
            value={current}
            onChange={(e) => setCurrent(e.target.value)}
          />
        </div>
        <div className="field">
          <label htmlFor="next">Neues Passwort</label>
          <input
            id="next"
            type="password"
            autoComplete="new-password"
            minLength={8}
            value={next}
            onChange={(e) => setNext(e.target.value)}
          />
          <span className="hint">Mindestens 8 Zeichen.</span>
        </div>
        <div className="field" style={{ justifyContent: 'flex-end' }}>
          <button
            className="btn"
            type="submit"
            disabled={change.isPending || !current || next.length < 8}
          >
            Ändern
          </button>
        </div>
      </form>
    </section>
  )
}
