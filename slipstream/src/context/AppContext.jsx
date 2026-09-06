import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import { Api, setToken, getToken, ApiError } from '../services/api'

/* -------------------------------------------------------------------- Auth */

const AuthCtx = createContext(null)
export const useAuth = () => useContext(AuthCtx)

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null)
  // `loading` covers only the initial session restore — screens wait on it
  // before deciding whether to show the login flow.
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    async function restore() {
      if (!getToken()) { setLoading(false); return }
      try {
        const { user } = await Api.me()
        if (!cancelled) setUser(user)
      } catch {
        setToken(null)
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    restore()
    return () => { cancelled = true }
  }, [])

  const adopt = useCallback(({ token, user }) => {
    setToken(token)
    setUser(user)
    return user
  }, [])

  const logout = useCallback(() => {
    setToken(null)
    setUser(null)
  }, [])

  const value = useMemo(() => ({
    user, loading, adopt, logout,
    setUser,
    isSignedIn: !!user,
  }), [user, loading, adopt, logout])

  return <AuthCtx.Provider value={value}>{children}</AuthCtx.Provider>
}

/* ------------------------------------------------------------------- Theme */

const ThemeCtx = createContext(null)
export const useTheme = () => useContext(ThemeCtx)
const THEME_KEY = 'slipstream_theme'

export function ThemeProvider({ children }) {
  // Light and dark only — there is deliberately no "system" option, so what a
  // rider picks is what they get on every device.
  const [theme, setTheme] = useState(() => {
    const saved = localStorage.getItem(THEME_KEY)
    return saved === 'dark' || saved === 'light' ? saved : 'light'
  })

  useEffect(() => {
    document.documentElement.dataset.theme = theme
    localStorage.setItem(THEME_KEY, theme)
    const meta = document.querySelector('meta[name="theme-color"]')
    if (meta) meta.setAttribute('content', theme === 'dark' ? '#100d0c' : '#3a0e1f')
  }, [theme])

  const value = useMemo(() => ({ theme, setTheme, toggle: () => setTheme((t) => (t === 'dark' ? 'light' : 'dark')) }), [theme])
  return <ThemeCtx.Provider value={value}>{children}</ThemeCtx.Provider>
}

/* ------------------------------------------------------------------- Toast */

const ToastCtx = createContext(null)
export const useToast = () => useContext(ToastCtx)

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([])
  const timers = useRef(new Map())

  const dismiss = useCallback((id) => {
    setToasts((list) => list.filter((t) => t.id !== id))
    const timer = timers.current.get(id)
    if (timer) { clearTimeout(timer); timers.current.delete(id) }
  }, [])

  const push = useCallback((message, tone = 'default', ms = 3200) => {
    const id = Math.random().toString(36).slice(2)
    setToasts((list) => [...list.slice(-2), { id, message, tone }])
    timers.current.set(id, setTimeout(() => dismiss(id), ms))
    return id
  }, [dismiss])

  // Clearing on unmount stops a pending timer from setting state afterwards.
  useEffect(() => () => { timers.current.forEach(clearTimeout); timers.current.clear() }, [])

  const value = useMemo(() => ({
    push,
    success: (m) => push(m, 'success'),
    error: (m) => push(m instanceof ApiError || m instanceof Error ? m.message : m, 'error'),
  }), [push])

  return (
    <ToastCtx.Provider value={value}>
      {children}
      <div className="toast-host" aria-live="polite" aria-atomic="false">
        {toasts.map((t) => (
          <div key={t.id} className={`toast ${t.tone === 'default' ? '' : t.tone}`}>{t.message}</div>
        ))}
      </div>
    </ToastCtx.Provider>
  )
}
