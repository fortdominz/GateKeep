import { BrowserRouter, Routes, Route, NavLink } from 'react-router-dom'
import { useState, useEffect } from 'react'
import Dashboard   from './pages/Dashboard.jsx'
import LiveFeed    from './pages/LiveFeed.jsx'
import BannedList  from './pages/BannedList.jsx'
import AllowedList from './pages/AllowedList.jsx'
import Enroll      from './pages/Enroll.jsx'
import AlertLog    from './pages/AlertLog.jsx'
import Admin       from './pages/Admin.jsx'
import { api, getSessionId } from './api.js'

// Ensure session ID is created on first load
getSessionId()

const NAV = [
  { path: '/',        label: 'Dashboard',   short: 'F1' },
  { path: '/feed',    label: 'Live Feed',   short: 'F2' },
  { path: '/banned',  label: 'Banned List', short: 'F3' },
  { path: '/allowed', label: 'Access List', short: 'F4' },
  { path: '/enroll',  label: 'Enroll',      short: 'F5' },
  { path: '/logs',    label: 'Alert Log',   short: 'F6' },
  { path: '/admin',   label: 'Admin',       short: 'F7', admin: true },
]

function useUptime() {
  const [start] = useState(Date.now())
  const [uptime, setUptime] = useState('00:00:00')
  useEffect(() => {
    const t = setInterval(() => {
      const s = Math.floor((Date.now() - start) / 1000)
      const h = String(Math.floor(s / 3600)).padStart(2, '0')
      const m = String(Math.floor((s % 3600) / 60)).padStart(2, '0')
      const sec = String(s % 60).padStart(2, '0')
      setUptime(`${h}:${m}:${sec}`)
    }, 1000)
    return () => clearInterval(t)
  }, [start])
  return uptime
}

function useClock() {
  const [time, setTime] = useState('')
  useEffect(() => {
    const tick = () => setTime(new Date().toLocaleTimeString('en-US', { hour12: false }))
    tick()
    const t = setInterval(tick, 1000)
    return () => clearInterval(t)
  }, [])
  return time
}

function useTheme() {
  const [theme, setTheme] = useState(() => localStorage.getItem('gk-theme') || 'dark')

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme)
    localStorage.setItem('gk-theme', theme)
  }, [theme])

  const toggle = () => setTheme(t => t === 'dark' ? 'light' : 'dark')
  return { theme, toggle }
}

