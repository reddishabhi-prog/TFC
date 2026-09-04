import { useEffect, useRef, useState } from 'react'
import { Api } from '../services/api'
import { useToast } from '../context/AppContext'
import { Button } from './ui'
import { Icon } from './Icon'
import { dayLabel } from '../utils/format'

// Instagram's portrait aspect. Drawn at full size off-screen and scaled down
// for the preview, so what gets shared is poster-resolution, not screen-sized.
const W = 1080
const H = 1350

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath()
  ctx.moveTo(x + r, y)
  ctx.arcTo(x + w, y, x + w, y + h, r)
  ctx.arcTo(x + w, y + h, x, y + h, r)
  ctx.arcTo(x, y + h, x, y, r)
  ctx.arcTo(x, y, x + w, y, r)
  ctx.closePath()
}

function wrapLines(ctx, text, maxWidth, maxLines) {
  const words = String(text).split(/\s+/)
  const lines = []
  let line = ''
  for (const word of words) {
    const next = line ? `${line} ${word}` : word
    if (ctx.measureText(next).width > maxWidth && line) {
      lines.push(line)
      line = word
      if (lines.length === maxLines - 1) break
    } else {
      line = next
    }
  }
  if (line && lines.length < maxLines) lines.push(line)
  return lines
}

/** Cross-origin images have to be requested with CORS or the canvas becomes
 *  tainted and toBlob() throws. Blob storage serves them permissively; if a
 *  load fails for any reason the card simply renders without the photo. */
function loadImage(src) {
  return new Promise((resolve) => {
    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.onload = () => resolve(img)
    img.onerror = () => resolve(null)
    img.src = src
  })
}

function drawRoute(ctx, points, box) {
  if (points.length < 2) return false
  const lats = points.map((p) => p.lat)
  const lngs = points.map((p) => p.lng)
  const minLat = Math.min(...lats), maxLat = Math.max(...lats)
  const minLng = Math.min(...lngs), maxLng = Math.max(...lngs)
  const spanLat = Math.max(maxLat - minLat, 1e-5)
  const spanLng = Math.max(maxLng - minLng, 1e-5)
  // Preserve shape: one scale for both axes, centred in the box.
  const scale = Math.min(box.w / spanLng, box.h / spanLat)
  const offsetX = box.x + (box.w - spanLng * scale) / 2
  const offsetY = box.y + (box.h - spanLat * scale) / 2
  const project = (p) => [
    offsetX + (p.lng - minLng) * scale,
    offsetY + (maxLat - p.lat) * scale, // north stays up
  ]

  ctx.save()
  ctx.lineJoin = 'round'
  ctx.lineCap = 'round'
  ctx.strokeStyle = 'rgba(0,0,0,0.35)'
  ctx.lineWidth = 14
  ctx.beginPath()
  points.forEach((p, i) => {
    const [x, y] = project(p)
    if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y)
  })
  ctx.stroke()
  ctx.strokeStyle = '#ffb84d'
  ctx.lineWidth = 7
  ctx.stroke()

  const [sx, sy] = project(points[0])
  const [ex, ey] = project(points[points.length - 1])
  ctx.fillStyle = '#ffb84d'
  ctx.beginPath(); ctx.arc(sx, sy, 13, 0, Math.PI * 2); ctx.fill()
  ctx.fillStyle = '#e8562b'
  ctx.beginPath(); ctx.arc(ex, ey, 16, 0, Math.PI * 2); ctx.fill()
  ctx.fillStyle = '#fff'
  ctx.beginPath(); ctx.arc(ex, ey, 7, 0, Math.PI * 2); ctx.fill()
  ctx.restore()
  return true
}

