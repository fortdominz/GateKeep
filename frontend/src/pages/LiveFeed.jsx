import { useState, useEffect, useRef, useCallback } from 'react'
import { api } from '../api.js'

// ── Clock overlay ─────────────────────────────────────────────

function LiveClock() {
  const [ts, setTs] = useState('')
  useEffect(() => {
    const tick = () => {
      const now = new Date()
      const d  = now.toLocaleDateString('en-US', { year: 'numeric', month: '2-digit', day: '2-digit' })
      const tm = now.toLocaleTimeString('en-US', { hour12: false })
      setTs(`${d}  ${tm}`)
    }
    tick()
    const t = setInterval(tick, 1000)
    return () => clearInterval(t)
  }, [])
  return <span className="feed-text">{ts}</span>
}

// ── Constants ─────────────────────────────────────────────────

const DETECT_FPS = 4   // frames per second sent to backend

const BOX_COLORS = {
  BANNED_ALERT: '#ff2020',
  UNAUTHORIZED: '#ff6600',
  KNOWN_ENTRY:  '#00e676',
  UNKNOWN:      '#00ccff',
}

const THREAT_COLORS = {
  NOMINAL:  '#00e676',
  ELEVATED: '#ffaa00',
  HIGH:     '#ff6600',
  CRITICAL: '#ff2020',
}

// ── Main component ────────────────────────────────────────────

