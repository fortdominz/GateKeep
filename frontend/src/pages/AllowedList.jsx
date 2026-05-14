import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { api } from '../api.js'

export default function AllowedList() {
  const [faces,    setFaces]    = useState([])
  const [error,    setError]    = useState('')
  const [deleting, setDeleting] = useState(null)
  const navigate = useNavigate()

  useEffect(() => { load() }, [])

  async function load() {
    try {
      setFaces(await api.getAllowed())
      setError('')
    } catch (e) {
      setError(e.message)
    }
  }

  async function handleDelete(id, name) {
    if (!window.confirm(`Remove "${name}" from allowed list?`)) return
    setDeleting(id)
    try {
      await api.deleteAllowed(id)
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
          <div className="page-breadcrumb">GATEKEEP &gt; <span>Allowed List</span></div>
          <div className="page-title">Access List</div>
        </div>
        <button className="btn btn-primary" onClick={() => navigate('/enroll')} style={{ borderColor: 'var(--green)', background: 'rgba(0,230,118,0.1)', color: 'var(--green)' }}>
          + Enroll Authorized
        </button>
      </div>

      {/* Context note */}
      <div style={{
        fontFamily: 'var(--mono)', fontSize: 10, color: 'var(--text-dim)',
        background: 'var(--surface)', border: '1px solid var(--border)',
        borderLeft: '3px solid var(--green)', padding: '12px 16px',
        marginBottom: 16, letterSpacing: '0.1em', lineHeight: 1.8,
      }}>
        // Subjects on this list are treated as authorized personnel.<br />
        // Active in <span style={{ color: 'var(--green)' }}>Access Control</span> and <span style={{ color: 'var(--green)' }}>Combined</span> modes only.<br />
        // Unknown faces will trigger <span style={{ color: 'var(--amber)' }}>UNAUTHORIZED</span> alerts when these modes are on.
      </div>

      {error && <div className="error-msg">ERR: {error}</div>}

      <div className="panel">
        <div className="panel-title">
          Authorized Subjects — {faces.length} record{faces.length !== 1 ? 's' : ''}
        </div>

        {faces.length === 0 ? (
          <div className="empty-state">
            <div className="empty-label">// access list empty</div>
            <p>No authorized subjects enrolled</p>
            <div style={{ fontFamily: 'var(--mono)', fontSize: 10, color: 'var(--text-dim)', marginTop: 10, lineHeight: 1.8, letterSpacing: '0.08em' }}>
              Go to Enroll → select "Allowed List" to add authorized personnel
            </div>
            <button
              className="btn btn-ghost"
              onClick={() => navigate('/enroll')}
              style={{ marginTop: 18, borderColor: 'var(--green)', color: 'var(--green)' }}
            >
              Enroll Authorized Subject
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
                    <td className="mono-cell" style={{ color: 'var(--text-dim)' }}>#{String(f.id).padStart(4, '0')}</td>
                    <td style={{ fontWeight: 700, letterSpacing: '0.04em', color: 'var(--green)' }}>{f.name}</td>
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
