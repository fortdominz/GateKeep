import { useState, useEffect, useRef, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { api } from '../api.js'

// ── Alert sounds (Web Audio API) ─────────────────────────────

function playTone(ctx, freq, delayS, durationS, volume = 0.3, type = 'square') {
  const osc  = ctx.createOscillator()
  const gain = ctx.createGain()
  osc.connect(gain)
  gain.connect(ctx.destination)
  osc.type = type
  osc.frequency.value = freq
  const t = ctx.currentTime + delayS
  gain.gain.setValueAtTime(0, t)
  gain.gain.linearRampToValueAtTime(volume, t + 0.01)
  gain.gain.setValueAtTime(volume, t + durationS - 0.01)
  gain.gain.linearRampToValueAtTime(0, t + durationS)
  osc.start(t)
  osc.stop(t + durationS + 0.05)
}

const ALERT_SOUNDS = {
  // Two short beeps — amber warning
  ELEVATED: (ctx) => {
    playTone(ctx, 880, 0.00, 0.09)
    playTone(ctx, 880, 0.20, 0.09)
  },
  // Triple rapid beep — orange danger
  HIGH: (ctx) => {
    playTone(ctx, 1100, 0.00, 0.07, 0.35)
    playTone(ctx, 1100, 0.14, 0.07, 0.35)
    playTone(ctx, 1100, 0.28, 0.07, 0.35)
  },
  // Alternating hi-lo alarm — red critical
  CRITICAL: (ctx) => {
    for (let i = 0; i < 8; i++) {
      playTone(ctx, i % 2 === 0 ? 1400 : 900, i * 0.14, 0.12, 0.5)
    }
  },
}

function useAlertSound(threatKey) {
  const ctxRef      = useRef(null)
  const prevKey     = useRef(null)
  const intervalRef = useRef(null)

  const getCtx = useCallback(() => {
    if (!ctxRef.current) {
      ctxRef.current = new (window.AudioContext || window.webkitAudioContext)()
    }
    // Resume if browser suspended it (autoplay policy)
    if (ctxRef.current.state === 'suspended') ctxRef.current.resume()
    return ctxRef.current
  }, [])

  const stopCritical = useCallback(() => {
    if (intervalRef.current) {
      clearInterval(intervalRef.current)
      intervalRef.current = null
    }
  }, [])

  useEffect(() => {
    if (!threatKey || threatKey === prevKey.current) return

    const prev = prevKey.current
    prevKey.current = threatKey

    // Going up — play sound for new level
    if (threatKey !== 'NOMINAL') {
      const ctx = getCtx()

      if (threatKey === 'CRITICAL') {
        stopCritical()
        // Play immediately then repeat every 4s
        ALERT_SOUNDS.CRITICAL(ctx)
        intervalRef.current = setInterval(() => {
          ALERT_SOUNDS.CRITICAL(getCtx())
        }, 4000)
      } else {
        // Only play if level went up or is a fresh alert
        stopCritical()
        ALERT_SOUNDS[threatKey]?.(ctx)
      }
    } else {
      // Dropped to NOMINAL — stop any repeating alarm
      stopCritical()
    }

    return () => {}
  }, [threatKey, getCtx, stopCritical])

  // Clean up on unmount
  useEffect(() => () => stopCritical(), [stopCritical])
}

// ── Detection mode switcher ──────────────────────────────────

const MODES = [
  {
    key:   'BANNED_ONLY',
    label: 'Banned Watch',
    short: 'Alerts on banned faces only',
    color: '#ff2020',
  },
  {
    key:   'ALLOWLIST_ONLY',
    label: 'Access Control',
    short: 'Alerts on unauthorized entry',
    color: '#ffaa00',
  },
  {
    key:   'COMBINED',
    label: 'Combined',
    short: 'Banned alerts + access control',
    color: '#00e676',
  },
]

function ModeBar({ currentMode }) {
  const [switching, setSwitching] = useState(null)
  const [msg,       setMsg]       = useState('')

  async function switchMode(key) {
    if (key === currentMode) return
    setSwitching(key)
    try {
      await api.admin.setMode(key)
      setMsg(`Mode set to ${key}`)
    } catch (e) {
      setMsg(e.message.includes('401') ? 'Log in to Admin to change mode' : '✗ ' + e.message)
    } finally {
      setSwitching(null)
      setTimeout(() => setMsg(''), 3000)
    }
  }

  const active = MODES.find(m => m.key === currentMode) || MODES[0]

  return (
    <div style={{
      background: 'var(--surface)', border: '1px solid var(--border)',
      padding: '14px 20px', marginBottom: 2,
      display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap',
    }}>
      <span style={{ fontFamily: 'var(--mono)', fontSize: 9, color: 'var(--text-dim)', letterSpacing: '0.2em', textTransform: 'uppercase', whiteSpace: 'nowrap' }}>
        Detection Mode
      </span>

      <div style={{ display: 'flex', gap: 4, flex: 1, flexWrap: 'wrap' }}>
        {MODES.map(m => {
          const isActive = m.key === currentMode
          return (
            <button
              key={m.key}
              onClick={() => switchMode(m.key)}
              disabled={!!switching}
              style={{
                flex: 1,
                background: isActive ? `${m.color}18` : 'none',
                border: `1px solid ${isActive ? m.color : 'var(--border)'}`,
                color: isActive ? m.color : 'var(--text-dim)',
                fontFamily: 'var(--mono)',
                fontSize: 10,
                letterSpacing: '0.14em',
                textTransform: 'uppercase',
                padding: '8px 12px',
                cursor: switching ? 'wait' : 'pointer',
                transition: 'all 0.15s',
                textAlign: 'center',
                opacity: switching && switching !== m.key ? 0.4 : 1,
              }}
            >
              {switching === m.key ? '...' : m.label}
            </button>
          )
        })}
      </div>

      <div style={{ fontFamily: 'var(--mono)', fontSize: 9, color: 'var(--text-dim)', letterSpacing: '0.1em', whiteSpace: 'nowrap' }}>
        {msg || active.short}
      </div>
    </div>
  )
}

// ── Threat level config ──────────────────────────────────────

const THREAT_LEVELS = [
  { key: 'NOMINAL',  min: 0,  max: 0,  color: '#00e676', bars: 1, desc: 'All clear — no active threats detected'       },
  { key: 'ELEVATED', min: 1,  max: 2,  color: '#ffaa00', bars: 2, desc: 'Recent activity — monitoring increased'        },
  { key: 'HIGH',     min: 3,  max: 9,  color: '#ff6600', bars: 3, desc: 'Multiple matches — immediate review required'  },
  { key: 'CRITICAL', min: 10, max: Infinity, color: '#ff2020', bars: 4, desc: 'Critical threshold exceeded — respond now' },
]

function getThreat(alertCount) {
  return THREAT_LEVELS.find(t => alertCount >= t.min && alertCount <= t.max) || THREAT_LEVELS[0]
}

function ThreatBar({ threatKey }) {
  const threat = THREAT_LEVELS.find(t => t.key === threatKey) || THREAT_LEVELS[0]
  return (
    <div
      className="threat-bar"
      style={{ '--threat-color': threat.color }}
    >
      <span className="threat-label">Threat Level</span>
      <span className={`threat-level-name${threat.key === 'CRITICAL' ? ' critical' : ''}`}>
        {threat.key}
      </span>
      <div className="threat-segments">
        {[1,2,3,4].map(i => (
          <div key={i} className={`threat-seg${i <= threat.bars ? ' active' : ''}`} />
        ))}
      </div>
      <span className="threat-desc">{threat.desc}</span>
    </div>
  )
}

// ── Alert ticker ─────────────────────────────────────────────

function AlertTicker({ alerts }) {
  if (!alerts || alerts.length === 0) {
    return (
      <div className="ticker-wrap">
        <span className="ticker-label">Live Feed</span>
        <span className="ticker-empty">// No recent events — system nominal</span>
      </div>
    )
  }

  // Duplicate items so the scroll loop is seamless
  const items = [...alerts, ...alerts]

  return (
    <div className="ticker-wrap">
      <span className="ticker-label">&#9654; Events</span>
      <div className="ticker-track">
        <div className="ticker-inner">
          {items.map((log, i) => (
            <span key={i} className="ticker-item">
              <span className="ticker-alert">[ALERT]</span>
              <span className="ticker-sep">//</span>
              <span>{log.timestamp?.slice(0,19)}</span>
              <span className="ticker-sep">—</span>
              <span>{log.matched_name}</span>
              <span className="ticker-sep">—</span>
              <span>{(log.similarity * 100).toFixed(1)}% match</span>
              <span className="ticker-sep">&nbsp;&nbsp;&nbsp;&nbsp;◆&nbsp;&nbsp;&nbsp;&nbsp;</span>
            </span>
          ))}
        </div>
      </div>
    </div>
  )
}

// ── Camera status hero ───────────────────────────────────────

function CamHero({ stats, navigate }) {
  const isLive = stats?.camera_active
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [threshold,    setThreshold]    = useState(0.45)
  const [cameraId,     setCameraId]     = useState(0)
  const [camMsg,       setCamMsg]       = useState('')
  const [busy,         setBusy]         = useState(false)

  async function startCamera() {
    setBusy(true)
    try {
      await api.startCamera(cameraId, threshold)
      setCamMsg('✓ Camera started')
    } catch (e) {
      setCamMsg('✗ ' + e.message)
    } finally {
      setBusy(false)
      setTimeout(() => setCamMsg(''), 3000)
    }
  }

  async function stopCamera() {
    setBusy(true)
    try {
      await api.stopCamera()
      setCamMsg('✓ Camera stopped')
    } catch (e) {
      setCamMsg('✗ ' + e.message)
    } finally {
      setBusy(false)
      setTimeout(() => setCamMsg(''), 3000)
    }
  }

  return (
    <div className="soc-cam-hero">
      <div className="panel-title">Primary Camera</div>

      {/* Live feed */}
      <div style={{
        background: '#000',
        border: `1px solid ${isLive ? 'rgba(255,32,32,0.3)' : 'var(--border)'}`,
        width: '100%',
        aspectRatio: '16/9',
        position: 'relative',
        overflow: 'hidden',
      }}>
        {isLive ? (
          <>
            <img
              src={api.streamUrl()}
              alt="Live feed"
              style={{ width: '100%', height: '100%', objectFit: 'contain', display: 'block' }}
            />
            {/* scanlines */}
            <div style={{
              position: 'absolute', inset: 0, zIndex: 2, pointerEvents: 'none',
              background: 'repeating-linear-gradient(0deg,transparent,transparent 3px,rgba(0,0,0,0.06) 3px,rgba(0,0,0,0.06) 4px)'
            }} />
            <div style={{ position: 'absolute', top: 8, left: 10, zIndex: 3, fontFamily: 'var(--mono)', fontSize: 10, color: 'rgba(255,255,255,0.7)', textShadow: '0 1px 6px rgba(0,0,0,0.9)', lineHeight: 1.7 }}>
              <div style={{ color: 'var(--red)' }}>● REC</div>
              <LiveClock />
            </div>
          </>
        ) : (
          <>
            <div className="feed-nosignal" />
            <div className="feed-static" />
            <div className="feed-nosignal-text">
              <span style={{ fontFamily: 'var(--mono)', fontSize: 11, color: 'rgba(255,255,255,0.35)', letterSpacing: '0.3em' }}>NO SIGNAL</span>
              <span style={{ fontFamily: 'var(--mono)', fontSize: 9, color: 'var(--text-dim)', letterSpacing: '0.18em', marginTop: 4 }}>CAM-00 OFFLINE</span>
            </div>
          </>
        )}
      </div>

      {/* Status row */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: -8 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span className={`rec-dot ${isLive ? 'live' : 'offline'}`} />
          <span style={{ fontFamily: 'var(--mono)', fontSize: 11, color: isLive ? 'var(--red)' : 'var(--text-dim)', letterSpacing: '0.1em' }}>
            {isLive ? 'LIVE — RECORDING' : 'CAMERA OFFLINE'}
          </span>
        </div>
        <button
          className="btn btn-ghost"
          onClick={() => navigate('/feed')}
          style={{ fontSize: 11, padding: '5px 12px' }}
        >
          Full Feed ↗
        </button>
      </div>

      {/* ── Settings dropdown ── */}
      <div style={{ borderTop: '1px solid var(--border)', marginTop: -4 }}>
        <button
          onClick={() => setSettingsOpen(o => !o)}
          style={{
            width: '100%', background: 'none', border: 'none',
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            padding: '10px 0', cursor: 'pointer', color: 'var(--text-dim)',
            fontFamily: 'var(--mono)', fontSize: 9, letterSpacing: '0.18em',
            textTransform: 'uppercase',
          }}
        >
          <span>// Feed Settings</span>
          <span style={{ display: 'inline-block', transform: settingsOpen ? 'rotate(180deg)' : 'none', transition: 'transform 0.2s', fontSize: 10 }}>▼</span>
        </button>

        {settingsOpen && (
          <div style={{ paddingBottom: 12, display: 'flex', flexDirection: 'column', gap: 12 }}>

            {/* Threshold */}
            <div>
              <div style={{ fontFamily: 'var(--mono)', fontSize: 9, color: 'var(--text-dim)', letterSpacing: '0.14em', textTransform: 'uppercase', marginBottom: 6 }}>
                Match Threshold — {threshold.toFixed(2)}
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <input
                  type="range" min="0.1" max="1.0" step="0.01"
                  value={threshold}
                  onChange={e => setThreshold(parseFloat(e.target.value))}
                  style={{ flex: 1, accentColor: 'var(--red)' }}
                />
                <span style={{ fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--text-mid)', minWidth: 32 }}>
                  {threshold.toFixed(2)}
                </span>
              </div>
              <div style={{ fontFamily: 'var(--mono)', fontSize: 8, color: 'var(--text-dim)', marginTop: 4, letterSpacing: '0.1em' }}>
                Lower = stricter matching. Recommended: 0.40 – 0.55
              </div>
            </div>

            {/* Camera ID */}
            <div>
              <div style={{ fontFamily: 'var(--mono)', fontSize: 9, color: 'var(--text-dim)', letterSpacing: '0.14em', textTransform: 'uppercase', marginBottom: 6 }}>
                Camera Index
              </div>
              <select
                value={cameraId}
                onChange={e => setCameraId(Number(e.target.value))}
                style={{ width: '100%' }}
              >
                <option value={0}>0 — Default / Built-in</option>
                <option value={1}>1 — External Camera</option>
                <option value={2}>2 — Camera 2</option>
                <option value={3}>3 — Camera 3</option>
              </select>
            </div>

            {/* Camera controls */}
            <div style={{ display: 'flex', gap: 8 }}>
              <button
                className="btn btn-primary"
                onClick={startCamera}
                disabled={busy || isLive}
                style={{ flex: 1, justifyContent: 'center', fontSize: 11 }}
              >
                {busy ? '...' : '▶ Start'}
              </button>
              <button
                className="btn btn-ghost"
                onClick={stopCamera}
                disabled={busy || !isLive}
                style={{ flex: 1, justifyContent: 'center', fontSize: 11 }}
              >
                {busy ? '...' : '■ Stop'}
              </button>
            </div>

            {camMsg && (
              <div style={{ fontFamily: 'var(--mono)', fontSize: 10, color: camMsg.startsWith('✓') ? 'var(--green)' : 'var(--red)', letterSpacing: '0.1em' }}>
                {camMsg}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Quick ops */}
      <div style={{ display: 'flex', gap: 6, borderTop: '1px solid var(--border)', paddingTop: 12 }}>
        <button className="btn btn-ghost" onClick={() => navigate('/enroll')} style={{ flex: 1, justifyContent: 'center', fontSize: 10 }}>
          + Enroll
        </button>
        <button className="btn btn-ghost" onClick={() => navigate('/banned')} style={{ flex: 1, justifyContent: 'center', fontSize: 10 }}>
          Watchlist
        </button>
        <button className="btn btn-ghost" onClick={() => navigate('/logs')} style={{ flex: 1, justifyContent: 'center', fontSize: 10 }}>
          Logs
        </button>
      </div>
    </div>
  )
}

function LiveClock() {
  const [ts, setTs] = useState('')
  useEffect(() => {
    const t = setInterval(() => setTs(new Date().toLocaleTimeString('en-US', { hour12: false })), 1000)
    return () => clearInterval(t)
  }, [])
  return <span>{ts}</span>
}

// ── Main dashboard ───────────────────────────────────────────

export default function Dashboard() {
  const [stats, setStats]               = useState(null)
  const [recentAlerts, setRecentAlerts] = useState([])
  const [allAlerts, setAllAlerts]       = useState([])
  const [error, setError]               = useState('')
  const navigate = useNavigate()

  // Use real-time threat from backend (resets when no banned face detected recently)
  const threatKey = stats?.current_threat ?? 'NOMINAL'
  useAlertSound(threatKey)

  useEffect(() => {
    load()
    const t = setInterval(load, 2000)
    return () => clearInterval(t)
  }, [])

  async function load() {
    try {
      const [s, recent, ticker] = await Promise.all([
        api.stats(),
        api.getLogs(5, true),
        api.getLogs(20, true),
      ])
      setStats(s)
      setRecentAlerts(recent)
      setAllAlerts(ticker)
      setError('')
    } catch (e) {
      setError(e.message)
    }
  }

  return (
    <div>
      <div className="page-header">
        <div className="page-breadcrumb">GATEKEEP &gt; <span>Dashboard</span></div>
        <div className="page-title">Command Overview</div>
      </div>

      {error && <div className="error-msg">ERR: {error}</div>}

      {/* Detection mode switcher */}
      <ModeBar currentMode={stats?.detection_mode ?? 'BANNED_ONLY'} />

      {/* Threat level — real-time, resets when no banned face present */}
      <ThreatBar threatKey={threatKey} />

      {/* Scrolling event ticker */}
      <AlertTicker alerts={allAlerts} />

      {/* SOC main layout */}
      <div className="soc-main">
        {/* Left: Camera hero */}
        <CamHero stats={stats} navigate={navigate} />

        {/* Right: Readout column */}
        <div className="soc-readouts">
          <div className="readout-cell">
            <div className="readout-label">Banned / Allowed</div>
            <div className={`readout-value${(stats?.banned_count ?? 0) > 0 ? ' red' : ''}`}>
              {stats?.banned_count ?? '—'}
              <span style={{ fontSize: 14, color: 'var(--green)', marginLeft: 6 }}>
                / {stats?.allowed_count ?? '—'}
              </span>
            </div>
            <div className="readout-sub">watchlist / access list</div>
          </div>

          <div className="readout-cell">
            <div className="readout-label">Banned Alerts / 24h</div>
            <div className={`readout-value${(stats?.alerts_last_24h ?? 0) > 0 ? ' red' : ' green'}`}>
              {stats?.alerts_last_24h ?? '—'}
            </div>
            <div className="readout-sub">banned face matches</div>
          </div>

          <div className="readout-cell">
            <div className="readout-label">Unauthorized / 24h</div>
            <div className={`readout-value${(stats?.unauthorized_last_24h ?? 0) > 0 ? ' amber' : ' green'}`}>
              {stats?.unauthorized_last_24h ?? '—'}
            </div>
            <div className="readout-sub">unauthorized entries</div>
          </div>

          <div className="readout-cell" style={{ flex: 2 }}>
            <div className="readout-label">System Info</div>
            {[
              ['Mode',            stats?.detection_mode ?? '—'],
              ['Known Entries/24h', stats?.known_entries_last_24h ?? '—'],
              ['Detection Model', 'buffalo_l'],
              ['Match Algorithm', 'Cosine Sim'],
              ['Storage',         'SQLite'],
            ].map(([k, v]) => (
              <div key={k} className="info-row">
                <span className="info-key">{k}</span>
                <span className="info-val">{v}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Recent alerts table */}
      <div className="panel" style={{ marginTop: 2 }}>
        <div className="panel-title">Recent Alert Events</div>
        {recentAlerts.length === 0 ? (
          <div className="empty-state">
            <div className="empty-label">// no alerts</div>
            <p>System clear — no threat events logged</p>
          </div>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Timestamp</th>
                  <th>Camera</th>
                  <th>Subject</th>
                  <th>Confidence</th>
                </tr>
              </thead>
              <tbody>
                {recentAlerts.map(log => (
                  <tr key={log.id} className="alert-row">
                    <td className="mono-cell">{log.timestamp?.slice(0, 19)}</td>
                    <td className="mono-cell" style={{ color: 'var(--text-dim)' }}>{log.camera_id}</td>
                    <td style={{ fontWeight: 700 }}>{log.matched_name}</td>
                    <td>
                      <span className="badge badge-red">{(log.similarity * 100).toFixed(1)}%</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <div style={{ marginTop: 14 }}>
          <button className="btn btn-ghost" onClick={() => navigate('/logs')} style={{ fontSize: 11 }}>
            View Full Log
          </button>
        </div>
      </div>
    </div>
  )
}
