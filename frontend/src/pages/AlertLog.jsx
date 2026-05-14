import { useState, useEffect, useCallback } from 'react'
import { api } from '../api.js'

const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:8090'

// ── Log type config ──────────────────────────────────────────

const LOG_TYPES = [
  { key: 'all',          label: 'All Logs',      color: 'var(--text-mid)',  badge: 'badge-gray'   },
  { key: 'BANNED_ALERT', label: 'Banned Alerts', color: 'var(--red)',       badge: 'badge-red'    },
  { key: 'UNAUTHORIZED', label: 'Unauthorized',  color: 'var(--amber)',     badge: 'badge-amber'  },
  { key: 'KNOWN_ENTRY',  label: 'Known Entries', color: 'var(--green)',     badge: 'badge-green'  },
  { key: 'UNKNOWN',      label: 'Unknown',       color: 'var(--text-dim)',  badge: 'badge-gray'   },
]

function logTypeMeta(key) {
  return LOG_TYPES.find(t => t.key === key) || LOG_TYPES[0]
}

// ── Snapshot modal ───────────────────────────────────────────

function SnapshotModal({ log, onClose }) {
  useEffect(() => {
    const h = (e) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
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
        style={{ background: 'var(--surface)', border: '1px solid var(--border)', maxWidth: 680, width: '90%' }}
      >
        <div style={{
          padding: '12px 18px', borderBottom: '1px solid var(--border)',
          display: 'flex', justifyContent: 'space-between', alignItems: 'center',
          background: 'var(--surface2)',
        }}>
          <div>
            <div style={{ fontFamily: 'var(--mono)', fontSize: 9, color: 'var(--text-dim)', letterSpacing: '0.2em', textTransform: 'uppercase', marginBottom: 4 }}>
              // Evidence Record — {log.log_type || 'UNKNOWN'}
            </div>
            <div style={{ fontFamily: 'var(--sans)', fontSize: 14, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: logTypeMeta(log.log_type).color }}>
              {log.matched_name || 'Unauthorized / Unknown'}
            </div>
          </div>
          <button onClick={onClose} style={{ background: 'none', border: '1px solid var(--border-hi)', color: 'var(--text-dim)', fontFamily: 'var(--mono)', fontSize: 11, padding: '4px 12px', cursor: 'pointer' }}>
            [ESC]
          </button>
        </div>

        <div style={{ background: '#000', position: 'relative' }}>
          <img
            src={`${API_BASE}${log.snapshot_url}`}
            alt={log.matched_name || 'Evidence'}
            style={{ width: '100%', display: 'block', maxHeight: 480, objectFit: 'contain' }}
          />
          <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none', background: 'repeating-linear-gradient(0deg,transparent,transparent 3px,rgba(0,0,0,0.07) 3px,rgba(0,0,0,0.07) 4px)' }} />
          <div style={{ position: 'absolute', bottom: 10, left: 12, fontFamily: 'var(--mono)', fontSize: 10, color: 'rgba(255,255,255,0.7)', textShadow: '0 1px 4px #000' }}>{log.timestamp}</div>
          <div style={{ position: 'absolute', top: 10, right: 12, fontFamily: 'var(--mono)', fontSize: 10, color: 'var(--red)', textShadow: '0 1px 4px #000' }}>● REC</div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', borderTop: '1px solid var(--border)' }}>
          {[
            ['Type',       log.log_type || '—'],
            ['Subject',    log.matched_name || '—'],
            ['Confidence', log.similarity ? `${(log.similarity * 100).toFixed(1)}%` : '—'],
            ['Camera',     log.camera_id || '—'],
          ].map(([label, val]) => (
            <div key={label} style={{ padding: '10px 14px', borderRight: '1px solid var(--border)' }}>
              <div style={{ fontFamily: 'var(--mono)', fontSize: 9, color: 'var(--text-dim)', letterSpacing: '0.18em', textTransform: 'uppercase', marginBottom: 4 }}>{label}</div>
              <div style={{ fontFamily: 'var(--mono)', fontSize: 12, color: 'var(--text)', fontWeight: 600 }}>{val}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

// ── Log table ────────────────────────────────────────────────

function LogTable({ logs, onView, loading }) {
  if (loading) return <div className="empty-state"><p>Loading...</p></div>
  if (logs.length === 0) return (
    <div className="empty-state">
      <div className="empty-label">// no records</div>
      <p>No events match this filter</p>
    </div>
  )

  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            <th>Timestamp</th>
            <th>Mode</th>
            <th>Type</th>
            <th>Subject</th>
            <th>Confidence</th>
            <th>Camera</th>
            <th>Evidence</th>
          </tr>
        </thead>
        <tbody>
          {logs.map(log => {
            const meta = logTypeMeta(log.log_type)
            const isAlert = log.log_type === 'BANNED_ALERT' || log.log_type === 'UNAUTHORIZED'
            return (
              <tr key={log.id} className={isAlert ? 'alert-row' : ''}>
                <td className="mono-cell">{log.timestamp?.slice(0, 19)}</td>
                <td className="mono-cell" style={{ color: 'var(--text-dim)', fontSize: 10 }}>
                  {log.detection_mode?.replace('_', ' ') || '—'}
                </td>
                <td>
                  <span
                    className={`badge ${meta.badge}`}
                    style={{ color: meta.color, borderColor: meta.color, background: `${meta.color}12` }}
                  >
                    {log.log_type || 'UNKNOWN'}
                  </span>
                </td>
                <td style={{ fontWeight: isAlert ? 700 : 400 }}>
                  {log.matched_name || (log.log_type === 'UNAUTHORIZED' ? '— Unauthorized —' : '—')}
                </td>
                <td>
                  {log.similarity > 0
                    ? <span style={{ fontFamily: 'var(--mono)', fontSize: 12, color: meta.color, fontWeight: 700 }}>
                        {(log.similarity * 100).toFixed(1)}%
                      </span>
                    : <span style={{ color: 'var(--text-dim)' }}>—</span>
                  }
                </td>
                <td className="mono-cell" style={{ color: 'var(--text-dim)' }}>{log.camera_id}</td>
                <td>
                  {log.snapshot_url
                    ? <button className="btn btn-ghost" onClick={() => onView(log)} style={{ fontSize: 10, padding: '4px 10px' }}>⊙ View</button>
                    : <span style={{ color: 'var(--text-dim)', fontFamily: 'var(--mono)', fontSize: 10 }}>—</span>
                  }
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

// ── Main page ────────────────────────────────────────────────

export default function AlertLog() {
  const [logs,       setLogs]       = useState([])
  const [limit,      setLimit]      = useState(50)
  const [activeType, setActiveType] = useState('all')    // filter tab
  const [viewMode,   setViewMode]   = useState('combined') // 'combined' | 'split'
  const [error,      setError]      = useState('')
  const [loading,    setLoading]    = useState(false)
  const [activeSnap, setActiveSnap] = useState(null)

  useEffect(() => { load() }, [limit, activeType])

  async function load() {
    setLoading(true)
    try {
      const data = await api.getLogs(limit, false, activeType)
      setLogs(data)
      setError('')
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }

  const closeModal = useCallback(() => setActiveSnap(null), [])

  // Split logs by type for split-view
  const byType = {
    BANNED_ALERT: logs.filter(l => l.log_type === 'BANNED_ALERT'),
    UNAUTHORIZED: logs.filter(l => l.log_type === 'UNAUTHORIZED'),
    KNOWN_ENTRY:  logs.filter(l => l.log_type === 'KNOWN_ENTRY'),
    UNKNOWN:      logs.filter(l => l.log_type === 'UNKNOWN'),
  }

  // Summary counts from current loaded set
  const counts = {
    total:         logs.length,
    BANNED_ALERT:  byType.BANNED_ALERT.length,
    UNAUTHORIZED:  byType.UNAUTHORIZED.length,
    KNOWN_ENTRY:   byType.KNOWN_ENTRY.length,
    UNKNOWN:       byType.UNKNOWN.length,
  }

  return (
    <div>
      {activeSnap && <SnapshotModal log={activeSnap} onClose={closeModal} />}

      <div className="page-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end' }}>
        <div>
          <div className="page-breadcrumb">GATEKEEP &gt; <span>Alert Log</span></div>
          <div className="page-title">Detection Log</div>
        </div>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
          {/* View mode toggle */}
          <div style={{ display: 'flex', border: '1px solid var(--border)', overflow: 'hidden' }}>
            {['combined', 'split'].map(vm => (
              <button
                key={vm}
                onClick={() => setViewMode(vm)}
                style={{
                  background: viewMode === vm ? 'var(--surface3)' : 'none',
                  border: 'none', borderRight: '1px solid var(--border)',
                  color: viewMode === vm ? 'var(--text)' : 'var(--text-dim)',
                  fontFamily: 'var(--mono)', fontSize: 10, padding: '6px 14px',
                  cursor: 'pointer', letterSpacing: '0.1em', textTransform: 'uppercase',
                }}
              >
                {vm}
              </button>
            ))}
          </div>
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

      {/* Summary chips */}
      <div style={{ display: 'flex', gap: 20, marginBottom: 14, fontFamily: 'var(--mono)', fontSize: 10, color: 'var(--text-dim)', letterSpacing: '0.12em', flexWrap: 'wrap' }}>
        <span>TOTAL: <span style={{ color: 'var(--text-mid)' }}>{counts.total}</span></span>
        <span style={{ color: 'var(--red)' }}>BANNED: {counts.BANNED_ALERT}</span>
        <span style={{ color: 'var(--amber)' }}>UNAUTHORIZED: {counts.UNAUTHORIZED}</span>
        <span style={{ color: 'var(--green)' }}>KNOWN: {counts.KNOWN_ENTRY}</span>
        <span>UNKNOWN: {counts.UNKNOWN}</span>
        {counts.BANNED_ALERT + counts.UNAUTHORIZED > 0 && (
          <a href="/admin" style={{ color: 'var(--amber)', textDecoration: 'none', marginLeft: 'auto' }}>
            ⬡ View evidence in Admin →
          </a>
        )}
      </div>

      {viewMode === 'combined' ? (
        /* ── COMBINED view ── */
        <div className="panel">
          {/* Filter tabs */}
          <div style={{ display: 'flex', gap: 0, marginBottom: 16, borderBottom: '1px solid var(--border)', marginTop: -4 }}>
            {LOG_TYPES.map(t => (
              <button
                key={t.key}
                onClick={() => { setActiveType(t.key); }}
                style={{
                  background: 'none', border: 'none',
                  borderBottom: activeType === t.key ? `2px solid ${t.color}` : '2px solid transparent',
                  color: activeType === t.key ? t.color : 'var(--text-dim)',
                  fontFamily: 'var(--mono)', fontSize: 10, letterSpacing: '0.14em',
                  textTransform: 'uppercase', padding: '10px 16px',
                  cursor: 'pointer', marginBottom: -1, whiteSpace: 'nowrap',
                }}
              >
                {t.label}
                {t.key !== 'all' && (
                  <span style={{ marginLeft: 6, opacity: 0.7 }}>
                    ({counts[t.key] ?? 0})
                  </span>
                )}
              </button>
            ))}
          </div>
          <LogTable logs={logs} onView={setActiveSnap} loading={loading} />
        </div>
      ) : (
        /* ── SPLIT view ── */
        <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          {[
            { key: 'BANNED_ALERT', label: 'Banned Alerts',    color: 'var(--red)'      },
            { key: 'UNAUTHORIZED', label: 'Unauthorized Entry', color: 'var(--amber)'  },
            { key: 'KNOWN_ENTRY',  label: 'Known Entries',     color: 'var(--green)'   },
            { key: 'UNKNOWN',      label: 'Unknown Faces',     color: 'var(--text-dim)' },
          ].map(section => (
            <SplitSection
              key={section.key}
              label={section.label}
              color={section.color}
              logs={byType[section.key]}
              onView={setActiveSnap}
              loading={loading}
            />
          ))}
        </div>
      )}
    </div>
  )
}

// ── Split view section (collapsible per type) ─────────────────

function SplitSection({ label, color, logs, onView, loading }) {
  const [open, setOpen] = useState(true)

  return (
    <div className="panel" style={{ border: `1px solid ${color}22` }}>
      <div
        onClick={() => setOpen(o => !o)}
        style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          cursor: 'pointer', userSelect: 'none',
          margin: '-20px -20px 0', padding: '12px 20px',
          borderBottom: open ? '1px solid var(--border)' : 'none',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{ width: 6, height: 6, background: color, transform: 'rotate(45deg)' }} />
          <span style={{ fontFamily: 'var(--mono)', fontSize: 10, letterSpacing: '0.18em', textTransform: 'uppercase', color }}>
            {label}
          </span>
          <span style={{ fontFamily: 'var(--mono)', fontSize: 9, color: 'var(--text-dim)', background: 'var(--surface3)', padding: '1px 7px', letterSpacing: '0.1em' }}>
            {logs.length}
          </span>
        </div>
        <span style={{ fontFamily: 'var(--mono)', fontSize: 10, color: 'var(--text-dim)', display: 'inline-block', transform: open ? 'rotate(180deg)' : 'none', transition: 'transform 0.2s' }}>▼</span>
      </div>

      {open && (
        <div style={{ marginTop: 16 }}>
          <LogTable logs={logs} onView={onView} loading={loading} />
        </div>
      )}
    </div>
  )
}
