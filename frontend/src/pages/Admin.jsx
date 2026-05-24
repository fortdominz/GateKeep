import { useState, useEffect, useCallback } from 'react'
import { api } from '../api.js'

const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:8090'

// ── Shared style + components ─────────────────────────────────

const mono9 = {
  fontFamily: 'var(--mono)', fontSize: 9, letterSpacing: '0.18em',
  textTransform: 'uppercase', color: 'var(--text-dim)',
}

function SectionTitle({ children }) {
  return (
    <div style={{ ...mono9, marginBottom: 14, borderBottom: '1px solid var(--border)', paddingBottom: 8 }}>
      // {children}
    </div>
  )
}

function Msg({ text }) {
  if (!text) return null
  const ok = text.startsWith('✓')
  return (
    <div style={{
      fontFamily: 'var(--mono)', fontSize: 11,
      color: ok ? 'var(--green)' : 'var(--red)',
      background: ok ? 'var(--green-dim)' : 'rgba(255,32,32,0.1)',
      border: `1px solid ${ok ? 'rgba(0,230,118,0.2)' : 'rgba(255,32,32,0.2)'}`,
      padding: '10px 16px', letterSpacing: '0.1em', marginBottom: 16,
    }}>
      {text}
    </div>
  )
}

function InfoRow({ label, val, color }) {
  return (
    <div className="info-row">
      <span className="info-key">{label}</span>
      <span className="info-val" style={color ? { color } : {}}>{val ?? '—'}</span>
    </div>
  )
}

