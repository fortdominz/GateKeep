const BASE = (import.meta.env.VITE_API_URL || '') + '/api'

// ── Generic request helpers ───────────────────────────────────

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

// ── Admin auth helpers ────────────────────────────────────────

const TOKEN_KEY = 'gk-admin-token'
const getToken  = () => sessionStorage.getItem(TOKEN_KEY)
const setToken  = (t) => sessionStorage.setItem(TOKEN_KEY, t)
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

const adminGet = (path)       => adminReq('GET',    path)
const adminPost = (path, body) => adminReq('POST',   path, body)
const adminDel  = (path)       => adminReq('DELETE', path)

// ── Public API ────────────────────────────────────────────────

export const api = {
  health:       ()                  => get('/health'),
  stats:        ()                  => get('/stats'),

  // Banned list
  getBanned:    ()                  => get('/banned'),
  deleteBanned: (id)                => del(`/banned/${id}`),

  // Detection logs
  getLogs:      (limit = 50, alertsOnly = false) =>
    get(`/logs?limit=${limit}&alerts_only=${alertsOnly}`),

  // Camera
  startCamera:  (camera_id = 0, threshold = 0.45) =>
    post('/camera/start', { camera_id, threshold }),
  stopCamera:   ()                  => post('/camera/stop', {}),
  cameraStatus: ()                  => get('/camera/status'),

  // MJPEG stream URL (used directly in <img src={...}>)
  streamUrl:    ()                  => `${BASE}/stream`,

  // ── Admin ─────────────────────────────────────────────────
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

    clearLogs: () => adminDel('/admin/logs'),

    wipeSnapshots: () => adminDel('/admin/snapshots'),

    setThreshold: (threshold) =>
      adminPost('/admin/threshold', { threshold }),

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