function Sidebar({ stats, theme, onThemeToggle }) {
  const uptime = useUptime()
  const clock  = useClock()

  return (
    <aside className="sidebar">
      <div className="sidebar-logo">
        <div className="system-id">// gatekeep sys v1.0</div>
        <div className="brand brand-glitch">WAR<span>DEN</span></div>
        <div className="sub">Intruders Camera System</div>
        <div className="armed-badge">
          <span className="dot-pulse" />
          System Armed
        </div>
      </div>

      <nav className="sidebar-nav">
        <div className="nav-section-label">// Navigation</div>
        {NAV.filter(n => !n.admin).map(({ path, label, short }) => (
          <NavLink
            key={path}
            to={path}
            end={path === '/'}
            className={({ isActive }) => `nav-item${isActive ? ' active' : ''}`}
          >
            <span className="nav-light" />
            <span className="nav-label">{label}</span>
            <span className="nav-shortcut">{short}</span>
          </NavLink>
        ))}
        <div className="nav-section-label" style={{ marginTop: 12 }}>// Admin</div>
        {NAV.filter(n => n.admin).map(({ path, label, short }) => (
          <NavLink
            key={path}
            to={path}
            end={path === '/'}
            className={({ isActive }) => `nav-item${isActive ? ' active' : ''}`}
          >
            <span className="nav-light" style={{ background: 'var(--amber)' }} />
            <span className="nav-label" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span style={{ fontSize: 9, opacity: 0.7 }}>⬡</span>
              {label}
            </span>
            <span className="nav-shortcut">{short}</span>
          </NavLink>
        ))}
      </nav>

      <div className="sidebar-footer">
        <div className="sys-row">
          <span className="sys-label">Uptime</span>
          <span className="sys-val">{uptime}</span>
        </div>
        <div className="sys-row">
          <span className="sys-label">Clock</span>
          <span className="sys-val">{clock}</span>
        </div>
        <div className="sys-row">
          <span className="sys-label">Mode</span>
          <span className="sys-val" style={{ fontSize: 9, letterSpacing: '0.08em' }}>
            {(stats?.detection_mode || 'BANNED_ONLY').replace('_', ' ')}
          </span>
        </div>
        <div className="sys-row">
          <span className="sys-label">Banned</span>
          <span className="sys-val" style={{ color: stats?.banned_count > 0 ? 'var(--red)' : 'var(--text-mid)' }}>
            {stats?.banned_count ?? '—'}
          </span>
        </div>
        <div className="sys-row">
          <span className="sys-label">Allowed</span>
          <span className="sys-val" style={{ color: stats?.allowed_count > 0 ? 'var(--green)' : 'var(--text-mid)' }}>
            {stats?.allowed_count ?? '—'}
          </span>
        </div>
        <div className="sys-row">
          <span className="sys-label">Alerts 24h</span>
          <span className="sys-val" style={{ color: stats?.alerts_last_24h > 0 ? 'var(--amber)' : 'var(--text-mid)' }}>
            {stats?.alerts_last_24h ?? '—'}
          </span>
        </div>
        <button className="theme-toggle" onClick={onThemeToggle}>
          <span className="theme-toggle-icon">{theme === 'dark' ? '○' : '●'}</span>
          {theme === 'dark' ? 'Light Mode' : 'Dark Mode'}
        </button>
      </div>
    </aside>
  )
}

function StatusBar({ stats }) {
  const clock = useClock()
  const sid   = getSessionId().slice(0, 8)
  return (
    <div className="status-bar">
      <div className="sb-item">
        SID&nbsp;<span className="sb-val" style={{ color: 'var(--text-dim)', fontSize: 9 }}>{sid}</span>
      </div>
      <div className="sb-item">
        BANNED&nbsp;<span className="sb-val red">{stats?.banned_count ?? '—'}</span>
      </div>
      <div className="sb-item">
        DETECTIONS&nbsp;<span className="sb-val">{stats?.total_detections ?? '—'}</span>
      </div>
      <div className="sb-right">
        <div className="sb-item">
          ALERTS/24H&nbsp;<span className="sb-val amber">{stats?.alerts_last_24h ?? '—'}</span>
        </div>
        <div className="sb-item">
          <span className="sb-val">{clock}</span>
        </div>
      </div>
    </div>
  )
}

function AppShell() {
  const [stats, setStats] = useState(null)
  const { theme, toggle } = useTheme()

  useEffect(() => {
    const load = async () => {
      try { setStats(await api.stats()) } catch {}
    }
    load()
    const t = setInterval(load, 15000)
    return () => clearInterval(t)
  }, [])

  return (
    <div className="layout">
      <div className="vignette" />
      <Sidebar stats={stats} theme={theme} onThemeToggle={toggle} />
      <main className="main-content">
        <Routes>
          <Route path="/"       element={<Dashboard />} />
          <Route path="/feed"   element={<LiveFeed />} />
          <Route path="/banned" element={<BannedList />} />
          <Route path="/enroll" element={<Enroll />} />
          <Route path="/allowed" element={<AllowedList />} />
          <Route path="/logs"   element={<AlertLog />} />
          <Route path="/admin"  element={<Admin />} />
        </Routes>
      </main>
      <StatusBar stats={stats} />
    </div>
  )
}

export default function App() {
  return (
    <BrowserRouter>
      <AppShell />
    </BrowserRouter>
  )
}
