import { useState, useEffect, useCallback } from 'react'
import { api } from '../api.js'

const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:8090'

// ── Snapshot modal (evidence viewer) ─────────────────────────

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
            <div style={{ fontFamily: 'var(--mono)', fontSize: 9, color: 'var(--text-dim)', letterSpacing: '0.2em', textTransform: 'uppercase', marginBottom: 4 }}>
              // Evidence Record
            </div>
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
              <div style={{ fontFamily: 'var(--mono)', fontSize: 9, color: 'var(--text-dim)', letterSpacing: '0.18em', textTransform: 'uppercase', marginBottom: 4 }}>{label}</div>
              <div style={{ fontFamily: 'var(--mono)', fontSize: 13, color: 'var(--text)', fontWeight: 600 }}>{val}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

// ── Evidence helpers ──────────────────────────────────────────

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

// ── Evidence tab ──────────────────────────────────────────────

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
      const all = await api.getLogs(500, true)   // alerts only
      setLogs(all.filter(l => l.snapshot_url))   // only those with snapshots
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
  const groupIds = (group) => group.logs.map(l => l.id)
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
  const allSel = logs.length > 0 && logs.every(l => selectedIds.has(l.id))
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

  const mono = { fontFamily: 'var(--mono)', fontSize: 9, color: 'var(--text-dim)', letterSpacing: '0.16em', textTransform: 'uppercase', whiteSpace: 'nowrap' }

  return (
    <div>
      {activeSnap && <SnapshotModal log={activeSnap} onClose={closeModal} />}

      {error && <div className="error-msg">ERR: {error}</div>}

      {/* Controls */}
      <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', marginBottom: 16 }}>
        <span style={mono}>Group by</span>
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

        <span style={{ ...mono, marginLeft: 8 }}>Sort</span>
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

      {/* Summary chips */}
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

// ── System tools tab ──────────────────────────────────────────

function SystemTab() {
  const [stats,       setStats]       = useState(null)
  const [threshold,   setThreshold]   = useState(0.45)
  const [threshMsg,   setThreshMsg]   = useState('')
  const [confirmClear, setConfirmClear] = useState(false)
  const [confirmWipe,  setConfirmWipe]  = useState(false)
  const [busy,        setBusy]         = useState('')
  const [msg,         setMsg]          = useState('')

  useEffect(() => { loadStats() }, [])

  async function loadStats() {
    try {
      const s = await api.stats()
      setStats(s)
      setThreshold(s.threshold ?? 0.45)
    } catch {}
  }

  async function applyThreshold() {
    try {
      const res = await api.admin.setThreshold(parseFloat(threshold))
      setThreshMsg(`✓ Threshold set to ${res.threshold.toFixed(2)}`)
      setTimeout(() => setThreshMsg(''), 3000)
    } catch (e) {
      setThreshMsg('✗ ' + e.message)
    }
  }

  async function doClearLogs() {
    setBusy('clear')
    try {
      await api.admin.clearLogs()
      setMsg('✓ Detection log cleared')
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

  async function startCam() {
    setBusy('cam')
    try { await api.startCamera(0, parseFloat(threshold)); loadStats() } catch (e) { setMsg('✗ ' + e.message) }
    setBusy('')
  }
  async function stopCam() {
    setBusy('cam')
    try { await api.stopCamera(); loadStats() } catch (e) { setMsg('✗ ' + e.message) }
    setBusy('')
  }

  const sectionTitle = (label) => (
    <div style={{ fontFamily: 'var(--mono)', fontSize: 9, letterSpacing: '0.2em', textTransform: 'uppercase', color: 'var(--text-dim)', marginBottom: 14, borderBottom: '1px solid var(--border)', paddingBottom: 8 }}>
      // {label}
    </div>
  )

  const infoRow = (label, val, valColor) => (
    <div className="info-row" key={label}>
      <span className="info-key">{label}</span>
      <span className="info-val" style={valColor ? { color: valColor } : {}}>{val}</span>
    </div>
  )

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>

      {msg && (
        <div style={{ fontFamily: 'var(--mono)', fontSize: 11, color: msg.startsWith('✓') ? 'var(--green)' : 'var(--red)', background: msg.startsWith('✓') ? 'var(--green-dim)' : 'rgba(255,32,32,0.1)', border: `1px solid ${msg.startsWith('✓') ? 'rgba(0,230,118,0.2)' : 'rgba(255,32,32,0.2)'}`, padding: '10px 16px', letterSpacing: '0.1em' }}>
          {msg}
        </div>
      )}

      {/* ── System health ── */}
      <div className="panel">
        {sectionTitle('System Health')}
        {stats ? (
          <>
            {infoRow('Camera',          stats.camera_active ? 'LIVE' : 'OFFLINE', stats.camera_active ? 'var(--red)' : 'var(--text-dim)')}
            {infoRow('Threat Level',    stats.current_threat || 'NOMINAL')}
            {infoRow('Banned Faces',    stats.banned_count ?? '—')}
            {infoRow('Total Detections', stats.total_detections ?? '—')}
            {infoRow('Alerts / 24h',    stats.alerts_last_24h ?? '—', stats.alerts_last_24h > 0 ? 'var(--amber)' : undefined)}
            {infoRow('Total Alerts',    stats.total_alerts ?? '—')}
            {infoRow('Detection Model', 'buffalo_l')}
            {infoRow('Match Algorithm', 'Cosine Similarity')}
            {infoRow('Storage',         'SQLite')}
          </>
        ) : (
          <div style={{ fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--text-dim)' }}>Loading...</div>
        )}
        <button className="btn btn-ghost" onClick={loadStats} style={{ marginTop: 12, fontSize: 11 }}>↺ Refresh</button>
      </div>

      {/* ── Camera controls ── */}
      <div className="panel">
        {sectionTitle('Camera Controls')}
        <div style={{ display: 'flex', gap: 10, alignItems: 'flex-end', flexWrap: 'wrap', marginBottom: 16 }}>
          <div>
            <div style={{ fontFamily: 'var(--mono)', fontSize: 9, color: 'var(--text-dim)', letterSpacing: '0.14em', textTransform: 'uppercase', marginBottom: 6 }}>
              Match Threshold — {parseFloat(threshold).toFixed(2)}
            </div>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <input
                type="range" min="0.1" max="1.0" step="0.01"
                value={threshold}
                onChange={e => setThreshold(e.target.value)}
                style={{ width: 180, accentColor: 'var(--red)' }}
              />
              <span style={{ fontFamily: 'var(--mono)', fontSize: 12, color: 'var(--text-mid)', minWidth: 36 }}>
                {parseFloat(threshold).toFixed(2)}
              </span>
              <button className="btn btn-ghost" onClick={applyThreshold} style={{ fontSize: 11 }}>Apply</button>
            </div>
            {threshMsg && <div style={{ fontFamily: 'var(--mono)', fontSize: 10, color: threshMsg.startsWith('✓') ? 'var(--green)' : 'var(--red)', marginTop: 6 }}>{threshMsg}</div>}
          </div>
        </div>
        <div style={{ display: 'flex', gap: 10 }}>
          <button
            className="btn btn-primary"
            onClick={startCam}
            disabled={busy === 'cam' || stats?.camera_active}
            style={{ fontSize: 11 }}
          >
            ▶ Start Camera
          </button>
          <button
            className="btn btn-ghost"
            onClick={stopCam}
            disabled={busy === 'cam' || !stats?.camera_active}
            style={{ fontSize: 11 }}
          >
            ■ Stop Camera
          </button>
        </div>
      </div>

      {/* ── Danger zone ── */}
      <div className="panel" style={{ border: '1px solid rgba(255,32,32,0.25)' }}>
        {sectionTitle('Danger Zone')}
        <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>

          {/* Clear logs */}
          <div style={{ flex: 1, minWidth: 200 }}>
            <div style={{ fontFamily: 'var(--mono)', fontSize: 10, color: 'var(--text-mid)', marginBottom: 6, letterSpacing: '0.08em' }}>
              Clear Detection Log
            </div>
            <div style={{ fontFamily: 'var(--mono)', fontSize: 9, color: 'var(--text-dim)', marginBottom: 10, lineHeight: 1.6 }}>
              Permanently deletes all detection records from the database. Snapshots are unaffected.
            </div>
            {!confirmClear ? (
              <button className="btn btn-ghost" onClick={() => setConfirmClear(true)} style={{ fontSize: 11, borderColor: 'rgba(255,32,32,0.3)', color: 'var(--red)' }}>
                Clear Log
              </button>
            ) : (
              <div style={{ display: 'flex', gap: 8 }}>
                <button className="btn btn-primary" onClick={doClearLogs} disabled={busy === 'clear'} style={{ fontSize: 11, background: 'var(--red)' }}>
                  {busy === 'clear' ? '...' : 'Confirm Clear'}
                </button>
                <button className="btn btn-ghost" onClick={() => setConfirmClear(false)} style={{ fontSize: 11 }}>Cancel</button>
              </div>
            )}
          </div>

          {/* Wipe snapshots */}
          <div style={{ flex: 1, minWidth: 200 }}>
            <div style={{ fontFamily: 'var(--mono)', fontSize: 10, color: 'var(--text-mid)', marginBottom: 6, letterSpacing: '0.08em' }}>
              Wipe All Snapshots
            </div>
            <div style={{ fontFamily: 'var(--mono)', fontSize: 9, color: 'var(--text-dim)', marginBottom: 10, lineHeight: 1.6 }}>
              Permanently deletes all alert images from disk. Log records remain but will show no evidence.
            </div>
            {!confirmWipe ? (
              <button className="btn btn-ghost" onClick={() => setConfirmWipe(true)} style={{ fontSize: 11, borderColor: 'rgba(255,32,32,0.3)', color: 'var(--red)' }}>
                Wipe Snapshots
              </button>
            ) : (
              <div style={{ display: 'flex', gap: 8 }}>
                <button className="btn btn-primary" onClick={doWipeSnapshots} disabled={busy === 'wipe'} style={{ fontSize: 11, background: 'var(--red)' }}>
                  {busy === 'wipe' ? '...' : 'Confirm Wipe'}
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

// ── Account tab ───────────────────────────────────────────────

function AccountTab({ onLogout }) {
  const [newPw,    setNewPw]    = useState('')
  const [confirm,  setConfirm]  = useState('')
  const [msg,      setMsg]      = useState('')
  const [busy,     setBusy]     = useState(false)

  async function handleChange(e) {
    e.preventDefault()
    if (newPw.length < 4) { setMsg('✗ Password must be at least 4 characters'); return }
    if (newPw !== confirm) { setMsg('✗ Passwords do not match'); return }
    setBusy(true)
    try {
      await api.admin.changePassword(newPw)
      setMsg('✓ Password changed — you will be logged out')
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
        <div style={{ fontFamily: 'var(--mono)', fontSize: 9, letterSpacing: '0.2em', textTransform: 'uppercase', color: 'var(--text-dim)', marginBottom: 14, borderBottom: '1px solid var(--border)', paddingBottom: 8 }}>
          // Admin Account
        </div>

        {msg && (
          <div style={{ fontFamily: 'var(--mono)', fontSize: 11, color: msg.startsWith('✓') ? 'var(--green)' : 'var(--red)', background: msg.startsWith('✓') ? 'var(--green-dim)' : 'rgba(255,32,32,0.1)', border: `1px solid ${msg.startsWith('✓') ? 'rgba(0,230,118,0.2)' : 'rgba(255,32,32,0.2)'}`, padding: '10px 16px', letterSpacing: '0.1em', marginBottom: 16 }}>
            {msg}
          </div>
        )}

        <form onSubmit={handleChange} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div>
            <label style={{ fontFamily: 'var(--mono)', fontSize: 9, color: 'var(--text-dim)', letterSpacing: '0.16em', textTransform: 'uppercase', display: 'block', marginBottom: 6 }}>
              New Password
            </label>
            <input
              type="password"
              value={newPw}
              onChange={e => setNewPw(e.target.value)}
              placeholder="Min. 4 characters"
              style={{ width: '100%' }}
              required
            />
          </div>
          <div>
            <label style={{ fontFamily: 'var(--mono)', fontSize: 9, color: 'var(--text-dim)', letterSpacing: '0.16em', textTransform: 'uppercase', display: 'block', marginBottom: 6 }}>
              Confirm Password
            </label>
            <input
              type="password"
              value={confirm}
              onChange={e => setConfirm(e.target.value)}
              placeholder="Repeat new password"
              style={{ width: '100%' }}
              required
            />
          </div>
          <button className="btn btn-primary" type="submit" disabled={busy} style={{ alignSelf: 'flex-start', fontSize: 12 }}>
            {busy ? 'Saving...' : 'Change Password'}
          </button>
        </form>
      </div>

      <div className="panel" style={{ border: '1px solid rgba(255,32,32,0.2)' }}>
        <div style={{ fontFamily: 'var(--mono)', fontSize: 9, letterSpacing: '0.2em', textTransform: 'uppercase', color: 'var(--text-dim)', marginBottom: 12, borderBottom: '1px solid var(--border)', paddingBottom: 8 }}>
          // Session
        </div>
        <div style={{ fontFamily: 'var(--mono)', fontSize: 10, color: 'var(--text-dim)', marginBottom: 14, lineHeight: 1.7 }}>
          Admin session is active. Sessions expire automatically after 8 hours or when you log out.
        </div>
        <button className="btn btn-ghost" onClick={handleLogout} style={{ fontSize: 11, borderColor: 'rgba(255,32,32,0.3)', color: 'var(--red)' }}>
          Log Out
        </button>
      </div>
    </div>
  )
}

// ── Admin panel (authenticated) ───────────────────────────────

const TABS = [
  { key: 'evidence', label: 'Evidence' },
  { key: 'system',   label: 'System'   },
  { key: 'account',  label: 'Account'  },
]

function AdminPanel({ onLogout }) {
  const [tab, setTab] = useState('evidence')

  return (
    <div>
      <div className="page-header">
        <div className="page-breadcrumb">GATEKEEP &gt; <span>Admin</span></div>
        <div className="page-title">Admin Panel</div>
      </div>

      {/* Tab bar */}
      <div style={{ display: 'flex', gap: 2, marginBottom: 20, borderBottom: '1px solid var(--border)' }}>
        {TABS.map(t => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            style={{
              background: 'none',
              border: 'none',
              borderBottom: tab === t.key ? '2px solid var(--red)' : '2px solid transparent',
              color: tab === t.key ? 'var(--text)' : 'var(--text-dim)',
              fontFamily: 'var(--mono)',
              fontSize: 11,
              letterSpacing: '0.18em',
              textTransform: 'uppercase',
              padding: '10px 20px',
              cursor: 'pointer',
              transition: 'color 0.15s',
              marginBottom: -1,
            }}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Tab content */}
      {tab === 'evidence' && <EvidenceTab />}
      {tab === 'system'   && <SystemTab />}
      {tab === 'account'  && <AccountTab onLogout={onLogout} />}
    </div>
  )
}

// ── Login gate ────────────────────────────────────────────────

function AdminLogin({ onLogin }) {
  const [password, setPassword] = useState('')
  const [error,    setError]    = useState('')
  const [busy,     setBusy]     = useState(false)

  async function handleSubmit(e) {
    e.preventDefault()
    setBusy(true)
    setError('')
    try {
      await api.admin.login(password)
      onLogin()
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
          <div style={{ fontFamily: 'var(--mono)', fontSize: 28, color: 'var(--red)', marginBottom: 8, letterSpacing: '0.05em' }}>⬡</div>
          <div style={{ fontFamily: 'var(--mono)', fontSize: 9, color: 'var(--text-dim)', letterSpacing: '0.3em', textTransform: 'uppercase' }}>
            Restricted Access — Admin Only
          </div>
        </div>

        {error && (
          <div style={{ fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--red)', background: 'rgba(255,32,32,0.1)', border: '1px solid rgba(255,32,32,0.2)', padding: '10px 16px', letterSpacing: '0.1em', textAlign: 'center' }}>
            ✗ {error}
          </div>
        )}

        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div>
            <label style={{ fontFamily: 'var(--mono)', fontSize: 9, color: 'var(--text-dim)', letterSpacing: '0.16em', textTransform: 'uppercase', display: 'block', marginBottom: 6 }}>
              Admin Password
            </label>
            <input
              type="password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              placeholder="Enter admin password"
              style={{ width: '100%' }}
              autoFocus
              required
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

// ── Default export ────────────────────────────────────────────

export default function Admin() {
  const [authed, setAuthed] = useState(api.admin.isLoggedIn())
  if (!authed) return <AdminLogin onLogin={() => setAuthed(true)} />
  return <AdminPanel onLogout={() => setAuthed(false)} />
}