export default function LiveFeed() {
  // Refs
  const videoRef      = useRef(null)   // <video> element (hidden — source for canvas)
  const captureRef    = useRef(null)   // hidden canvas — frame capture only
  const overlayRef    = useRef(null)   // visible canvas — detection boxes drawn here
  const containerRef  = useRef(null)   // feed container div
  const streamRef     = useRef(null)   // MediaStream
  const timerRef      = useRef(null)   // setInterval handle
  const detectingRef  = useRef(false)  // prevent overlapping API calls
  const latestFaces   = useRef([])     // latest detection results for redraw

  // State
  const [isLive,      setIsLive]      = useState(false)
  const [threat,      setThreat]      = useState('NOMINAL')
  const [modelReady,  setModelReady]  = useState(false)
  const [mode,        setMode]        = useState('BANNED_ONLY')
  const [error,       setError]       = useState('')
  const [camError,    setCamError]    = useState('')
  const [threshold,   setThreshold]   = useState(0.45)
  const [devices,     setDevices]     = useState([])
  const [selectedDev, setSelectedDev] = useState('')  // deviceId string

  // ── Enumerate cameras ─────────────────────────────────────
  useEffect(() => {
    if (!navigator.mediaDevices?.enumerateDevices) return
    navigator.mediaDevices.enumerateDevices()
      .then(devs => {
        const cams = devs.filter(d => d.kind === 'videoinput')
        setDevices(cams)
        if (cams.length > 0 && !selectedDev) setSelectedDev(cams[0].deviceId)
      })
      .catch(() => {})
  }, [])

  // ── Draw detection boxes on overlay canvas ────────────────
  const drawOverlay = useCallback(() => {
    const canvas    = overlayRef.current
    const video     = videoRef.current
    const container = containerRef.current
    if (!canvas || !video || !container) return

    const cW = container.offsetWidth
    const cH = container.offsetHeight
    canvas.width  = cW
    canvas.height = cH

    const ctx = canvas.getContext('2d')
    ctx.clearRect(0, 0, cW, cH)

    const vW = video.videoWidth
    const vH = video.videoHeight
    if (!vW || !vH) return

    // objectFit: contain — compute actual rendered area
    const scale   = Math.min(cW / vW, cH / vH)
    const renderW = vW * scale
    const renderH = vH * scale
    const offX    = (cW - renderW) / 2
    const offY    = (cH - renderH) / 2

    for (const face of latestFaces.current) {
      const color = BOX_COLORS[face.log_type] || '#00ccff'
      const x = offX + face.bbox_pct.x * renderW
      const y = offY + face.bbox_pct.y * renderH
      const w = face.bbox_pct.w * renderW
      const h = face.bbox_pct.h * renderH

      // Box
      ctx.strokeStyle = color
      ctx.lineWidth   = 2
      ctx.strokeRect(x, y, w, h)

      // Label background + text
      ctx.font         = '10px monospace'
      const textW      = ctx.measureText(face.label).width + 8
      const labelY     = y > 18 ? y - 18 : y + h + 2
      ctx.fillStyle    = `${color}cc`
      ctx.fillRect(x, labelY, textW, 16)
      ctx.fillStyle    = '#000'
      ctx.fillText(face.label, x + 4, labelY + 11)
    }
  }, [])

  // ── Resize observer — redraw when container changes ───────
  useEffect(() => {
    if (!containerRef.current) return
    const ro = new ResizeObserver(drawOverlay)
    ro.observe(containerRef.current)
    return () => ro.disconnect()
  }, [drawOverlay])

  // ── Send a frame to /api/detect ───────────────────────────
  const sendFrame = useCallback(async () => {
    if (detectingRef.current) return
    const video   = videoRef.current
    const capture = captureRef.current
    if (!video || !capture || video.readyState < 2) return

    const vW = video.videoWidth
    const vH = video.videoHeight
    if (!vW || !vH) return

    capture.width  = vW
    capture.height = vH
    capture.getContext('2d').drawImage(video, 0, 0, vW, vH)

    detectingRef.current = true
    try {
      const blob = await new Promise(res => capture.toBlob(res, 'image/jpeg', 0.7))
      if (!blob) return
      const result = await api.detect(blob)
      latestFaces.current = result.faces || []
      setThreat(result.threat   || 'NOMINAL')
      setModelReady(result.model_ready ?? false)
      setMode(result.mode       || 'BANNED_ONLY')
      setError('')
      drawOverlay()
    } catch (e) {
      // Don't surface transient network errors loudly
      if (!e.message.includes('fetch')) setError(e.message)
    } finally {
      detectingRef.current = false
    }
  }, [drawOverlay])

  // ── Start browser camera ──────────────────────────────────
  const startCamera = useCallback(async () => {
    setCamError('')
    setError('')
    try {
      const constraints = selectedDev
        ? { video: { deviceId: { exact: selectedDev }, width: { ideal: 640 }, height: { ideal: 480 } } }
        : { video: { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 480 } } }

      const stream = await navigator.mediaDevices.getUserMedia(constraints)
      streamRef.current = stream

      const video = videoRef.current
      if (video) {
        video.srcObject = stream
        await video.play()
      }

      // If devices weren't labelled before (need permission first), re-enumerate
      navigator.mediaDevices.enumerateDevices()
        .then(devs => setDevices(devs.filter(d => d.kind === 'videoinput')))
        .catch(() => {})

      setIsLive(true)

      // Sync threshold to backend
      try { await api.admin.setThreshold(threshold) } catch {}

      // Start detection loop
      timerRef.current = setInterval(sendFrame, 1000 / DETECT_FPS)
    } catch (e) {
      if (e.name === 'NotAllowedError') {
        setCamError('Camera access denied. Click the camera icon in your browser address bar to allow it.')
      } else if (e.name === 'NotFoundError') {
        setCamError('No camera detected. Connect a webcam and try again.')
      } else if (e.name === 'NotReadableError') {
        setCamError('Camera is in use by another application.')
      } else {
        setCamError('Could not start camera: ' + e.message)
      }
    }
  }, [selectedDev, threshold, sendFrame])

  // ── Stop browser camera ───────────────────────────────────
  const stopCamera = useCallback(() => {
    clearInterval(timerRef.current)
    timerRef.current = null
    streamRef.current?.getTracks().forEach(t => t.stop())
    streamRef.current = null
    if (videoRef.current) videoRef.current.srcObject = null
    latestFaces.current = []
    setIsLive(false)
    setThreat('NOMINAL')
    // Clear overlay
    const canvas = overlayRef.current
    if (canvas) canvas.getContext('2d').clearRect(0, 0, canvas.width, canvas.height)
  }, [])

  // Cleanup on unmount
  useEffect(() => () => {
    clearInterval(timerRef.current)
    streamRef.current?.getTracks().forEach(t => t.stop())
  }, [])

  const threatColor = THREAT_COLORS[threat] || '#00e676'
  const sessionId   = localStorage.getItem('gk-session-id') || '?'

  return (
    <div>
      <div className="page-header">
        <div className="page-breadcrumb">GATEKEEP &gt; <span>Live Feed</span></div>
        <div className="page-title">Live Feed</div>
      </div>

      {camError && <div className="error-msg">{camError}</div>}
      {error    && !camError && (
        <div className="error-msg" style={{ opacity: 0.7, fontSize: 10 }}>ERR: {error}</div>
      )}

      {/* ── Feed window ── */}
      <div className="feed-outer">
        <div
          ref={containerRef}
          className="feed-container"
          style={{ position: 'relative', overflow: 'hidden' }}
        >
          {/* Hidden video element — source stream */}
          <video
            ref={videoRef}
            muted
            playsInline
            style={{
              width: '100%', height: '100%',
              objectFit: 'contain', display: 'block',
              opacity: isLive ? 1 : 0,
            }}
          />

          {/* Hidden canvas — frame capture */}
          <canvas ref={captureRef} style={{ display: 'none' }} />

          {/* Visible canvas — bounding box overlay */}
          <canvas
            ref={overlayRef}
            style={{
              position: 'absolute', inset: 0,
              width: '100%', height: '100%',
              pointerEvents: 'none', zIndex: 2,
              display: isLive ? 'block' : 'none',
            }}
          />

          {/* No signal state */}
          {!isLive && (
            <>
              <div className="feed-nosignal" />
              <div className="feed-static" />
              <div className="feed-nosignal-text">
                <span style={{ fontFamily: 'var(--mono)', fontSize: 13, color: 'rgba(255,255,255,0.35)', letterSpacing: '0.35em' }}>
                  NO SIGNAL
                </span>
                <span style={{ fontFamily: 'var(--mono)', fontSize: 9, color: 'var(--text-dim)', letterSpacing: '0.2em', marginTop: 6 }}>
                  BROWSER CAMERA OFFLINE
                </span>
                <span style={{ fontFamily: 'var(--mono)', fontSize: 9, color: 'var(--text-dim)', letterSpacing: '0.12em', marginTop: 2, opacity: 0.5 }}>
                  Allow camera access · click Start Feed below
                </span>
              </div>
            </>
          )}

          {/* Scanlines */}
          {isLive && (
            <div style={{
              position: 'absolute', inset: 0, zIndex: 3, pointerEvents: 'none',
              background: 'repeating-linear-gradient(0deg,transparent,transparent 3px,rgba(0,0,0,0.05) 3px,rgba(0,0,0,0.05) 4px)',
            }} />
          )}

          {/* Top-left: REC + clock + session */}
          {isLive && (
            <div className="feed-overlay-tl" style={{ zIndex: 4, pointerEvents: 'none' }}>
              <span className="feed-text red">● REC</span>
              <LiveClock />
              <span className="feed-text" style={{ fontSize: 8, opacity: 0.6 }}>
                SID:{sessionId.slice(0, 8)}
              </span>
            </div>
          )}

          {/* Top-right: threat + model status */}
          {isLive && (
            <div className="feed-overlay-tr" style={{ zIndex: 4, pointerEvents: 'none', textAlign: 'right' }}>
              <span className="feed-text" style={{ color: threatColor, fontWeight: 700, letterSpacing: '0.2em' }}>
                {threat}
              </span>
              <span className="feed-text" style={{ fontSize: 9, opacity: 0.6 }}>
                {modelReady ? 'MODEL OK' : 'MODEL LOADING'}
              </span>
              <span className="feed-text" style={{ fontSize: 9, opacity: 0.5 }}>
                {mode.replace('_', ' ')}
              </span>
            </div>
          )}

          {/* Bottom-left: legend */}
          {isLive && (
            <div className="feed-overlay-bl" style={{ zIndex: 4, pointerEvents: 'none' }}>
              <span className="feed-text" style={{ fontSize: 8 }}>
                <span style={{ color: '#ff2020' }}>■</span> BANNED &nbsp;
                <span style={{ color: '#ff6600' }}>■</span> UNAUTH &nbsp;
                <span style={{ color: '#00e676' }}>■</span> ALLOWED
              </span>
            </div>
          )}
        </div>

        {/* CCTV corner brackets */}
        <div className="feed-corner-tl" />
        <div className="feed-corner-tr" />
        <div className="feed-corner-bl" />
        <div className="feed-corner-br" />
      </div>

      {/* ── Camera controls ── */}
      <div className="panel-secondary" style={{ maxWidth: 520 }}>
        <div className="panel-title">Camera Controls</div>

        {/* Device selector */}
        {devices.length > 0 && (
          <div className="form-group">
            <label>Camera Device</label>
            <select
              value={selectedDev}
              onChange={e => setSelectedDev(e.target.value)}
              disabled={isLive}
            >
              {devices.map((d, i) => (
                <option key={d.deviceId} value={d.deviceId}>
                  {d.label || `Camera ${i + 1}`}
                </option>
              ))}
            </select>
          </div>
        )}

        {/* Threshold */}
        <div className="form-group">
          <label>Match Threshold — {threshold.toFixed(2)}</label>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <input
              type="range" min={0.1} max={0.99} step={0.01}
              value={threshold}
              onChange={e => setThreshold(Number(e.target.value))}
              style={{ flex: 1, accentColor: 'var(--red)' }}
              disabled={isLive}
            />
            <span style={{ fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--text-mid)', minWidth: 36 }}>
              {threshold.toFixed(2)}
            </span>
          </div>
          <div style={{ fontFamily: 'var(--mono)', fontSize: 8, color: 'var(--text-dim)', marginTop: 4, letterSpacing: '0.1em' }}>
            Lower = stricter matching · Recommended: 0.40 – 0.55
          </div>
        </div>

        {/* Start / Stop */}
        <div style={{ display: 'flex', gap: 10 }}>
          {!isLive ? (
            <button className="btn btn-primary" onClick={startCamera}>
              ▶ Start Feed
            </button>
          ) : (
            <button className="btn btn-danger" onClick={stopCamera}>
              ■ Stop Feed
            </button>
          )}
        </div>

        <p style={{ marginTop: 16, fontFamily: 'var(--mono)', fontSize: 10, color: 'var(--text-dim)', lineHeight: 1.9, letterSpacing: '0.06em' }}>
          Your browser will request camera permission. Frames are sent to the detection
          server at {DETECT_FPS} fps. Face data never leaves the session — all detections
          are scoped to your unique session ID.
        </p>
      </div>
    </div>
  )
}
