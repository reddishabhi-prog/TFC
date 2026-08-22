import { useEffect } from 'react'
import { LogoMark } from '../components/Icon'

export function SplashScreen({ onDone, minDuration = 1400 }) {
  useEffect(() => {
    const t = setTimeout(onDone, minDuration)
    return () => clearTimeout(t)
  }, [onDone, minDuration])

  return (
    <div className="splash">
      <LogoMark size={92} className="splash-logo" />
      <div className="splash-word">SLIPSTREAM</div>
      <div className="splash-tag">Ride together. Split fair. Chase the horizon.</div>
    </div>
  )
}
