const BASE = import.meta.env.VITE_API_URL || '/api'
const TOKEN_KEY = 'slipstream_token'

export const getToken = () => localStorage.getItem(TOKEN_KEY)
export const setToken = (t) => (t ? localStorage.setItem(TOKEN_KEY, t) : localStorage.removeItem(TOKEN_KEY))

/**
 * Errors carry the server's per-field detail so forms can highlight the exact
 * input that failed instead of dumping one message at the top of the screen.
 */
export class ApiError extends Error {
  constructor(message, { status, field, errors } = {}) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.field = field
    this.errors = errors || (field ? { [field]: message } : undefined)
  }
}

async function request(path, { method = 'GET', body, signal } = {}) {
  const headers = {}
  if (body !== undefined) headers['Content-Type'] = 'application/json'
  const token = getToken()
  if (token) headers.Authorization = `Bearer ${token}`

  let res
  try {
    res = await fetch(`${BASE}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      signal,
    })
  } catch (err) {
    if (err.name === 'AbortError') throw err
    throw new ApiError('Cannot reach Slipstream — check your connection', { status: 0 })
  }

  if (res.status === 204) return null

  let data = null
  try { data = await res.json() } catch { /* empty or non-JSON body */ }

  if (!res.ok) {
    // A dead session should not leave a stale token behind to retry with.
    if (res.status === 401) setToken(null)
    throw new ApiError(data?.error || 'Something went wrong', {
      status: res.status,
      field: data?.field,
      errors: data?.errors,
    })
  }
  return data
}

export const api = {
  get: (p, opts) => request(p, { ...opts }),
  post: (p, body, opts) => request(p, { method: 'POST', body, ...opts }),
  patch: (p, body, opts) => request(p, { method: 'PATCH', body, ...opts }),
  del: (p, opts) => request(p, { method: 'DELETE', ...opts }),
}

/* Endpoint map — keeps URL strings out of components. */
export const Api = {
  sendOtp: (phone) => api.post('/auth/otp/send', { phone }),
  verifyOtp: (payload) => api.post('/auth/otp/verify', payload),
  register: (payload) => api.post('/auth/register', payload),
  login: (payload) => api.post('/auth/login', payload),
  me: () => api.get('/auth/me'),

  searchUsers: (q, opts) => api.get(`/users/search?q=${encodeURIComponent(q)}`, opts),
  inviteUser: (payload) => api.post('/users/invite', payload),
  updateMe: (payload) => api.patch('/users/me', payload),

  rides: () => api.get('/rides'),
  ride: (id) => api.get(`/rides/${id}`),
  publicRides: () => api.get('/rides/public'),
  createRide: (payload) => api.post('/rides', payload),
  planRoute: (payload) => api.post('/rides/plan', payload),
  joinRide: (joinCode) => api.post('/rides/join', { joinCode }),
  updateRide: (id, payload) => api.patch(`/rides/${id}`, payload),
  updateLocation: (id, payload) => api.post(`/rides/${id}/location`, payload),

  rideTrack: (rideId) => api.get(`/rides/${rideId}/track`),

  checklist: (rideId) => api.get(`/rides/${rideId}/checklist`),
  addChecklistItem: (rideId, payload) => api.post(`/rides/${rideId}/checklist/items`, payload),
  deleteChecklistItem: (rideId, itemId) => api.del(`/rides/${rideId}/checklist/items/${itemId}`),
  toggleChecklistItem: (rideId, itemId) => api.post(`/rides/${rideId}/checklist/items/${itemId}/check`),

  badges: () => api.get('/users/me/badges'),

  memories: (rideId) => api.get(`/rides/${rideId}/memories`),
  createMemory: (rideId, payload) => api.post(`/rides/${rideId}/memories`, payload),
  likeMemory: (rideId, memoryId) => api.post(`/rides/${rideId}/memories/${memoryId}/like`),
  deleteMemory: (rideId, memoryId) => api.del(`/rides/${rideId}/memories/${memoryId}`),
  // Not a request — @vercel/blob's upload() calls this URL itself for the
  // token handshake, so the component only needs the address, not a wrapper.
  memoryUploadUrl: (rideId) => `${BASE}/rides/${rideId}/memories/blob-upload`,

  groups: () => api.get('/groups'),
  group: (id) => api.get(`/groups/${id}`),
  createGroup: (payload) => api.post('/groups', payload),
  addGroupMember: (id, userId) => api.post(`/groups/${id}/members`, { userId }),
  removeGroupMember: (id, userId) => api.del(`/groups/${id}/members/${userId}`),
  addExpense: (id, payload) => api.post(`/groups/${id}/expenses`, payload),
  updateExpense: (id, expenseId, payload) => api.patch(`/groups/${id}/expenses/${expenseId}`, payload),
  deleteExpense: (id, expenseId) => api.del(`/groups/${id}/expenses/${expenseId}`),
  settle: (id, payload) => api.post(`/groups/${id}/settlements`, payload),
  closeGroup: (id) => api.post(`/groups/${id}/close`),

  threads: () => api.get('/chat/threads'),
  messages: (rideId, since = 0) => api.get(`/chat/rides/${rideId}/messages?since=${since}`),
  sendMessage: (rideId, body) => api.post(`/chat/rides/${rideId}/messages`, { body }),

  vehicles: () => api.get('/garage'),
  addVehicle: (payload) => api.post('/garage', payload),
  updateVehicle: (id, payload) => api.patch(`/garage/${id}`, payload),
  deleteVehicle: (id) => api.del(`/garage/${id}`),

  notifications: () => api.get('/notifications'),
  readNotifications: () => api.post('/notifications/read'),
}
