const BASE = (import.meta.env.VITE_API_URL || '') + '/api'

// ── Session ID (UUID per visitor, persisted in localStorage) ─────────────────

function _generateUUID() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
    const r = Math.random() * 16 | 0
    const v = c === 'x' ? r : (r & 0x3 | 0x8)
    return v.toString(16)
  })
}

const SESSION_KEY = 'gk-session-id'

export function getSessionId() {
  let id = localStorage.getItem(SESSION_KEY)
  if (!id) {
    id = _generateUUID()
    localStorage.setItem(SESSION_KEY, id)
  }
  return id
}

/** Append ?session_id=... to any path */
function withSession(path) {
  const sep = path.includes('?') ? '&' : '?'
  return `${path}${sep}session_id=${getSessionId()}`
}

// ── Generic request helpers ───────────────────────────────────────────────────

async function req(method, path, body) {
  const opts = { method, headers: { 'Content-Type': 'application/json' } }
  if (body !== undefined) opts.body = JSON.stringify(body)
  const res = await fetch(BASE + path, opts)
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: res.statusText }))
    throw new Error(err.detail || 'Request failed')
  }
  const text = await res.text()
  return text ? JSON.parse(text) : null
}

const get  = (path)       => req('GET',    path)
const post = (path, body) => req('POST',   path, body)
const del  = (path)       => req('DELETE', path)

// ── Admin auth helpers ────────────────────────────────────────────────────────

const TOKEN_KEY  = 'gk-admin-token'
const getToken   = () => sessionStorage.getItem(TOKEN_KEY)
const setToken   = (t) => sessionStorage.setItem(TOKEN_KEY, t)
const clearToken = () => sessionStorage.removeItem(TOKEN_KEY)

async function adminReq(method, path, body) {
  const token = getToken()
  const opts = {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { 'X-Admin-Token': token } : {}),
    },
  }
  if (body !== undefined) opts.body = JSON.stringify(body)
  const res = await fetch(BASE + path, opts)
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: res.statusText }))
    throw new Error(err.detail || 'Request failed')
  }
  const text = await res.text()
  return text ? JSON.parse(text) : null
}

const adminGet  = (path)       => adminReq('GET',    path)
const adminPost = (path, body) => adminReq('POST',   path, body)
const adminDel  = (path)       => adminReq('DELETE', path)

// ── Public API ────────────────────────────────────────────────────────────────

export const api = {
  health: () => get('/health'),
  stats:  () => get(withSession('/stats')),

  // Banned list
  getBanned:    ()    => get(withSession('/banned')),
  deleteBanned: (id)  => del(withSession(`/banned/${id}`)),

  // Allowed faces
  getAllowed:    ()    => get(withSession('/allowed')),
  deleteAllowed: (id) => del(withSession(`/allowed/${id}`)),

  // Detection mode
  getMode: () => get(withSession('/mode')),

  // Detection logs
  // log_type: 'all' | 'alerts' | 'BANNED_ALERT' | 'UNAUTHORIZED' | 'KNOWN_ENTRY' | 'UNKNOWN'
  getLogs: (limit = 50, alertsOnly = false, logType = 'all') => {
    const params = new URLSearchParams({
      limit,
      session_id: getSessionId(),
    })
    if (alertsOnly) params.set('alerts_only', 'true')
    if (logType && logType !== 'all') params.set('log_type', logType)
    return get(`/logs?${params}`)
  },

  /**
   * Send a JPEG Blob from the browser camera to the backend for detection.
   * Returns { faces, threat, model_ready, mode }
   */
  detect: async (jpegBlob) => {
    const form = new FormData()
    form.append('session_id', getSessionId())
    form.append('image', jpegBlob, 'frame.jpg')
    const res = await fetch(`${BASE}/detect`, { method: 'POST', body: form })
    if (!res.ok) {
      const err = await res.json().catch(() => ({ detail: res.statusText }))
      throw new Error(err.detail || 'Detect failed')
    }
    return res.json()
  },

  // ── Admin ──────────────────────────────────────────────────────────────────
  admin: {
    isLoggedIn: () => !!getToken(),

    login: async (password) => {
      const data = await post('/admin/login', { password })
      setToken(data.token)
      return data
    },

    logout: async () => {
      try { await adminPost('/admin/logout') } catch {}
      clearToken()
    },

    changePassword: (new_password) =>
      adminPost('/admin/change-password', { new_password }),

    clearLogs: (logType = null) => {
      const base = `/admin/logs?session_id=${getSessionId()}`
      return adminDel(logType ? `${base}&log_type=${logType}` : base)
    },

    setMode: (mode) => post(withSession('/mode'), { mode }),

    wipeSnapshots: () => adminDel('/admin/snapshots'),

    setThreshold: (threshold) =>
      adminPost(withSession('/admin/threshold'), { threshold }),

    exportSnapshots: async (paths) => {
      const token = getToken()
      const res = await fetch(`${BASE}/snapshots/export`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { 'X-Admin-Token': token } : {}),
        },
        body: JSON.stringify({ paths }),
      })
      if (!res.ok) throw new Error('Export failed')
      return res.blob()
    },
  },
}