async function paintCard(canvas, { ride, points, photoUrl }) {
  const ctx = canvas.getContext('2d')
  canvas.width = W
  canvas.height = H

  const ground = ctx.createLinearGradient(0, 0, W, H)
  ground.addColorStop(0, '#5a1b31')
  ground.addColorStop(0.55, '#3a0e1f')
  ground.addColorStop(1, '#1a0812')
  ctx.fillStyle = ground
  ctx.fillRect(0, 0, W, H)

  const pad = 72
  let y = pad

  // Wordmark
  ctx.fillStyle = '#ffb84d'
  ctx.font = '800 34px Inter, system-ui, sans-serif'
  ctx.letterSpacing = '6px'
  ctx.fillText('SLIPSTREAM', pad, y + 34)
  ctx.letterSpacing = '0px'
  y += 92

  // Hero photo or route panel
  const panelH = 520
  const photo = photoUrl ? await loadImage(photoUrl) : null
  ctx.save()
  roundRect(ctx, pad, y, W - pad * 2, panelH, 36)
  ctx.clip()
  if (photo) {
    const scale = Math.max((W - pad * 2) / photo.width, panelH / photo.height)
    const dw = photo.width * scale
    const dh = photo.height * scale
    ctx.drawImage(photo, pad + ((W - pad * 2) - dw) / 2, y + (panelH - dh) / 2, dw, dh)
    const veil = ctx.createLinearGradient(0, y, 0, y + panelH)
    veil.addColorStop(0, 'rgba(26,8,18,0.15)')
    veil.addColorStop(1, 'rgba(26,8,18,0.75)')
    ctx.fillStyle = veil
    ctx.fillRect(pad, y, W - pad * 2, panelH)
  } else {
    ctx.fillStyle = 'rgba(0,0,0,0.28)'
    ctx.fillRect(pad, y, W - pad * 2, panelH)
  }
  ctx.restore()

  // The route rides on top of the photo when there is one, so the card always
  // shows where the ride actually went.
  const drewRoute = drawRoute(ctx, points, {
    x: pad + 56, y: y + 56, w: W - pad * 2 - 112, h: panelH - 112,
  })
  if (!drewRoute && !photo) {
    ctx.fillStyle = 'rgba(255,255,255,0.35)'
    ctx.font = '600 30px Inter, system-ui, sans-serif'
    ctx.textAlign = 'center'
    ctx.fillText('No route recorded', W / 2, y + panelH / 2 + 10)
    ctx.textAlign = 'left'
  }
  y += panelH + 64

  // Ride name
  ctx.fillStyle = '#fff'
  ctx.font = '800 76px Inter, system-ui, sans-serif'
  const nameLines = wrapLines(ctx, ride.name, W - pad * 2, 2)
  for (const line of nameLines) {
    ctx.fillText(line, pad, y + 60)
    y += 84
  }

  // Route text + date
  ctx.fillStyle = 'rgba(255,255,255,0.72)'
  ctx.font = '600 34px Inter, system-ui, sans-serif'
  const where = [ride.origin, ride.destination].filter(Boolean).join('  →  ')
  const when = dayLabel(ride.endedAt || ride.startsAt || ride.createdAt)
  ctx.fillText(where ? `${where}   ·   ${when}` : when, pad, y + 24)
  y += 92

  // Stats
  const hours = ride.endedAt && ride.startsAt
    ? Math.max(0, (ride.endedAt - ride.startsAt) / 3600000)
    : null
  const stats = [
    [ride.distanceKm ? `${Math.round(ride.distanceKm)}` : '—', 'KM'],
    [String(ride.members?.length ?? 0), ride.members?.length === 1 ? 'RIDER' : 'RIDERS'],
    [hours === null ? '—' : hours >= 1 ? `${hours.toFixed(1)}` : `${Math.round(hours * 60)}`,
      hours === null ? 'TIME' : hours >= 1 ? 'HOURS' : 'MINUTES'],
  ]
  const colW = (W - pad * 2) / stats.length
  stats.forEach(([value, unit], i) => {
    const cx = pad + colW * i
    ctx.fillStyle = '#ffb84d'
    ctx.font = '800 82px Inter, system-ui, sans-serif'
    ctx.fillText(value, cx, y + 70)
    ctx.fillStyle = 'rgba(255,255,255,0.55)'
    ctx.font = '700 26px Inter, system-ui, sans-serif'
    ctx.letterSpacing = '3px'
    ctx.fillText(unit, cx, y + 112)
    ctx.letterSpacing = '0px'
  })
}

export function RideShareCard({ ride, onClose }) {
  const toast = useToast()
  const canvasRef = useRef(null)
  const [ready, setReady] = useState(false)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    let cancelled = false
    async function build() {
      const [track, memories] = await Promise.all([
        Api.rideTrack(ride.id).catch(() => ({ points: [] })),
        Api.memories(ride.id).catch(() => ({ memories: [] })),
      ])
      if (cancelled || !canvasRef.current) return
      const photo = memories.memories?.find((m) => m.mediaType === 'photo')
      await paintCard(canvasRef.current, {
        ride,
        points: track.points ?? [],
        photoUrl: photo?.mediaUrl,
      })
      if (!cancelled) setReady(true)
    }
    build().catch(() => { if (!cancelled) setReady(true) })
    return () => { cancelled = true }
  }, [ride])

  function toBlob() {
    return new Promise((resolve, reject) => {
      canvasRef.current?.toBlob(
        (blob) => (blob ? resolve(blob) : reject(new Error('Could not render the card'))),
        'image/png',
      )
    })
  }

  async function share() {
    setBusy(true)
    try {
      const blob = await toBlob()
      const file = new File([blob], `${ride.name.replace(/\s+/g, '-').toLowerCase()}.png`, { type: 'image/png' })
      if (navigator.canShare?.({ files: [file] })) {
        await navigator.share({ files: [file], title: ride.name })
      } else {
        download(blob)
        toast.success('Card saved — share it from your gallery')
      }
    } catch (e) {
      if (e?.name !== 'AbortError') toast.error('Could not share that card')
    } finally { setBusy(false) }
  }

  function download(blob) {
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${ride.name.replace(/\s+/g, '-').toLowerCase()}-slipstream.png`
    a.click()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
  }

  async function save() {
    setBusy(true)
    try {
      download(await toBlob())
      toast.success('Saved to your downloads')
    } catch { toast.error('Could not save that card') } finally { setBusy(false) }
  }

  return (
    <div className="sheet-scrim" onClick={() => !busy && onClose()}>
      <div className="sheet" role="dialog" aria-modal="true" aria-label="Ride card"
           onClick={(e) => e.stopPropagation()}>
        <div className="sheet-title-row">
          <div className="sheet-title">Your ride card</div>
          <button className="picker-preview-clear" onClick={onClose} aria-label="Close">
            <Icon name="close" size={14} />
          </button>
        </div>

        <div className="share-card-preview">
          <canvas ref={canvasRef} className="share-card-canvas" aria-label={`Ride card for ${ride.name}`} />
          {!ready && <div className="share-card-loading">Building your card…</div>}
        </div>

        <div className="row" style={{ gap: 8 }}>
          <Button block icon="copy" loading={busy} disabled={!ready} onClick={save}>Save image</Button>
          <Button variant="primary" block icon="send" loading={busy} disabled={!ready} onClick={share}>
            Share
          </Button>
        </div>
      </div>
    </div>
  )
}
