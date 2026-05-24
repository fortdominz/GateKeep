import { useState, useRef } from 'react'
import { getSessionId } from '../api.js'

export default function Enroll() {
  const [name, setName]         = useState('')
  const [notes, setNotes]       = useState('')
  const [listType, setListType] = useState('banned')   // 'banned' | 'allowed'
  const [file, setFile]         = useState(null)
  const [preview, setPreview]   = useState(null)
  const [dragging, setDragging] = useState(false)
  const [loading, setLoading]   = useState(false)
  const [error, setError]       = useState('')
  const [success, setSuccess]   = useState('')
  const fileInput = useRef(null)

  function handleFile(f) {
    if (!f || !f.type.startsWith('image/')) {
      setError('Invalid file type. Use JPG, PNG, or WEBP.')
      return
    }
    setFile(f)
    setError('')
    const reader = new FileReader()
    reader.onload = e => setPreview(e.target.result)
    reader.readAsDataURL(f)
  }

  function onDrop(e) {
    e.preventDefault()
    setDragging(false)
    const f = e.dataTransfer.files[0]
    if (f) handleFile(f)
  }

  async function handleSubmit(e) {
    e.preventDefault()
    if (!name.trim()) { setError('Subject name is required.'); return }
    if (!file)        { setError('Upload an image first.'); return }

    setLoading(true)
    setError('')
    setSuccess('')

    try {
      const formData = new FormData()
      formData.append('session_id', getSessionId())
      formData.append('name',       name.trim())
      formData.append('notes',      notes.trim())
      formData.append('list_type',  listType)
      formData.append('image',      file)

      const BASE = (import.meta.env.VITE_API_URL || '') + '/api'
      const res = await fetch(`${BASE}/enroll`, { method: 'POST', body: formData })

      if (!res.ok) {
        const err = await res.json().catch(() => ({ detail: res.statusText }))
        throw new Error(err.detail || 'Enrollment failed')
      }

      const data = await res.json()
      const listLabel = data.list_type === 'allowed' ? 'Allowed List' : 'Banned List'
      setSuccess(`"${data.name}" enrolled to ${listLabel} — ID #${String(data.id).padStart(4,'0')}  confidence ${(data.det_score * 100).toFixed(1)}%`)
      setName('')
      setNotes('')
      setFile(null)
      setPreview(null)
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div>
      <div className="page-header">
        <div className="page-breadcrumb">GATEKEEP &gt; <span>Enroll</span></div>
        <div className="page-title">Enroll Subject</div>
      </div>

      <div className="two-col" style={{ maxWidth: 900 }}>
        <div className="panel">
          <div className="panel-title">Subject Details</div>

          {error   && <div className="error-msg">{error}</div>}
          {success && <div className="success-msg">{success}</div>}

          <form onSubmit={handleSubmit}>
            <div className="form-group">
              <label>Full Name *</label>
              <input
                type="text"
                value={name}
                onChange={e => setName(e.target.value)}
                placeholder="e.g. John Doe"
                disabled={loading}
              />
            </div>

            <div className="form-group">
              <label>Notes (optional)</label>
              <input
                type="text"
                value={notes}
                onChange={e => setNotes(e.target.value)}
                placeholder="Incident reference, date, location..."
                disabled={loading}
              />
            </div>

            <div className="form-group">
              <label>Enroll To *</label>
              <div style={{ display: 'flex', gap: 0, border: '1px solid var(--border)', overflow: 'hidden' }}>
                {[
                  { key: 'banned',  label: 'Banned List',   desc: 'Will trigger alerts',  color: 'var(--red)'   },
                  { key: 'allowed', label: 'Allowed List',  desc: 'Authorized personnel', color: 'var(--green)' },
                ].map(opt => (
                  <button
                    key={opt.key}
                    type="button"
                    onClick={() => setListType(opt.key)}
                    disabled={loading}
                    style={{
                      flex: 1, padding: '12px 16px', border: 'none',
                      borderRight: '1px solid var(--border)',
                      background: listType === opt.key ? `${opt.color}14` : 'none',
                      borderBottom: listType === opt.key ? `2px solid ${opt.color}` : '2px solid transparent',
                      color: listType === opt.key ? opt.color : 'var(--text-dim)',
                      fontFamily: 'var(--mono)', fontSize: 10, letterSpacing: '0.14em',
                      textTransform: 'uppercase', cursor: 'pointer', textAlign: 'left',
                      transition: 'all 0.15s',
                    }}
                  >
                    <div style={{ fontWeight: 600 }}>{opt.label}</div>
                    <div style={{ fontSize: 8, opacity: 0.7, marginTop: 2, letterSpacing: '0.08em' }}>{opt.desc}</div>
                  </button>
                ))}
              </div>
            </div>

            <div className="form-group">
              <label>Reference Photo *</label>
              <div
                className={`drop-zone${dragging ? ' drag-over' : ''}`}
                onClick={() => fileInput.current?.click()}
                onDragOver={e => { e.preventDefault(); setDragging(true) }}
                onDragLeave={() => setDragging(false)}
                onDrop={onDrop}
              >
                {file ? (
                  <span>{file.name} &nbsp;({(file.size / 1024).toFixed(0)} KB)</span>
                ) : (
                  <>
                    <div style={{ fontSize: 24, marginBottom: 10, opacity: 0.3 }}>[ DROP IMAGE ]</div>
                    <div>Click to browse or drag and drop</div>
                    <div style={{ marginTop: 4, fontSize: 9, opacity: 0.5 }}>JPG · PNG · WEBP</div>
                  </>
                )}
              </div>
              <input
                ref={fileInput}
                type="file"
                accept="image/*"
                style={{ display: 'none' }}
                onChange={e => handleFile(e.target.files[0])}
              />
            </div>

            <button
              type="submit"
              className="btn btn-primary"
              disabled={loading || !name.trim() || !file}
              style={{ width: '100%', justifyContent: 'center' }}
            >
              {loading ? 'Processing...' : 'Enroll Subject'}
            </button>
          </form>
        </div>

        <div className="panel-secondary">
          <div className="panel-title">Preview</div>
          {preview ? (
            <img
              src={preview}
              alt="Preview"
              style={{
                width: '100%',
                border: '1px solid var(--border)',
                objectFit: 'contain',
                maxHeight: 280,
                display: 'block',
              }}
            />
          ) : (
            <div className="empty-state" style={{ padding: 40 }}>
              <div className="empty-label">// no image</div>
              <p>No photo selected</p>
            </div>
          )}

          <div style={{ marginTop: 20 }}>
            <div className="panel-title">Photo Requirements</div>
            <div style={{ fontFamily: 'var(--mono)', fontSize: 10, color: 'var(--text-dim)', lineHeight: 2.2, letterSpacing: '0.08em' }}>
              {[
                'Face clearly visible, front-facing',
                'Even lighting, no heavy shadows',
                'Single subject in frame',
                'No sunglasses or face coverings',
                'Minimum 200x200 px recommended',
              ].map(tip => (
                <div key={tip} style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
                  <span style={{ color: 'var(--red)', flexShrink: 0 }}>{'>'}</span>
                  <span>{tip}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
