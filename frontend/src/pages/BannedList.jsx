import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { api } from '../api.js'

export default function BannedList() {
  const [faces, setFaces]       = useState([])
  const [error, setError]       = useState('')
  const [deleting, setDeleting] = useState(null)
  const navigate = useNavigate()

  useEffect(() => { load() }, [])

  async function load() {
    try {
      setFaces(await api.getBanned())
      setError('')
    } catch (e) {
      setError(e.message)
    }
  }

  async function handleDelete(id, name) {
    if (!window.confirm(`Remove "${name}" from watchlist?`)) return
    setDeleting(id)
    try {
      await api.deleteBanned(id)
      setFaces(prev => prev.filter(f => f.id !== id))
    } catch (e) {
      setError(e.message)
    } finally {
      setDeleting(null)
    }
  }

  return (
    <div>
      <div className="page-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end' }}>
        <div>
          <div className="page-breadcrumb">GATEKEEP &gt; <span>Watchlist</span></div>
          <div className="page-title">Banned List</div>
        </div>
        <button className="btn btn-primary" onClick={() => navigate('/enroll')}>
          + Enroll New
        </button>
      </div>

      {error && <div className="error-msg">ERR: {error}</div>}

      <div className="panel">
        <div className="panel-title">
          Enrolled Subjects — {faces.length} record{faces.length !== 1 ? 's' : ''}
        </div>

        {faces.length === 0 ? (
          <div className="empty-state">
            <div className="empty-label">// watchlist empty</div>
            <p>No subjects enrolled</p>
            <button
              className="btn btn-ghost"
              onClick={() => navigate('/enroll')}
              style={{ marginTop: 18 }}
            >
              Enroll First Subject
            </button>
          </div>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>ID</th>
                  <th>Subject Name</th>
                  <th>Notes</th>
                  <th>Enrolled</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {faces.map(f => (
                  <tr key={f.id}>
                    <td className="mono-cell" style={{ color: 'var(--text-dim)' }}>#{String(f.id).padStart(4,'0')}</td>
                    <td style={{ fontWeight: 700, letterSpacing: '0.04em' }}>{f.name}</td>
                    <td style={{ color: 'var(--text-mid)', fontFamily: 'var(--mono)', fontSize: 11 }}>{f.notes || '—'}</td>
                    <td className="mono-cell" style={{ color: 'var(--text-dim)' }}>{f.added_at?.slice(0, 10)}</td>
                    <td>
                      <button
                        className="btn btn-danger"
                        style={{ padding: '5px 12px', fontSize: 11 }}
                        onClick={() => handleDelete(f.id, f.name)}
                        disabled={deleting === f.id}
                      >
                        {deleting === f.id ? 'Removing...' : 'Remove'}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}