// ── Snapshot modal ─────────────────────────────────────────────

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
        style={{
          background: 'var(--surface)',
          border: '1px solid var(--border)',
          maxWidth: 680, width: '90%',
          position: 'relative',
        }}
      >
        <div style={{
          padding: '12px 18px', borderBottom: '1px solid var(--border)',
          display: 'flex', justifyContent: 'space-between', alignItems: 'center',
          background: 'var(--surface2)',
        }}>
          <div>
            <div style={{ ...mono9, marginBottom: 4 }}>// Evidence Record</div>
            <div style={{ fontFamily: 'var(--sans)', fontSize: 14, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--red)' }}>
              {log.matched_name || 'Unknown'}
            </div>
          </div>
          <button
            onClick={onClose}
            style={{ background: 'none', border: '1px solid var(--border-hi)', color: 'var(--text-dim)', fontFamily: 'var(--mono)', fontSize: 11, padding: '4px 12px', cursor: 'pointer', letterSpacing: '0.1em' }}
          >
            [ESC]
          </button>
        </div>

        <div style={{ background: '#000', position: 'relative' }}>
          <img
            src={`${API_BASE}${log.snapshot_url}`}
            alt={log.matched_name}
            style={{ width: '100%', display: 'block', maxHeight: 480, objectFit: 'contain' }}
          />
          <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none', background: 'repeating-linear-gradient(0deg,transparent,transparent 3px,rgba(0,0,0,0.07) 3px,rgba(0,0,0,0.07) 4px)' }} />
          <div style={{ position: 'absolute', bottom: 10, left: 12, fontFamily: 'var(--mono)', fontSize: 10, color: 'rgba(255,255,255,0.7)', textShadow: '0 1px 4px #000', letterSpacing: '0.1em' }}>
            {log.timestamp}
          </div>
          <div style={{ position: 'absolute', top: 10, right: 12, fontFamily: 'var(--mono)', fontSize: 10, color: 'var(--red)', textShadow: '0 1px 4px #000' }}>
            ● REC
          </div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', borderTop: '1px solid var(--border)' }}>
          {[
            ['Subject',    log.matched_name || '—'],
            ['Confidence', log.similarity ? `${(log.similarity * 100).toFixed(1)}%` : '—'],
            ['Camera',     log.camera_id || '—'],
          ].map(([label, val]) => (
            <div key={label} style={{ padding: '12px 16px', borderRight: '1px solid var(--border)' }}>
              <div style={{ ...mono9, marginBottom: 4 }}>{label}</div>
              <div style={{ fontFamily: 'var(--mono)', fontSize: 13, color: 'var(--text)', fontWeight: 600 }}>{val}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

// ── Evidence helpers ───────────────────────────────────────────

const UNIT_TO_MINUTES = {
  minutes: 1, hours: 60, days: 1440, weeks: 10080, months: 43200, years: 525600,
}

const INTERVAL_PRESETS = [
  { label: 'All',      value: 'all'    },
  { label: '5 Min',    value: 5        },
  { label: '10 Min',   value: 10       },
  { label: '30 Min',   value: 30       },
  { label: '1 Hour',   value: 60       },
  { label: '6 Hours',  value: 360      },
  { label: '12 Hours', value: 720      },
  { label: '1 Day',    value: 1440     },
  { label: '1 Week',   value: 10080    },
  { label: '1 Month',  value: 43200    },
  { label: 'Custom…',  value: 'custom' },
]

function bucketLabel(bucketStart, intervalMinutes) {
  const d   = new Date(bucketStart)
  const end = new Date(d.getTime() + intervalMinutes * 60000)
  const pad = n => String(n).padStart(2, '0')
  const fmtDate = dt => dt.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
  const fmtTime = dt => `${pad(dt.getHours())}:${pad(dt.getMinutes())}`

  if (intervalMinutes >= 525600) return d.getFullYear().toString()
  if (intervalMinutes >= 43200)  return d.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' })
  if (intervalMinutes >= 10080)  return `${fmtDate(d)} – ${fmtDate(end)}`
  if (intervalMinutes >= 1440)   return d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' })
  const dateStr = d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
  return `${dateStr}  ${fmtTime(d)} – ${fmtTime(end)}`
}

function groupEvidence(logs, intervalMinutes, sortDir) {
  if (intervalMinutes === null) {
    const sorted = [...logs].sort((a, b) =>
      sortDir === 'desc'
        ? new Date(b.timestamp) - new Date(a.timestamp)
        : new Date(a.timestamp) - new Date(b.timestamp)
    )
    return [{ bucketStart: null, logs: sorted }]
  }
  const bucketMs = intervalMinutes * 60 * 1000
  const map = {}
  for (const log of logs) {
    const key = Math.floor(new Date(log.timestamp).getTime() / bucketMs) * bucketMs
    if (!map[key]) map[key] = { bucketStart: key, logs: [] }
    map[key].logs.push(log)
  }
  return Object.values(map).sort((a, b) =>
    sortDir === 'desc' ? b.bucketStart - a.bucketStart : a.bucketStart - b.bucketStart
  )
}

// ── Overview tab ───────────────────────────────────────────────

const LOG_TYPE_COLOR = {
  BANNED_ALERT: 'var(--red)',
  UNKNOWN:      'var(--text-dim)',
  KNOWN_ENTRY:  'var(--green)',
  UNAUTHORIZED: 'var(--amber)',
}

function OverviewTab() {
  const [stats,   setStats]   = useState(null)
  const [logs,    setLogs]    = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => { load() }, [])

  async function load() {
    setLoading(true)
    try {
      const [s, l] = await Promise.all([api.stats(), api.getLogs(10)])
      setStats(s)
      setLogs(l)
    } catch {}
    setLoading(false)
  }

  const threat = stats?.current_threat || 'NOMINAL'
  const threatColor = { NOMINAL: 'var(--green)', LOW: 'var(--amber)', ELEVATED: 'var(--amber)', HIGH: 'var(--red)', CRITICAL: 'var(--red)' }[threat] || 'var(--text-mid)'

  if (loading) return <div className="empty-state"><p>Loading system status...</p></div>

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>

      {/* Threat Level banner */}
      <div style={{ padding: '20px 24px', background: 'var(--surface2)', border: `1px solid ${threatColor}`, display: 'flex', alignItems: 'center', gap: 20, flexWrap: 'wrap' }}>
        <div>
          <div style={{ ...mono9, marginBottom: 6 }}>Current Threat Level</div>
          <div style={{ fontFamily: 'var(--mono)', fontSize: 32, fontWeight: 700, color: threatColor, letterSpacing: '0.05em' }}>
            {threat}
          </div>
        </div>
        <div style={{ marginLeft: 'auto', display: 'flex', flexDirection: 'column', gap: 4, alignItems: 'flex-end' }}>
          <div style={{ ...mono9 }}>Mode: <span style={{ color: 'var(--text-mid)' }}>{stats?.detection_mode || 'BANNED_ONLY'}</span></div>
          <div style={{ ...mono9 }}>Threshold: <span style={{ color: 'var(--text-mid)' }}>{stats?.threshold?.toFixed(2) || '0.45'}</span></div>
        </div>
        <button className="btn btn-ghost" onClick={load} style={{ fontSize: 10, padding: '4px 12px', alignSelf: 'flex-start' }}>↺</button>
      </div>

      {/* Stats grid */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(145px, 1fr))', gap: 2 }}>
        {[
          ['Banned Faces',     stats?.banned_count    ?? '—', 'var(--red)'],
          ['Allowed Faces',    stats?.allowed_count   ?? '—', 'var(--green)'],
          ['Total Detections', stats?.total_detections ?? '—', 'var(--text-mid)'],
          ['Alerts (24h)',     stats?.alerts_last_24h ?? '—', stats?.alerts_last_24h > 0 ? 'var(--amber)' : 'var(--text-mid)'],
          ['Total Alerts',     stats?.total_alerts    ?? '—', 'var(--text-mid)'],
          ['Snapshots',        stats?.snapshot_count  ?? '—', 'var(--text-mid)'],
        ].map(([label, val, color]) => (
          <div key={label} style={{ background: 'var(--surface2)', border: '1px solid var(--border)', padding: '16px 18px' }}>
            <div style={{ ...mono9, marginBottom: 8 }}>{label}</div>
            <div style={{ fontFamily: 'var(--mono)', fontSize: 26, fontWeight: 700, color }}>{val}</div>
          </div>
        ))}
      </div>

      {/* Recent Activity */}
      <div className="panel">
        <SectionTitle>Recent Activity</SectionTitle>
        {logs.length === 0 ? (
          <div style={{ ...mono9, padding: '10px 0' }}>No activity recorded yet.</div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
            {logs.map(log => (
              <div key={log.id} style={{ display: 'flex', gap: 16, alignItems: 'center', padding: '8px 12px', background: 'var(--surface2)', borderLeft: `2px solid ${LOG_TYPE_COLOR[log.log_type] || 'var(--border)'}` }}>
                <div style={{ fontFamily: 'var(--mono)', fontSize: 9, color: 'var(--text-dim)', whiteSpace: 'nowrap', minWidth: 70 }}>
                  {log.timestamp?.slice(11, 19) || '—'}
                </div>
                <div style={{ fontFamily: 'var(--mono)', fontSize: 9, color: LOG_TYPE_COLOR[log.log_type] || 'var(--text-dim)', minWidth: 120, whiteSpace: 'nowrap', letterSpacing: '0.08em' }}>
                  {log.log_type || 'UNKNOWN'}
                </div>
                <div style={{ fontFamily: 'var(--sans)', fontSize: 12, color: 'var(--text)', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {log.matched_name || <span style={{ color: 'var(--text-dim)' }}>No match</span>}
                </div>
                {log.similarity > 0 && (
                  <div style={{ fontFamily: 'var(--mono)', fontSize: 9, color: 'var(--text-dim)', whiteSpace: 'nowrap' }}>
                    {(log.similarity * 100).toFixed(1)}%
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* System info */}
      <div className="panel">
        <SectionTitle>System Info</SectionTitle>
        <InfoRow label="Detection Model"  val={stats?.model || 'buffalo_sc'} />
        <InfoRow label="Match Algorithm"  val="Cosine Similarity" />
        <InfoRow label="Storage"          val="SQLite" />
        <InfoRow label="Backend"          val={API_BASE || 'localhost:8090'} />
      </div>
    </div>
  )
}

// ── Watchlist tab ──────────────────────────────────────────────

function FaceCard({ face, listType, onDelete }) {
  const [confirmDel, setConfirmDel] = useState(false)
  const [busy,       setBusy]       = useState(false)

  const isBanned    = listType === 'banned'
  const accentColor = isBanned ? 'var(--red)' : 'var(--green)'
  const imgFilename = face.image_path
    ? face.image_path.replace(/\\/g, '/').split('/').pop()
    : null

  async function handleDelete() {
    setBusy(true)
    try {
      if (isBanned) await api.deleteBanned(face.id)
      else          await api.deleteAllowed(face.id)
      onDelete(face.id)
    } catch (e) {
      alert('Delete failed: ' + e.message)
      setBusy(false)
    }
  }

  return (
    <div style={{ background: 'var(--surface2)', border: '1px solid var(--border)', overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>

      {/* Thumbnail */}
      <div style={{ aspectRatio: '1/1', background: '#111', position: 'relative', overflow: 'hidden', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <div style={{ fontFamily: 'var(--mono)', fontSize: 28, color: accentColor, opacity: 0.25 }}>◉</div>
        {imgFilename && (
          <img
            src={`${API_BASE}/snapshots/${imgFilename}`}
            alt={face.name}
            style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
            onError={e => { e.target.style.display = 'none' }}
          />
        )}
        <div style={{ position: 'absolute', top: 6, left: 6, fontFamily: 'var(--mono)', fontSize: 8, color: accentColor, background: 'rgba(0,0,0,0.72)', padding: '2px 6px', letterSpacing: '0.12em', textTransform: 'uppercase' }}>
          {isBanned ? 'BANNED' : 'ALLOWED'}
        </div>
      </div>

      {/* Info */}
      <div style={{ padding: '10px 12px', flex: 1 }}>
        <div style={{ fontFamily: 'var(--sans)', fontSize: 13, fontWeight: 700, color: 'var(--text)', marginBottom: 2 }}>{face.name}</div>
        {face.notes && (
          <div style={{ fontFamily: 'var(--mono)', fontSize: 9, color: 'var(--text-dim)', marginBottom: 4, lineHeight: 1.5 }}>{face.notes}</div>
        )}
        <div style={{ fontFamily: 'var(--mono)', fontSize: 8, color: 'var(--text-dim)' }}>{face.added_at?.slice(0, 10) || '—'}</div>
      </div>

      {/* Delete */}
      <div style={{ padding: '8px 12px', borderTop: '1px solid var(--border)' }}>
        {!confirmDel ? (
          <button
            className="btn btn-ghost"
            onClick={() => setConfirmDel(true)}
            style={{ fontSize: 10, padding: '3px 10px', borderColor: 'rgba(255,32,32,0.25)', color: 'var(--red)', width: '100%' }}
          >
            Remove
          </button>
        ) : (
          <div style={{ display: 'flex', gap: 6 }}>
            <button
              className="btn btn-primary"
              onClick={handleDelete}
              disabled={busy}
              style={{ fontSize: 10, padding: '3px 10px', background: 'var(--red)', flex: 1 }}
            >
              {busy ? '...' : 'Confirm'}
            </button>
            <button className="btn btn-ghost" onClick={() => setConfirmDel(false)} style={{ fontSize: 10, padding: '3px 10px' }}>
              No
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

function WatchlistTab() {
  const [banned,     setBanned]     = useState([])
  const [allowed,    setAllowed]    = useState([])
  const [loading,    setLoading]    = useState(true)
  const [activeList, setActiveList] = useState('banned')

  useEffect(() => { load() }, [])

  async function load() {
    setLoading(true)
    try {
      const [b, a] = await Promise.all([api.getBanned(), api.getAllowed()])
      setBanned(b)
      setAllowed(a)
    } catch {}
    setLoading(false)
  }

  const list   = activeList === 'banned' ? banned  : allowed
  const setter = activeList === 'banned' ? setBanned : setAllowed

  return (
    <div>
      {/* Sub-tabs */}
      <div style={{ display: 'flex', gap: 2, marginBottom: 20, borderBottom: '1px solid var(--border)', alignItems: 'center' }}>
        {[
          { key: 'banned',  label: `Banned (${banned.length})`  },
          { key: 'allowed', label: `Allowed (${allowed.length})` },
        ].map(t => (
          <button
            key={t.key}
            onClick={() => setActiveList(t.key)}
            style={{
              background: 'none', border: 'none',
              borderBottom: activeList === t.key ? '2px solid var(--red)' : '2px solid transparent',
              color: activeList === t.key ? 'var(--text)' : 'var(--text-dim)',
              fontFamily: 'var(--mono)', fontSize: 10, letterSpacing: '0.16em', textTransform: 'uppercase',
              padding: '8px 18px', cursor: 'pointer', marginBottom: -1, whiteSpace: 'nowrap',
            }}
          >
            {t.label}
          </button>
        ))}
        <button className="btn btn-ghost" onClick={load} disabled={loading} style={{ fontSize: 10, padding: '4px 12px', marginLeft: 'auto' }}>
          {loading ? '...' : '↺ Refresh'}
        </button>
      </div>

      {loading ? (
        <div className="empty-state"><p>Loading watchlist...</p></div>
      ) : list.length === 0 ? (
        <div className="empty-state">
          <div className="empty-label">// empty</div>
          <p>No {activeList} faces enrolled.<br />Use the Enroll page to add faces.</p>
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))', gap: 2 }}>
          {list.map(face => (
            <FaceCard
              key={face.id}
              face={face}
              listType={activeList}
              onDelete={(id) => setter(prev => prev.filter(f => f.id !== id))}
            />
          ))}
        </div>
      )}
    </div>
  )
}

// ── Evidence tab ───────────────────────────────────────────────

function EvidenceTab() {
  const [logs,       setLogs]       = useState([])
  const [loading,    setLoading]    = useState(false)
  const [activeSnap, setActiveSnap] = useState(null)
  const [error,      setError]      = useState('')

  const [preset,      setPreset]     = useState(10)
  const [customVal,   setCustomVal]  = useState(1)
  const [customUnit,  setCustomUnit] = useState('days')
  const [sortDir,     setSortDir]    = useState('desc')
  const [selectedIds, setSelectedIds] = useState(new Set())
  const [exporting,   setExporting]  = useState(false)

  useEffect(() => { loadLogs() }, [])

  async function loadLogs() {
    setLoading(true)
    try {
      const all = await api.getLogs(500, true)
      setLogs(all.filter(l => l.snapshot_url))
      setError('')
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }

  const intervalMinutes = preset === 'all'
    ? null
    : preset === 'custom'
      ? customVal * UNIT_TO_MINUTES[customUnit]
      : preset

  const groups = groupEvidence(logs, intervalMinutes, sortDir)

  const toggleId = (id) => setSelectedIds(prev => {
    const next = new Set(prev)
    next.has(id) ? next.delete(id) : next.add(id)
    return next
  })
  const groupIds    = (group) => group.logs.map(l => l.id)
  const allGroupSel = (group) => groupIds(group).every(id => selectedIds.has(id))
  const toggleGroup = (group) => {
    const ids = groupIds(group)
    const all = ids.every(id => selectedIds.has(id))
    setSelectedIds(prev => {
      const next = new Set(prev)
      ids.forEach(id => all ? next.delete(id) : next.add(id))
      return next
    })
  }
  const allSel    = logs.length > 0 && logs.every(l => selectedIds.has(l.id))
  const toggleAll = () => setSelectedIds(allSel ? new Set() : new Set(logs.map(l => l.id)))

  async function handleExport() {
    const paths = logs.filter(l => selectedIds.has(l.id)).map(l => l.snapshot_url)
    if (!paths.length) return
    setExporting(true)
    try {
      const blob = await api.admin.exportSnapshots(paths)
      const url  = URL.createObjectURL(blob)
      const a    = document.createElement('a')
      a.href     = url
      a.download = `gatekeep_evidence_${Date.now()}.zip`
      a.click()
      URL.revokeObjectURL(url)
    } catch (e) {
      alert('Export failed: ' + e.message)
    } finally {
      setExporting(false)
    }
  }

  const closeModal = useCallback(() => setActiveSnap(null), [])
  const colLabel   = { fontFamily: 'var(--mono)', fontSize: 9, color: 'var(--text-dim)', letterSpacing: '0.16em', textTransform: 'uppercase', whiteSpace: 'nowrap' }

  return (
    <div>
      {activeSnap && <SnapshotModal log={activeSnap} onClose={closeModal} />}
      {error && <div className="error-msg">ERR: {error}</div>}

      {/* Controls */}
      <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', marginBottom: 16 }}>
        <span style={colLabel}>Group by</span>
        <select
          value={preset}
          onChange={e => { const v = e.target.value; setPreset(v === 'all' || v === 'custom' ? v : Number(v)) }}
          style={{ width: 'auto' }}
        >
          {INTERVAL_PRESETS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>

        {preset === 'custom' && (
          <>
            <input
              type="number" min={1} value={customVal}
              onChange={e => setCustomVal(Math.max(1, Number(e.target.value)))}
              style={{ width: 64 }}
            />
            <select value={customUnit} onChange={e => setCustomUnit(e.target.value)} style={{ width: 'auto' }}>
              {Object.keys(UNIT_TO_MINUTES).map(u => (
                <option key={u} value={u}>{u.charAt(0).toUpperCase() + u.slice(1)}</option>
              ))}
            </select>
          </>
        )}

        <span style={{ ...colLabel, marginLeft: 8 }}>Sort</span>
        <select value={sortDir} onChange={e => setSortDir(e.target.value)} style={{ width: 'auto' }}>
          <option value="desc">Newest First</option>
          <option value="asc">Oldest First</option>
        </select>

        <div style={{ marginLeft: 'auto', display: 'flex', gap: 8, alignItems: 'center' }}>
          <button className="btn btn-ghost" onClick={loadLogs} disabled={loading} style={{ fontSize: 10, padding: '4px 12px' }}>
            {loading ? '...' : 'Refresh'}
          </button>
          <button className="btn btn-ghost" onClick={toggleAll} style={{ fontSize: 10, padding: '4px 12px' }}>
            {allSel ? 'Deselect All' : 'Select All'}
          </button>
          {selectedIds.size > 0 && (
            <button className="btn btn-primary" onClick={handleExport} disabled={exporting} style={{ fontSize: 10, padding: '4px 14px' }}>
              {exporting ? 'Exporting...' : `⬇ Export ${selectedIds.size}`}
            </button>
          )}
        </div>
      </div>

      {/* Summary */}
      <div style={{ display: 'flex', gap: 16, marginBottom: 14, fontFamily: 'var(--mono)', fontSize: 10, color: 'var(--text-dim)', letterSpacing: '0.12em' }}>
        <span>SNAPSHOTS: <span style={{ color: 'var(--amber)' }}>{logs.length}</span></span>
        {selectedIds.size > 0 && <span>SELECTED: <span style={{ color: 'var(--green)' }}>{selectedIds.size}</span></span>}
      </div>

      {/* Groups */}
      {loading ? (
        <div className="empty-state"><p>Loading evidence...</p></div>
      ) : groups.length === 0 || (groups.length === 1 && groups[0].logs.length === 0) ? (
        <div className="empty-state">
          <div className="empty-label">// no evidence</div>
          <p>No alert snapshots found</p>
        </div>
      ) : groups.map(group => (
        <div key={group.bucketStart ?? 'all'} style={{ marginBottom: 24 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 10 }}>
            <input
              type="checkbox"
              checked={allGroupSel(group)}
              onChange={() => toggleGroup(group)}
              style={{ cursor: 'pointer', accentColor: 'var(--red)', flexShrink: 0 }}
            />
            <div style={{ fontFamily: 'var(--mono)', fontSize: 9, letterSpacing: '0.18em', textTransform: 'uppercase', color: 'var(--text-mid)', whiteSpace: 'nowrap' }}>
              {group.bucketStart === null ? 'All Evidence' : bucketLabel(group.bucketStart, intervalMinutes)}
            </div>
            <div style={{ flex: 1, height: 1, background: 'var(--border)' }} />
            <div style={{ fontFamily: 'var(--mono)', fontSize: 9, color: 'var(--text-dim)', letterSpacing: '0.1em', whiteSpace: 'nowrap' }}>
              {group.logs.length} event{group.logs.length !== 1 ? 's' : ''}
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(170px, 1fr))', gap: 2 }}>
            {group.logs.map(log => {
              const sel = selectedIds.has(log.id)
              return (
                <div
                  key={log.id}
                  style={{
                    background: 'var(--surface2)',
                    border: `1px solid ${sel ? 'var(--red)' : 'var(--border)'}`,
                    overflow: 'hidden', position: 'relative',
                    transition: 'border-color 0.15s',
                  }}
                  onMouseEnter={e => { if (!sel) e.currentTarget.style.borderColor = 'var(--text-mid)' }}
                  onMouseLeave={e => { if (!sel) e.currentTarget.style.borderColor = 'var(--border)' }}
                >
                  <div
                    onClick={e => { e.stopPropagation(); toggleId(log.id) }}
                    style={{ position: 'absolute', top: 8, right: 8, zIndex: 10, cursor: 'pointer' }}
                  >
                    <input
                      type="checkbox"
                      checked={sel}
                      onChange={() => toggleId(log.id)}
                      style={{ cursor: 'pointer', accentColor: 'var(--red)', width: 14, height: 14 }}
                    />
                  </div>

                  <div
                    onClick={() => setActiveSnap(log)}
                    style={{ aspectRatio: '4/3', background: '#000', position: 'relative', overflow: 'hidden', cursor: 'pointer' }}
                  >
                    <img
                      src={`${API_BASE}${log.snapshot_url}`}
                      alt={log.matched_name}
                      style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
                      onError={e => { e.target.style.display = 'none' }}
                    />
                    {sel && <div style={{ position: 'absolute', inset: 0, background: 'rgba(255,32,32,0.18)', pointerEvents: 'none' }} />}
                    <div style={{ position: 'absolute', top: 6, left: 7, fontFamily: 'var(--mono)', fontSize: 8, color: 'var(--red)', textShadow: '0 1px 4px #000' }}>● REC</div>
                    <div
                      style={{ position: 'absolute', inset: 0, opacity: 0, background: 'rgba(0,0,0,0.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'var(--mono)', fontSize: 10, color: '#fff', letterSpacing: '0.18em', textTransform: 'uppercase', transition: 'opacity 0.15s' }}
                      onMouseEnter={e => e.currentTarget.style.opacity = 1}
                      onMouseLeave={e => e.currentTarget.style.opacity = 0}
                    >[ VIEW ]</div>
                  </div>

                  <div style={{ padding: '7px 10px' }}>
                    <div style={{ fontFamily: 'var(--sans)', fontSize: 12, fontWeight: 700, color: 'var(--text)', marginBottom: 2 }}>{log.matched_name}</div>
                    <div style={{ fontFamily: 'var(--mono)', fontSize: 9, color: 'var(--text-dim)' }}>{log.timestamp?.slice(11, 19)}</div>
                    <div style={{ fontFamily: 'var(--mono)', fontSize: 9, color: 'var(--red)', marginTop: 2 }}>{(log.similarity * 100).toFixed(1)}% match</div>
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      ))}
    </div>
  )
}

// ── System tab ─────────────────────────────────────────────────

const LOG_TYPE_OPTIONS = [
  { value: '',              label: 'All Logs'           },
  { value: 'BANNED_ALERT',  label: 'Banned Alerts'      },
  { value: 'UNAUTHORIZED',  label: 'Unauthorized'       },
  { value: 'KNOWN_ENTRY',   label: 'Known Entries'      },
  { value: 'UNKNOWN',       label: 'Unknown Detections' },
]

const MODES = [
  { value: 'BANNED_ONLY', label: 'Banned Only',    desc: 'Alert only when a banned face is detected' },
  { value: 'KNOWN_ONLY',  label: 'Allowlist Mode', desc: 'Alert when a face is NOT on the allowed list' },
  { value: 'DUAL',        label: 'Dual Mode',      desc: 'Alert on banned faces and flag all unknowns' },
]

function SystemTab() {
  const [stats,        setStats]        = useState(null)
  const [threshold,    setThreshold]    = useState(0.45)
  const [threshMsg,    setThreshMsg]    = useState('')
  const [mode,         setMode]         = useState('BANNED_ONLY')
  const [modeMsg,      setModeMsg]      = useState('')
  const [clearType,    setClearType]    = useState('')
  const [confirmClear, setConfirmClear] = useState(false)
  const [confirmWipe,  setConfirmWipe]  = useState(false)
  const [busy,         setBusy]         = useState('')
  const [msg,          setMsg]          = useState('')

  useEffect(() => { loadStats() }, [])

  async function loadStats() {
    try {
      const s = await api.stats()
      setStats(s)
      setThreshold(s.threshold ?? 0.45)
      setMode(s.detection_mode || 'BANNED_ONLY')
    } catch {}
  }

  async function applyThreshold() {
    try {
      const res = await api.admin.setThreshold(parseFloat(threshold))
      setThreshMsg(`✓ Threshold updated to ${res.threshold.toFixed(2)}`)
      setTimeout(() => setThreshMsg(''), 3000)
    } catch (e) {
      setThreshMsg('✗ ' + e.message)
    }
  }

  async function applyMode(newMode) {
    try {
      await api.admin.setMode(newMode)
      setMode(newMode)
      setModeMsg(`✓ Mode set to ${newMode}`)
      setTimeout(() => setModeMsg(''), 3000)
    } catch (e) {
      setModeMsg('✗ ' + e.message)
    }
  }

  async function doClearLogs() {
    setBusy('clear')
    try {
      await api.admin.clearLogs(clearType || null)
      const label = LOG_TYPE_OPTIONS.find(t => t.value === clearType)?.label || 'All logs'
      setMsg(`✓ ${label} cleared`)
      setConfirmClear(false)
      loadStats()
    } catch (e) {
      setMsg('✗ ' + e.message)
    } finally {
      setBusy('')
      setTimeout(() => setMsg(''), 4000)
    }
  }

  async function doWipeSnapshots() {
    setBusy('wipe')
    try {
      const r = await api.admin.wipeSnapshots()
      setMsg(`✓ ${r.deleted} snapshot${r.deleted !== 1 ? 's' : ''} deleted`)
      setConfirmWipe(false)
    } catch (e) {
      setMsg('✗ ' + e.message)
    } finally {
      setBusy('')
      setTimeout(() => setMsg(''), 4000)
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>

      <Msg text={msg} />

      {/* Detection Mode */}
      <div className="panel">
        <SectionTitle>Detection Mode</SectionTitle>
        {modeMsg && (
          <div style={{ fontFamily: 'var(--mono)', fontSize: 10, color: modeMsg.startsWith('✓') ? 'var(--green)' : 'var(--red)', marginBottom: 12 }}>
            {modeMsg}
          </div>
        )}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {MODES.map(m => (
            <div
              key={m.value}
              onClick={() => applyMode(m.value)}
              style={{
                display: 'flex', alignItems: 'center', gap: 14, padding: '12px 16px',
                background: mode === m.value ? 'var(--surface2)' : 'transparent',
                border: `1px solid ${mode === m.value ? 'var(--red)' : 'var(--border)'}`,
                cursor: 'pointer', transition: 'all 0.15s',
              }}
            >
              <div style={{
                width: 12, height: 12, borderRadius: '50%', flexShrink: 0,
                border: `2px solid ${mode === m.value ? 'var(--red)' : 'var(--border)'}`,
                background: mode === m.value ? 'var(--red)' : 'transparent',
              }} />
              <div>
                <div style={{ fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--text)', letterSpacing: '0.1em' }}>{m.label}</div>
                <div style={{ fontFamily: 'var(--mono)', fontSize: 9, color: 'var(--text-dim)', marginTop: 2 }}>{m.desc}</div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Match Threshold */}
      <div className="panel">
        <SectionTitle>Match Threshold</SectionTitle>
        <div style={{ fontFamily: 'var(--mono)', fontSize: 9, color: 'var(--text-dim)', marginBottom: 14, lineHeight: 1.7 }}>
          Minimum cosine similarity to register as a face match. Lower = more sensitive. Higher = more strict.
          &nbsp;Current: <span style={{ color: 'var(--text-mid)' }}>{parseFloat(threshold).toFixed(2)}</span>
        </div>
        <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
          <input
            type="range" min="0.1" max="1.0" step="0.01"
            value={threshold}
            onChange={e => setThreshold(e.target.value)}
            style={{ width: 220, accentColor: 'var(--red)' }}
          />
          <span style={{ fontFamily: 'var(--mono)', fontSize: 13, color: 'var(--text-mid)', minWidth: 36 }}>
            {parseFloat(threshold).toFixed(2)}
          </span>
          <button className="btn btn-ghost" onClick={applyThreshold} style={{ fontSize: 11 }}>Apply</button>
        </div>
        {threshMsg && (
          <div style={{ fontFamily: 'var(--mono)', fontSize: 10, color: threshMsg.startsWith('✓') ? 'var(--green)' : 'var(--red)', marginTop: 8 }}>
            {threshMsg}
          </div>
        )}
      </div>

      {/* Danger zone */}
      <div className="panel" style={{ border: '1px solid rgba(255,32,32,0.25)' }}>
        <SectionTitle>Danger Zone</SectionTitle>
        <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>

          {/* Clear logs */}
          <div style={{ flex: 1, minWidth: 220 }}>
            <div style={{ fontFamily: 'var(--mono)', fontSize: 10, color: 'var(--text-mid)', marginBottom: 6, letterSpacing: '0.08em' }}>
              Clear Detection Log
            </div>
            <div style={{ fontFamily: 'var(--mono)', fontSize: 9, color: 'var(--text-dim)', marginBottom: 10, lineHeight: 1.6 }}>
              Permanently delete detection records. Snapshots on disk are unaffected.
            </div>
            <div style={{ marginBottom: 10 }}>
              <select value={clearType} onChange={e => setClearType(e.target.value)} style={{ width: '100%', fontSize: 11 }}>
                {LOG_TYPE_OPTIONS.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
              </select>
            </div>
            {!confirmClear ? (
              <button className="btn btn-ghost" onClick={() => setConfirmClear(true)} style={{ fontSize: 11, borderColor: 'rgba(255,32,32,0.3)', color: 'var(--red)' }}>
                Clear Logs
              </button>
            ) : (
              <div style={{ display: 'flex', gap: 8 }}>
                <button className="btn btn-primary" onClick={doClearLogs} disabled={busy === 'clear'} style={{ fontSize: 11, background: 'var(--red)' }}>
                  {busy === 'clear' ? '...' : 'Confirm'}
                </button>
                <button className="btn btn-ghost" onClick={() => setConfirmClear(false)} style={{ fontSize: 11 }}>Cancel</button>
              </div>
            )}
          </div>

          {/* Wipe snapshots */}
          <div style={{ flex: 1, minWidth: 220 }}>
            <div style={{ fontFamily: 'var(--mono)', fontSize: 10, color: 'var(--text-mid)', marginBottom: 6, letterSpacing: '0.08em' }}>
              Wipe All Snapshots
            </div>
            <div style={{ fontFamily: 'var(--mono)', fontSize: 9, color: 'var(--text-dim)', marginBottom: 10, lineHeight: 1.6 }}>
              Delete all alert images from disk. Log records remain but will show no evidence images.
            </div>
            {!confirmWipe ? (
              <button className="btn btn-ghost" onClick={() => setConfirmWipe(true)} style={{ fontSize: 11, borderColor: 'rgba(255,32,32,0.3)', color: 'var(--red)' }}>
                Wipe Snapshots
              </button>
            ) : (
              <div style={{ display: 'flex', gap: 8 }}>
                <button className="btn btn-primary" onClick={doWipeSnapshots} disabled={busy === 'wipe'} style={{ fontSize: 11, background: 'var(--red)' }}>
                  {busy === 'wipe' ? '...' : 'Confirm'}
                </button>
                <button className="btn btn-ghost" onClick={() => setConfirmWipe(false)} style={{ fontSize: 11 }}>Cancel</button>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

// ── Account tab ────────────────────────────────────────────────

function AccountTab({ onLogout }) {
  const [newPw,   setNewPw]   = useState('')
  const [confirm, setConfirm] = useState('')
  const [msg,     setMsg]     = useState('')
  const [busy,    setBusy]    = useState(false)

  async function handleChange(e) {
    e.preventDefault()
    if (newPw.length < 6) { setMsg('✗ Password must be at least 6 characters'); return }
    if (newPw !== confirm) { setMsg('✗ Passwords do not match'); return }
    setBusy(true)
    try {
      await api.admin.changePassword(newPw)
      setMsg('✓ Password changed — logging out')
      setNewPw('')
      setConfirm('')
      setTimeout(onLogout, 2000)
    } catch (e) {
      setMsg('✗ ' + e.message)
    } finally {
      setBusy(false)
    }
  }

  async function handleLogout() {
    await api.admin.logout()
    onLogout()
  }

  return (
    <div style={{ maxWidth: 480 }}>
      <div className="panel" style={{ marginBottom: 16 }}>
        <SectionTitle>Change Password</SectionTitle>
        <Msg text={msg} />
        <form onSubmit={handleChange} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div>
            <label style={{ ...mono9, display: 'block', marginBottom: 6 }}>New Password</label>
            <input
              type="password" value={newPw}
              onChange={e => setNewPw(e.target.value)}
              placeholder="Min. 6 characters"
              style={{ width: '100%' }} required
            />
          </div>
          <div>
            <label style={{ ...mono9, display: 'block', marginBottom: 6 }}>Confirm Password</label>
            <input
              type="password" value={confirm}
              onChange={e => setConfirm(e.target.value)}
              placeholder="Repeat new password"
              style={{ width: '100%' }} required
            />
          </div>
          <button className="btn btn-primary" type="submit" disabled={busy} style={{ alignSelf: 'flex-start', fontSize: 12 }}>
            {busy ? 'Saving...' : 'Change Password'}
          </button>
        </form>
      </div>

      <div className="panel" style={{ border: '1px solid rgba(255,32,32,0.2)' }}>
        <SectionTitle>Session</SectionTitle>
        <div style={{ fontFamily: 'var(--mono)', fontSize: 10, color: 'var(--text-dim)', marginBottom: 14, lineHeight: 1.7 }}>
          Admin session active. Sessions expire automatically after 8 hours or on logout.
        </div>
        <button className="btn btn-ghost" onClick={handleLogout} style={{ fontSize: 11, borderColor: 'rgba(255,32,32,0.3)', color: 'var(--red)' }}>
          Log Out
        </button>
      </div>
    </div>
  )
}

// ── Forced password change (first-login) ───────────────────────

function ForcePasswordChange({ onDone, onLogout }) {
  const [newPw,   setNewPw]   = useState('')
  const [confirm, setConfirm] = useState('')
  const [msg,     setMsg]     = useState('')
  const [busy,    setBusy]    = useState(false)

  async function handleSubmit(e) {
    e.preventDefault()
    if (newPw.length < 6) { setMsg('✗ Password must be at least 6 characters'); return }
    if (newPw !== confirm) { setMsg('✗ Passwords do not match'); return }
    setBusy(true)
    try {
      await api.admin.changePassword(newPw)
      setMsg('✓ Password set — entering admin panel')
      setTimeout(onDone, 1500)
    } catch (e) {
      setMsg('✗ ' + e.message)
      setBusy(false)
    }
  }

  return (
    <div>
      <div className="page-header">
        <div className="page-breadcrumb">GATEKEEP &gt; <span>Admin</span></div>
        <div className="page-title">Set Admin Password</div>
      </div>

      <div style={{
        maxWidth: 460, margin: '40px auto', padding: '32px 36px',
        background: 'var(--surface)', border: '1px solid var(--border)',
        display: 'flex', flexDirection: 'column', gap: 0,
      }}>
        <div style={{
          background: 'rgba(255,180,0,0.07)', border: '1px solid rgba(255,180,0,0.25)',
          padding: '14px 18px', marginBottom: 28,
          fontFamily: 'var(--mono)', fontSize: 10, color: 'var(--amber)',
          lineHeight: 1.8, letterSpacing: '0.04em',
        }}>
          ⚠ You are logged in with the default password. You must set a unique password before accessing the admin panel.
        </div>

        <Msg text={msg} />

        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div>
            <label style={{ ...mono9, display: 'block', marginBottom: 6 }}>New Password</label>
            <input
              type="password" value={newPw}
              onChange={e => setNewPw(e.target.value)}
              placeholder="Min. 6 characters"
              style={{ width: '100%' }}
              autoFocus required
            />
          </div>
          <div>
            <label style={{ ...mono9, display: 'block', marginBottom: 6 }}>Confirm Password</label>
            <input
              type="password" value={confirm}
              onChange={e => setConfirm(e.target.value)}
              placeholder="Repeat new password"
              style={{ width: '100%' }} required
            />
          </div>
          <button
            className="btn btn-primary" type="submit" disabled={busy}
            style={{ fontSize: 13, padding: '12px', letterSpacing: '0.16em', marginTop: 4 }}
          >
            {busy ? 'Saving...' : 'Set Password & Continue'}
          </button>
        </form>

        <button
          onClick={onLogout}
          style={{
            marginTop: 18, background: 'none', border: 'none',
            fontFamily: 'var(--mono)', fontSize: 9, color: 'var(--text-dim)',
            cursor: 'pointer', letterSpacing: '0.12em', textAlign: 'center',
          }}
        >
          Cancel — Log Out
        </button>
      </div>
    </div>
  )
}

// ── Admin panel (authenticated) ────────────────────────────────

const TABS = [
  { key: 'overview',  label: 'Overview'  },
  { key: 'watchlist', label: 'Watchlist' },
  { key: 'evidence',  label: 'Evidence'  },
  { key: 'system',    label: 'System'    },
  { key: 'account',   label: 'Account'   },
]

function AdminPanel({ onLogout }) {
  const [tab, setTab] = useState('overview')

  return (
    <div>
      <div className="page-header">
        <div className="page-breadcrumb">GATEKEEP &gt; <span>Admin</span></div>
        <div className="page-title">Admin Panel</div>
      </div>

      <div style={{ display: 'flex', gap: 2, marginBottom: 20, borderBottom: '1px solid var(--border)', overflowX: 'auto' }}>
        {TABS.map(t => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            style={{
              background: 'none', border: 'none',
              borderBottom: tab === t.key ? '2px solid var(--red)' : '2px solid transparent',
              color: tab === t.key ? 'var(--text)' : 'var(--text-dim)',
              fontFamily: 'var(--mono)', fontSize: 11, letterSpacing: '0.18em', textTransform: 'uppercase',
              padding: '10px 20px', cursor: 'pointer', transition: 'color 0.15s',
              marginBottom: -1, whiteSpace: 'nowrap',
            }}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'overview'  && <OverviewTab />}
      {tab === 'watchlist' && <WatchlistTab />}
      {tab === 'evidence'  && <EvidenceTab />}
      {tab === 'system'    && <SystemTab />}
      {tab === 'account'   && <AccountTab onLogout={onLogout} />}
    </div>
  )
}

// ── Login gate ─────────────────────────────────────────────────

function AdminLogin({ onLogin }) {
  const [password, setPassword] = useState('')
  const [error,    setError]    = useState('')
  const [busy,     setBusy]     = useState(false)

  async function handleSubmit(e) {
    e.preventDefault()
    setBusy(true)
    setError('')
    try {
      const data = await api.admin.login(password)
      onLogin(data)   // pass full response (includes is_default_password)
    } catch (e) {
      setError(e.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div>
      <div className="page-header">
        <div className="page-breadcrumb">GATEKEEP &gt; <span>Admin</span></div>
        <div className="page-title">Admin Access</div>
      </div>

      <div style={{
        maxWidth: 420, margin: '40px auto', padding: '32px',
        background: 'var(--surface)', border: '1px solid var(--border)',
        display: 'flex', flexDirection: 'column', gap: 20,
      }}>
        <div style={{ textAlign: 'center' }}>
          <div style={{ fontFamily: 'var(--mono)', fontSize: 28, color: 'var(--red)', marginBottom: 8 }}>⬡</div>
          <div style={{ ...mono9, letterSpacing: '0.3em' }}>Restricted Access — Admin Only</div>
        </div>

        {error && (
          <div style={{ fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--red)', background: 'rgba(255,32,32,0.1)', border: '1px solid rgba(255,32,32,0.2)', padding: '10px 16px', letterSpacing: '0.1em', textAlign: 'center' }}>
            ✗ {error}
          </div>
        )}

        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div>
            <label style={{ ...mono9, display: 'block', marginBottom: 6 }}>Admin Password</label>
            <input
              type="password" value={password}
              onChange={e => setPassword(e.target.value)}
              placeholder="Enter admin password"
              style={{ width: '100%' }}
              autoFocus required
            />
          </div>
          <button className="btn btn-primary" type="submit" disabled={busy} style={{ fontSize: 13, padding: '12px', letterSpacing: '0.18em' }}>
            {busy ? 'Verifying...' : 'Enter'}
          </button>
        </form>

        <div style={{ fontFamily: 'var(--mono)', fontSize: 9, color: 'var(--text-dim)', textAlign: 'center', letterSpacing: '0.1em' }}>
          Default password: <span style={{ color: 'var(--text-mid)' }}>admin</span>
        </div>
      </div>
    </div>
  )
}

// ── Root export ────────────────────────────────────────────────

export default function Admin() {
  const [authed,   setAuthed]   = useState(api.admin.isLoggedIn())
  const [forceSet, setForceSet] = useState(false)

  function handleLogin(data) {
    setAuthed(true)
    if (data?.is_default_password) setForceSet(true)
  }

  async function handleLogout() {
    try { await api.admin.logout() } catch {}
    setAuthed(false)
    setForceSet(false)
  }

  if (!authed)  return <AdminLogin onLogin={handleLogin} />
  if (forceSet) return <ForcePasswordChange onDone={() => setForceSet(false)} onLogout={handleLogout} />
  return <AdminPanel onLogout={handleLogout} />
}
