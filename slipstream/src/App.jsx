import { lazy, Suspense, useState } from 'react'
import { AuthProvider, ThemeProvider, ToastProvider, useAuth } from './context/AppContext'
import { SplashScreen } from './screens/SplashScreen'
import { AuthScreen } from './screens/AuthScreen'
import { HomeScreen } from './screens/HomeScreen'
import { Icon } from './components/Icon'

// Home (and Auth/Splash above) are what almost every session loads first, so
// they stay in the main bundle. Everything reached by navigating away —
// including the two screens that pull in Leaflet — loads on demand instead
// of costing every visitor a heavier first paint for screens they may never
// open this session.
const CreateRideScreen = lazy(() => import('./screens/CreateRideScreen').then((m) => ({ default: m.CreateRideScreen })))
const RideScreen = lazy(() => import('./screens/RideScreen').then((m) => ({ default: m.RideScreen })))
const SplitScreen = lazy(() => import('./screens/SplitScreen').then((m) => ({ default: m.SplitScreen })))
const ChatListScreen = lazy(() => import('./screens/ChatScreen').then((m) => ({ default: m.ChatListScreen })))
const ChatThreadScreen = lazy(() => import('./screens/ChatScreen').then((m) => ({ default: m.ChatThreadScreen })))
const GarageScreen = lazy(() => import('./screens/GarageScreen').then((m) => ({ default: m.GarageScreen })))
const ProfileScreen = lazy(() => import('./screens/ProfileScreen').then((m) => ({ default: m.ProfileScreen })))
const NotificationsScreen = lazy(() => import('./screens/NotificationsScreen').then((m) => ({ default: m.NotificationsScreen })))

function ScreenFallback() {
  return (
    <div className="screen" style={{ display: 'grid', placeItems: 'center' }}>
      <div className="skeleton" style={{ width: 160, height: 12 }} />
    </div>
  )
}

const TABS = [
  { id: 'home',    label: 'Home',  icon: 'home' },
  { id: 'rides',   label: 'Ride',  icon: 'bike' },
  { id: 'split',   label: 'Split', icon: 'split' },
  { id: 'chat',    label: 'Chat',  icon: 'chat' },
  { id: 'profile', label: 'Me',    icon: 'user' },
]
const TAB_IDS = new Set(TABS.map((t) => t.id))

function Shell() {
  const { user, loading } = useAuth()
  const [splashDone, setSplashDone] = useState(false)
  // `route` is the current screen; `params` carries whatever it needs. Keeping
  // both in one object means a navigation can never land on a screen without
  // the data it expects.
  const [nav, setNav] = useState({ route: 'home', params: {} })

  const go = (route, params = {}) => setNav({ route, params })

  if (!splashDone) return <SplashScreen onDone={() => setSplashDone(true)} />

  if (loading) {
    return (
      <div className="screen" style={{ display: 'grid', placeItems: 'center' }}>
        <div className="skeleton" style={{ width: 160, height: 12 }} />
      </div>
    )
  }

  // Nothing past this point renders without a real signed-in user.
  if (!user) return <AuthScreen />

  const { route, params } = nav
  let screen

  switch (route) {
    case 'create-ride':
      screen = <CreateRideScreen onCancel={() => go('home')} onCreated={(r) => go('ride', { rideId: r.id })} />
      break
    case 'ride':
      screen = (
        <RideScreen
          rideId={params.rideId}
          onBack={() => go('home')}
          onOpenChat={(id) => go('chat-thread', { rideId: id, title: 'Ride chat' })}
          onOpenSplit={() => go('split')}
        />
      )
      break
    case 'rides':
      screen = <HomeScreen onNavigate={go} onOpenRide={(id) => go('ride', { rideId: id })} />
      break
    case 'split':
      screen = <SplitScreen onNavigate={go} />
      break
    case 'chat':
      screen = <ChatListScreen onOpenThread={(rideId, title) => go('chat-thread', { rideId, title })} />
      break
    case 'chat-thread':
      screen = <ChatThreadScreen rideId={params.rideId} title={params.title} onBack={() => go('chat')} />
      break
    case 'garage':
      screen = <GarageScreen onBack={() => go('profile')} />
      break
    case 'profile':
      screen = <ProfileScreen onNavigate={go} />
      break
    case 'notifications':
      screen = <NotificationsScreen onBack={() => go('home')} onOpenRide={(id) => go('ride', { rideId: id })} />
      break
    case 'home':
    default:
      screen = <HomeScreen onNavigate={go} onOpenRide={(id) => go('ride', { rideId: id })} />
  }

  // Full-bleed screens own the whole frame; the tab bar would fight them.
  const hideTabs = route === 'create-ride' || route === 'chat-thread'
  const activeTab = TAB_IDS.has(route) ? route : null

  return (
    <>
      {/* Keying on route restarts the enter animation on every navigation. */}
      <Suspense fallback={<ScreenFallback />}>
        <div key={route} className="screen">{screen}</div>
      </Suspense>
      {!hideTabs && (
        <nav className="tab-bar" aria-label="Main navigation">
          {TABS.map((t) => (
            <button
              key={t.id}
              className={`tab-btn ${activeTab === t.id ? 'on' : ''}`}
              aria-current={activeTab === t.id ? 'page' : undefined}
              onClick={() => go(t.id === 'rides' ? 'home' : t.id)}
            >
              <Icon name={t.icon} size={21} />
              {t.label}
            </button>
          ))}
        </nav>
      )}
    </>
  )
}

export default function App() {
  return (
    <ThemeProvider>
      <AuthProvider>
        <ToastProvider>
          <div className="app-frame">
            <Shell />
          </div>
        </ToastProvider>
      </AuthProvider>
    </ThemeProvider>
  )
}
