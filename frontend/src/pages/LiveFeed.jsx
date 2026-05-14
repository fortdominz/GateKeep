import { useState, useEffect, useRef } from 'react'
import { api } from '../api.js'

function LiveClock() {
  const [ts, setTs] = useState('')
  useEffect(() => {
    const t = setInterval(() => {
      const now = new Date()
      const d = now.toLocaleDateString('en-US', { year: 'numeric', month: '2-digit', day: '2-digit' })
      const tm = now.toLocaleTimeString('en-US', { hour12: false })
      setTs(`${d}  ${tm}`)
    }, 1000)
    return () => clearInterval(t)
  }, [])
  return <span className="feed-text">{ts}</span>
}

export default function LiveFeed() {
  const [status, setStatus]     = useState(null)
  const [error, setError]       = useState('')
  const [loading, setLoading]   = useState(false)
  const [threshold, setThreshold] = useState(0.45)
  const [cameraId, setCameraId]   = useState(0)
  const imgRef = useRef(null)

  useEffect(() => { loadStatus() }, [])

  async function loadStatus() {
    try {
      const s = await api.cameraStatus()
      setStatus(s)
      if (s.active) setThreshold(s.threshold)
    } catch {}
  }

  async function handleStart() {
    setLoading(true)
    setError('')
    try {
      await api.startCamera(cameraId, threshold)
      await loadStatus()
      if (imgRef.current) {
        imgRef.current.src = api.streamUrl() + '?t=' + Date.now()
      }
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }

  async function handleStop() {
    setLoading(true)
    setError('')
    try {
      await api.stopCamera()
      await loadStatus()
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }

  const isLive = status?.active

  return (
    <div>
      <div className="page-header">
        <div className="page-breadcrumb">GATEKEEP &gt; <span>Live Feed</span></div>
        <div className="page-title">Live Feed</div>
      </div>

      {error && <div className="error-msg">ERR: {error}</div>}

      {/* Feed with CCTV corner brackets */}
      <div className="feed-outer">
        <div className="feed-container">
          {isLive ? (
            <>
              <img
                ref={imgRef}
                src={api.streamUrl()}
                alt="Live camera feed"
                onError={() => setError('Stream disconnected. Try restarting.')}
              />
              <div className="feed-scanlines" />
              <div className="feed-overlay-tl">
                <span className="feed-text red">● REC</span>
                <LiveClock />
                <span className="feed-text">CAM-{cameraId.toString().padStart(2,'0')}</span>
              </div>
              <div className="feed-overlay-tr">
                <span className="feed-text">GATEKEEP v1.0</span>
                <br />
                <span className="feed-text" style={{ fontSize: 10 }}>THR: {threshold.toFixed(2)}</span>
              </div>
              <div className="feed-overlay-bl">
                <span className="feed-text" style={{ fontSize: 10 }}>RED=MATCH &nbsp; GREEN=UNKNOWN</span>
              </div>
            </>
          ) : (
            <>
              <div className="feed-nosignal" />
              <div className="feed-static" />
              <div className="feed-nosignal-text">
                <span style={{ fontFamily: 'var(--mono)', fontSize: 13, color: 'rgba(255,255,255,0.35)', letterSpacing: '0.35em' }}>NO SIGNAL</span>
                <span style={{ fontFamily: 'var(--mono)', fontSize: 9, color: 'var(--text-dim)', letterSpacing: '0.2em', marginTop: 6 }}>CAM-{cameraId.toString().padStart(2,'0')} OFFLINE</span>
                <span style={{ fontFamily: 'var(--mono)', fontSize: 9, color: 'var(--text-dim)', letterSpacing: '0.14em', marginTop: 2, opacity: 0.5 }}>Start camera below to activate feed</span>
              </div>
            </>
          )}
        </div>
        <div className="feed-corner-bl" />
        <div className="feed-corner-br" />
      </div>

      {/* Controls */}
      <div className="panel-secondary" style={{ maxWidth: 500 }}>
        <div className="panel-title">Camera Controls</div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14, marginBottom: 16 }}>
          <div className="form-group" style={{ margin: 0 }}>
            <label>Camera Index</label>
            <input
              type="number" min={0} max={5}
              value={cameraId}
              onChange={e => setCameraId(Number(e.target.value))}
              disabled={isLive}
            />
          </div>
          <div className="form-group" style={{ margin: 0 }}>
            <label>Match Threshold</label>
            <input
              type="number" min={0.1} max={0.99} step={0.01}
              value={threshold}
              onChange={e => setThreshold(Number(e.target.value))}
              disabled={isLive}
            />
          </div>
        </div>

        <div style={{ display: 'flex', gap: 10 }}>
          {!isLive ? (
            <button className="btn btn-primary" onClick={handleStart} disabled={loading}>
              {loading ? 'Starting...' : 'Start Feed'}
            </button>
          ) : (
            <button className="btn btn-danger" onClick={handleStop} disabled={loading}>
              {loading ? 'Stopping...' : 'Stop Feed'}
            </button>
          )}
        </div>

        <p style={{ marginTop: 14, fontFamily: 'var(--mono)', fontSize: 10, color: 'var(--text-dim)', lineHeight: 1.8, letterSpacing: '0.06em' }}>
          Threshold 0.45 is recommended. Lower = more detections, higher false positive risk.
          Matching runs every 300ms to avoid CPU saturation.
        </p>
      </div>
    </div>
  )
}
