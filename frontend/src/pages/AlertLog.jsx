import { useState, useEffect, useCallback } from 'react'
import { api } from '../api.js'

const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:8090'

// ── Snapshot modal ───────────────────────────────────────────

function SnapshotModal({ log, onClose }) {
  useEffect(() => {
    const handler = (e) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [onClose])

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, zIndex: 9999,
        background: 'rgba(0,0,0,0.88)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        backdropFilter: 'blur(4px)',
      }}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{
          background: 'var(--surface)',
          border: '1px solid var(--border)',
          maxWidth: 680, width: '90%',
          position: 'relative',
        }}
      >
        {/* Header */}
        <div style={{
          padding: '12px 18px',
          borderBottom: '1px solid var(--border)',
          display: 'flex', justifyContent: 'space-between', alignItems: 'center',
          background: 'var(--surface2)',
        }}>
          <div>
            <div style={{ fontFamily: 'var(--mono)', fontSize: 9, color: 'var(--text-dim)', letterSpacing: '0.2em', textTransform: 'uppercase', marginBottom: 4 }}>
              // Evidence Record
            </div>
            <div style={{ fontFamily: 'var(--sans)', fontSize: 14, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--red)' }}>
              {log.matched_name || 'Unknown'}
            </div>
          </div>
          <button
            onClick={onClose}
            style={{
              background: 'none', border: '1px solid var(--border-hi)',
              color: 'var(--text-dim)', fontFamily: 'var(--mono)',
              fontSize: 11, padding: '4px 12px', cursor: 'pointer',
              letterSpacing: '0.1em',
            }}
          >
            [ESC]
          </button>
        </div>

        {/* Image */}
        <div style={{ background: '#000', position: 'relative' }}>
          <img
            src={`${API_BASE}${log.snapshot_url}`}
            alt={`Snapshot — ${log.matched_name}`}
            style={{ width: '100%', display: 'block', maxHeight: 480, objectFit: 'contain' }}
          />
          <div style={{
            position: 'absolute', inset: 0, pointerEvents: 'none',
            background: 'repeating-linear-gradient(0deg,transparent,transparent 3px,rgba(0,0,0,0.07) 3px,rgba(0,0,0,0.07) 4px)',
          }} />
          <div style={{
            position: 'absolute', bottom: 10, left: 12,
            fontFamily: 'var(--mono)', fontSize: 10,
            color: 'rgba(255,255,255,0.7)', textShadow: '0 1px 4px #000',
            letterSpacing: '0.1em',
          }}>
            {log.timestamp}
          </div>
          <div style={{
            position: 'absolute', top: 10, right: 12,
            fontFamily: 'var(--mono)', fontSize: 10,
            color: 'var(--red)', textShadow: '0 1px 4px #000',
          }}>
            ● REC
          </div>
        </div>

        {/* Meta row */}
        <div style={{
          display: 'grid', gridTemplateColumns: 'repeat(3,1fr)',
          borderTop: '1px solid var(--border)',
        }}>
          {[
            ['Subject',    log.matched_name || '—'],
            ['Confidence', log.similarity ? `${(log.similarity * 100).toFixed(1)}%` : '—'],
            ['Camera',     log.camera_id || '—'],
          ].map(([label, val]) => (
            <div key={label} style={{ padding: '12px 16px', borderRight: '1px solid var(--border)' }}>
              <div style={{ fontFamily: 'var(--mono)', fontSize: 9, color: 'var(--text-dim)', letterSpacing: '0.18em', textTransform: 'uppercase', marginBottom: 4 }}>{label}</div>
              <div style={{ fontFamily: 'var(--mono)', fontSize: 13, color: 'var(--text)', fontWeight: 600 }}>{val}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

// ── Main page ────────────────────────────────────────────────

export default function AlertLog() {
  const [logs, setLogs]             = useState([])
  const [alertsOnly, setAlertsOnly] = useState(false)
  const [limit, setLimit]           = useState(50)
  const [error, setError]           = useState('')
  const [loading, setLoading]       = useState(false)
  const [activeSnap, setActiveSnap] = useState(null)

  useEffect(() => { load() }, [alertsOnly, limit])

  async function load() {
    setLoading(true)
    try {
      setLogs(await api.getLogs(limit, alertsOnly))
      setError('')
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }

  const alertCount   = logs.filter(l => l.matched_id !== null).length
  const unknownCount = logs.length - alertCount
  const evidenceCount = logs.filter(l => l.matched_id !== null && l.snapshot_url).length

  const closeModal = useCallback(() => setActiveSnap(null), [])

  return (
    <div>
      {activeSnap && <SnapshotModal log={activeSnap} onClose={closeModal} />}

      <div className="page-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end' }}>
        <div>
          <div className="page-breadcrumb">GATEKEEP &gt; <span>Alert Log</span></div>
          <div className="page-title">Detection Log</div>
        </div>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
          <label style={{
            display: 'flex', alignItems: 'center', gap: 7,
            fontFamily: 'var(--mono)', fontSize: 10, color: 'var(--text-mid)',
            letterSpacing: '0.12em', textTransform: 'uppercase', margin: 0, cursor: 'pointer',
          }}>
            <input type="checkbox" checked={alertsOnly} onChange={e => setAlertsOnly(e.target.checked)} />
            Alerts Only
          </label>
          <select value={limit} onChange={e => setLimit(Number(e.target.value))} style={{ width: 'auto' }}>
            <option value={25}>Last 25</option>
            <option value={50}>Last 50</option>
            <option value={100}>Last 100</option>
            <option value={500}>Last 500</option>
          </select>
          <button className="btn btn-ghost" onClick={load} disabled={loading} style={{ fontSize: 11 }}>
            {loading ? '...' : 'Refresh'}
          </button>
        </div>
      </div>

      {error && <div className="error-msg">ERR: {error}</div>}

      {/* Summary row */}
      <div style={{
        display: 'flex', gap: 24, marginBottom: 12,
        fontFamily: 'var(--mono)', fontSize: 10, color: 'var(--text-dim)', letterSpacing: '0.12em',
      }}>
        <span>RECORDS: <span style={{ color: 'var(--text-mid)' }}>{logs.length}</span></span>
        <span>ALERTS: <span style={{ color: alertCount > 0 ? 'var(--red)' : 'var(--text-mid)' }}>{alertCount}</span></span>
        <span>UNKNOWN: <span style={{ color: 'var(--text-mid)' }}>{unknownCount}</span></span>
        <span>EVIDENCE: <span style={{ color: evidenceCount > 0 ? 'var(--amber)' : 'var(--text-mid)' }}>
          {evidenceCount} snapshot{evidenceCount !== 1 ? 's' : ''}
        </span></span>
        {evidenceCount > 0 && (
          <span style={{ color: 'var(--text-dim)', fontStyle: 'italic' }}>
            — <a href="/admin" style={{ color: 'var(--amber)', textDecoration: 'none' }}>view in Admin → Evidence</a>
          </span>
        )}
      </div>

      {/* Event table */}
      <div className="panel">
        <div className="panel-title">Event Records</div>
        {logs.length === 0 ? (
          <div className="empty-state">
            <div className="empty-label">// no records</div>
            <p>{loading ? 'Loading...' : 'No detection events logged yet'}</p>
          </div>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Timestamp</th>
                  <th>Camera</th>
                  <th>Event</th>
                  <th>Subject</th>
                  <th>Confidence</th>
                  <th>Evidence</th>
                </tr>
              </thead>
              <tbody>
                {logs.map(log => {
                  const isAlert = log.matched_id !== null
                  return (
                    <tr key={log.id} className={isAlert ? 'alert-row' : ''}>
                      <td className="mono-cell">{log.timestamp}</td>
                      <td className="mono-cell" style={{ color: 'var(--text-dim)' }}>{log.camera_id}</td>
                      <td>
                        {isAlert
                          ? <span className="badge badge-red">Alert</span>
                          : <span className="badge badge-gray">Unknown</span>
                        }
                      </td>
                      <td style={{ fontWeight: isAlert ? 700 : 400 }}>
                        {log.matched_name || '—'}
                      </td>
                      <td>
                        {isAlert
                          ? <span style={{ fontFamily: 'var(--mono)', fontSize: 12, color: 'var(--red)', fontWeight: 700 }}>
                              {(log.similarity * 100).toFixed(1)}%
                            </span>
                          : <span style={{ color: 'var(--text-dim)' }}>—</span>
                        }
                      </td>
                      <td>
                        {log.snapshot_url ? (
                          <button
                            className="btn btn-ghost"
                            onClick={() => setActiveSnap(log)}
                            style={{ fontSize: 10, padding: '4px 10px', letterSpacing: '0.1em' }}
                          >
                            ⊙ View
                          </button>
                        ) : (
                          <span style={{ color: 'var(--text-dim)', fontFamily: 'var(--mono)', fontSize: 10 }}>—</span>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}
