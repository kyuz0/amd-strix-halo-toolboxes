import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { del, get, post, put } from '../api/client.js'
import { PageHead } from '../components/Layout.jsx'
import { ConfirmDialog, Modal } from '../components/Modal.jsx'
import { ModelPicker } from '../components/ModelPicker.jsx'
import { useToast } from '../components/Toast.jsx'
import { shortImage } from '../components/format.js'

const IMAGE_REPO = 'docker.io/st3v0rr/amd-strix-halo-toolboxes'

const EMPTY = {
  name: '',
  image: `${IMAGE_REPO}:vulkan-radv`,
  modelPath: '',
  port: 11434,
  ctxSize: 65536,
  gpuLayers: 999,
  threads: 12,
  apiKey: '',
  extraArgs: '',
  autostart: false,
}

export function Profiles() {
  const toast = useToast()
  const queryClient = useQueryClient()
  const [editing, setEditing] = useState(null)
  const [pendingDelete, setPendingDelete] = useState(null)

  const profiles = useQuery({ queryKey: ['profiles'], queryFn: () => get('/profiles') })

  const launch = useMutation({
    mutationFn: (id) => post(`/profiles/${id}/launch`, {}),
    onSuccess: (result) => {
      toast.success(`Server '${result.name}' gestartet.`)
      queryClient.invalidateQueries({ queryKey: ['servers'] })
    },
    onError: (err) => toast.error(err),
  })

  const remove = useMutation({
    mutationFn: (id) => del(`/profiles/${id}`),
    onSuccess: () => {
      toast.success('Profil gelöscht.')
      setPendingDelete(null)
      queryClient.invalidateQueries({ queryKey: ['profiles'] })
    },
    onError: (err) => toast.error(err),
  })

  const list = profiles.data?.profiles ?? []

  return (
    <>
      <PageHead
        title="Profile"
        description="Gespeicherte Server-Konfigurationen. Mit Autostart werden sie nach einem Neustart der Box automatisch wieder hochgefahren."
      >
        <button className="btn btn-primary" type="button" onClick={() => setEditing(EMPTY)}>
          Profil anlegen
        </button>
      </PageHead>

      {profiles.isError ? (
        <div className="alert alert-danger">{profiles.error.message}</div>
      ) : list.length === 0 ? (
        <div className="empty">
          Noch kein Profil gespeichert. Ein Profil merkt sich Modell, Image, Port und alle
          Startparameter.
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
                <th>Autostart</th>
                <th aria-label="Aktionen" />
              </tr>
            </thead>
            <tbody>
              {list.map((profile) => (
                <tr key={profile.id}>
                  <td><strong>{profile.name}</strong></td>
                  <td className="small mono" style={{ maxWidth: 260 }}>
                    <span className="truncate" style={{ display: 'block' }} title={profile.modelPath}>
                      {profile.modelPath}
                    </span>
                  </td>
                  <td className="small">{shortImage(profile.image)}</td>
                  <td className="small mono">{profile.port}</td>
                  <td>
                    {profile.autostart ? (
                      <span className="badge badge-ok">an</span>
                    ) : (
                      <span className="badge">aus</span>
                    )}
                  </td>
                  <td>
                    <div className="row wrap" style={{ justifyContent: 'flex-end' }}>
                      <button
                        type="button"
                        className="btn btn-sm btn-primary"
                        disabled={launch.isPending}
                        onClick={() => launch.mutate(profile.id)}
                      >
                        Starten
                      </button>
                      <button type="button" className="btn btn-sm" onClick={() => setEditing(profile)}>
                        Bearbeiten
                      </button>
                      <button
                        type="button"
                        className="btn btn-sm btn-danger"
                        onClick={() => setPendingDelete(profile)}
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

      {editing ? (
        <ProfileDialog
          profile={editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null)
            queryClient.invalidateQueries({ queryKey: ['profiles'] })
          }}
        />
      ) : null}

      {pendingDelete ? (
        <ConfirmDialog
          title="Profil löschen"
          danger
          confirmLabel="Löschen"
          busy={remove.isPending}
          message={`Das Profil '${pendingDelete.name}' wird entfernt. Ein bereits laufender Container bleibt davon unberührt.`}
          onConfirm={() => remove.mutate(pendingDelete.id)}
          onClose={() => setPendingDelete(null)}
        />
      ) : null}
    </>
  )
}

function ProfileDialog({ profile, onClose, onSaved }) {
  const toast = useToast()
  const [form, setForm] = useState({ ...EMPTY, ...profile })
  const [showKey, setShowKey] = useState(false)
  const isNew = !profile.id

  const save = useMutation({
    mutationFn: (body) => (isNew ? post('/profiles', body) : put(`/profiles/${profile.id}`, body)),
    onSuccess: () => {
      toast.success(isNew ? 'Profil angelegt.' : 'Profil gespeichert.')
      onSaved()
    },
    onError: (err) => toast.error(err),
  })

  const set = (key) => (e) => {
    const value =
      e.target.type === 'checkbox'
        ? e.target.checked
        : e.target.type === 'number'
          ? Number(e.target.value)
          : e.target.value
    setForm((f) => ({ ...f, [key]: value }))
  }

  function submit(event) {
    event.preventDefault()
    const { id, createdAt, updatedAt, ...body } = form
    if (!body.apiKey) delete body.apiKey
    save.mutate(body)
  }

  return (
    <Modal
      title={isNew ? 'Profil anlegen' : `Profil bearbeiten: ${profile.name}`}
      wide
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn" onClick={onClose} disabled={save.isPending}>
            Abbrechen
          </button>
          <button
            type="submit"
            form="profile-form"
            className="btn btn-primary"
            disabled={save.isPending || !form.name || !form.modelPath}
          >
            {save.isPending ? 'Speichert …' : 'Speichern'}
          </button>
        </>
      }
    >
      <form id="profile-form" className="stack" onSubmit={submit}>
        <div className="field">
          <label>Modell</label>
          <ModelPicker value={form.modelPath} onChange={(modelPath) => setForm((f) => ({ ...f, modelPath }))} />
          {form.modelPath ? <p className="small mono faint">{form.modelPath}</p> : null}
        </div>

        <div className="form-grid">
          <div className="field">
            <label htmlFor="p-name">Name</label>
            <input id="p-name" type="text" required value={form.name} onChange={set('name')} />
            <span className="hint">Wird auch als Containername verwendet.</span>
          </div>
          <div className="field">
            <label htmlFor="p-port">Port</label>
            <input id="p-port" type="number" value={form.port} onChange={set('port')} />
          </div>
        </div>

        <div className="field">
          <label htmlFor="p-image">Image</label>
          <input id="p-image" type="text" value={form.image} onChange={set('image')} />
        </div>

        <div className="form-grid">
          <div className="field">
            <label htmlFor="p-ctx">Context Size</label>
            <input id="p-ctx" type="number" value={form.ctxSize} onChange={set('ctxSize')} />
          </div>
          <div className="field">
            <label htmlFor="p-ngl">GPU Layers</label>
            <input id="p-ngl" type="number" value={form.gpuLayers} onChange={set('gpuLayers')} />
          </div>
          <div className="field">
            <label htmlFor="p-threads">Threads</label>
            <input id="p-threads" type="number" value={form.threads} onChange={set('threads')} />
          </div>
        </div>

        <div className="field">
          <label htmlFor="p-key">API-Key</label>
          <div className="row">
            <input
              id="p-key"
              className="grow"
              type={showKey ? 'text' : 'password'}
              placeholder={isNew ? 'leer lassen für einen zufälligen Key' : 'unverändert lassen'}
              value={form.apiKey}
              onChange={set('apiKey')}
            />
            <button type="button" className="btn btn-sm" onClick={() => setShowKey((v) => !v)}>
              {showKey ? 'Verbergen' : 'Anzeigen'}
            </button>
            {form.apiKey ? (
              <button
                type="button"
                className="btn btn-sm"
                onClick={() => navigator.clipboard?.writeText(form.apiKey)}
              >
                Kopieren
              </button>
            ) : null}
          </div>
        </div>

        <div className="field">
          <label htmlFor="p-extra">Zusätzliche Argumente</label>
          <input
            id="p-extra"
            type="text"
            placeholder="leer lassen für die automatische Erkennung"
            value={form.extraArgs}
            onChange={set('extraArgs')}
          />
        </div>

        <label className="row small">
          <input
            type="checkbox"
            style={{ width: 'auto' }}
            checked={form.autostart}
            onChange={set('autostart')}
          />
          Beim Systemstart automatisch hochfahren
        </label>
      </form>
    </Modal>
  )
}
