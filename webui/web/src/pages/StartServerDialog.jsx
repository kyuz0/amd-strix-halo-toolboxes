import { useEffect, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { get, post } from '../api/client.js'
import { Modal } from '../components/Modal.jsx'
import { ModelPicker } from '../components/ModelPicker.jsx'
import { VramEstimate } from '../components/VramEstimate.jsx'
import { useToast } from '../components/Toast.jsx'

const KNOWN_TAGS = ['vulkan-radv', 'vulkan-amdvlk', 'rocm-7.14', 'rocm-6.4.4']
const IMAGE_REPO = 'docker.io/st3v0rr/amd-strix-halo-toolboxes'

export function StartServerDialog({ onClose, initial }) {
  const toast = useToast()
  const queryClient = useQueryClient()
  const settings = useQuery({ queryKey: ['settings'], queryFn: () => get('/settings') })
  // Only used to check the estimate against the machine's real GTT budget;
  // absent (on a dev machine without amdgpu) it simply hides the comparison.
  const system = useQuery({
    queryKey: ['system'],
    queryFn: () => get('/system'),
    retry: false,
    staleTime: 60_000,
  })

  const [form, setForm] = useState({
    name: 'llamacpp-server',
    image: `${IMAGE_REPO}:vulkan-radv`,
    modelPath: '',
    port: 11434,
    ctxSize: 65536,
    gpuLayers: 999,
    threads: 12,
    apiKey: '',
    extraArgs: '',
    ...initial,
  })
  const [replace, setReplace] = useState(false)
  const [conflictName, setConflictName] = useState(null)

  // Seed from the saved defaults once they arrive, without clobbering edits.
  useEffect(() => {
    const s = settings.data?.settings
    if (!s || initial) return
    setForm((f) => ({
      ...f,
      image: s.defaultImage,
      ctxSize: s.defaultCtxSize,
      gpuLayers: s.defaultGpuLayers,
      threads: s.defaultThreads,
    }))
  }, [settings.data, initial])

  const start = useMutation({
    mutationFn: (body) => post('/servers', body),
    onSuccess: (result) => {
      toast.success(`Server '${result.name}' gestartet.`)
      queryClient.invalidateQueries({ queryKey: ['servers'] })
      onClose()
    },
    onError: (err) => {
      if (err.code === 'conflict' && err.details?.existing) {
        setConflictName(err.details.existing)
      } else {
        toast.error(err)
      }
    },
  })

  const set = (key) => (e) => {
    const value = e.target.type === 'number' ? Number(e.target.value) : e.target.value
    setForm((f) => ({ ...f, [key]: value }))
    setConflictName(null)
  }

  function submit(event) {
    event.preventDefault()
    const body = { ...form, replace }
    if (!body.apiKey) delete body.apiKey
    if (!body.extraArgs) delete body.extraArgs
    start.mutate(body)
  }

  const allowCustom = settings.data?.settings?.allowCustomImages

  return (
    <Modal
      title="Server starten"
      wide
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn" onClick={onClose} disabled={start.isPending}>
            Abbrechen
          </button>
          <button
            type="submit"
            form="start-server-form"
            className="btn btn-primary"
            disabled={start.isPending || !form.modelPath || !form.name}
          >
            {start.isPending ? 'Startet …' : 'Starten'}
          </button>
        </>
      }
    >
      <form id="start-server-form" className="stack" onSubmit={submit}>
        {conflictName ? (
          <div className="alert alert-warn small stack-sm">
            <span>
              Ein Container namens <code>{conflictName}</code> existiert bereits.
            </span>
            <label className="row">
              <input
                type="checkbox"
                style={{ width: 'auto' }}
                checked={replace}
                onChange={(e) => setReplace(e.target.checked)}
              />
              Vorhandenen Container stoppen, entfernen und neu anlegen
            </label>
          </div>
        ) : null}

        <div className="field">
          <label>Modell</label>
          <ModelPicker
            value={form.modelPath}
            onChange={(modelPath) => {
              // Default the container name to the model's folder, which is the
              // name the user thinks in — still editable below.
              const suggested = modelPath.split('/')[0]?.replace(/[^A-Za-z0-9._-]/g, '-')
              setForm((f) => ({
                ...f,
                modelPath,
                name: f.nameTouched ? f.name : (suggested || f.name).slice(0, 63),
              }))
            }}
          />
          {form.modelPath ? <p className="small mono faint">{form.modelPath}</p> : null}
        </div>

        <VramEstimate
          modelPath={form.modelPath}
          gttTotal={system.data?.gpu?.gttTotal ?? null}
          onPick={(ctxSize) => setForm((f) => ({ ...f, ctxSize }))}
        />

        <div className="form-grid">
          <div className="field">
            <label htmlFor="name">Containername</label>
            <input
              id="name"
              type="text"
              required
              value={form.name}
              onChange={(e) => setForm((f) => ({ ...f, name: e.target.value, nameTouched: true }))}
            />
          </div>
          <div className="field">
            <label htmlFor="port">Host-Port</label>
            <input id="port" type="number" required value={form.port} onChange={set('port')} />
            <span className="hint">Im Container immer 11434.</span>
          </div>
        </div>

        <div className="field">
          <label htmlFor="image">Image</label>
          {allowCustom ? (
            <input id="image" type="text" value={form.image} onChange={set('image')} />
          ) : (
            <select id="image" value={form.image} onChange={set('image')}>
              {KNOWN_TAGS.map((tag) => (
                <option key={tag} value={`${IMAGE_REPO}:${tag}`}>
                  {tag}
                </option>
              ))}
            </select>
          )}
        </div>

        <div className="form-grid">
          <div className="field">
            <label htmlFor="ctxSize">Context Size</label>
            <input id="ctxSize" type="number" value={form.ctxSize} onChange={set('ctxSize')} />
          </div>
          <div className="field">
            <label htmlFor="gpuLayers">GPU Layers</label>
            <input id="gpuLayers" type="number" value={form.gpuLayers} onChange={set('gpuLayers')} />
          </div>
          <div className="field">
            <label htmlFor="threads">Threads</label>
            <input id="threads" type="number" value={form.threads} onChange={set('threads')} />
          </div>
        </div>

        <div className="field">
          <label htmlFor="apiKey">API-Key</label>
          <input
            id="apiKey"
            type="text"
            placeholder="leer lassen für einen zufälligen Key"
            value={form.apiKey}
            onChange={set('apiKey')}
          />
        </div>

        <div className="field">
          <label htmlFor="extraArgs">Zusätzliche llama-server-Argumente</label>
          <input
            id="extraArgs"
            type="text"
            placeholder="leer lassen für die automatische Erkennung"
            value={form.extraArgs}
            onChange={set('extraArgs')}
          />
          <span className="hint">
            Leer bedeutet: am Image ermitteln, ob <code>-fa on --load-mode none</code> oder{' '}
            <code>-fa 1 --no-mmap</code> unterstützt wird. Auf Strix Halo ist eines von beiden
            zwingend.
          </span>
        </div>
      </form>
    </Modal>
  )
}
