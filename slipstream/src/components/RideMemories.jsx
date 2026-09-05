import { useEffect, useRef, useState } from 'react'
import { upload } from '@vercel/blob/client'
import { Api, getToken } from '../services/api'
import { useAuth, useToast } from '../context/AppContext'
import { Button, Avatar } from './ui'
import { Icon } from './Icon'
import { relativeTime } from '../utils/format'

const MAX_CAPTION = 500

/** The ride's photo/video feed — riders only, capped per rider by the
 *  leader-set memory limit. Mirrors RideMap's shape: owns its own data and
 *  polling, RideScreen just decides which of the two panels is visible. */
export function RideMemories({ ride, onRideUpdated }) {
  const { user } = useAuth()
  const toast = useToast()
  const [memories, setMemories] = useState(null)
  const [usedByMe, setUsedByMe] = useState(0)
  const [compose, setCompose] = useState(false)
  const [limitSheet, setLimitSheet] = useState(false)

  function load() {
    return Api.memories(ride.id)
      .then(({ memories: m, usedByMe: u }) => { setMemories(m); setUsedByMe(u) })
      .catch((e) => toast.error(e))
  }

  useEffect(() => { load() }, [ride.id]) // eslint-disable-line react-hooks/exhaustive-deps

  async function toggleLike(memory) {
    setMemories((prev) => prev.map((m) => (m.id === memory.id
      ? { ...m, likedByMe: !m.likedByMe, likeCount: m.likeCount + (m.likedByMe ? -1 : 1) }
      : m)))
    try {
      await Api.likeMemory(ride.id, memory.id)
    } catch (e) {
      toast.error(e)
      load() // reconcile with the server after a failed optimistic update
    }
  }

  async function removeMemory(memory) {
    setMemories((prev) => prev.filter((m) => m.id !== memory.id))
    if (memory.userId === user.id) setUsedByMe((n) => Math.max(0, n - 1))
    try {
      await Api.deleteMemory(ride.id, memory.id)
    } catch (e) {
      toast.error(e)
      load()
    }
  }

  const remaining = ride.memoryLimit - usedByMe
  const hasMemories = memories && memories.length > 0

  return (
    <div className="ride-memories">
      <div className="memories-toolbar">
        <span className="usage-pill">{usedByMe} / {ride.memoryLimit} shared</span>
        {ride.isLeader && (
          <button className="memories-limit-btn" onClick={() => setLimitSheet(true)}>
            <Icon name="settings" size={14} /> Limit
          </button>
        )}
      </div>

      {memories === null ? (
        <div className="pad"><div className="skeleton" style={{ height: 160, borderRadius: 18 }} /></div>
      ) : !hasMemories ? (
        <div className="memories-empty">
          <div className="memories-empty-icon"><Icon name="camera" size={26} /></div>
          <div className="memories-empty-title">Add your best memories</div>
          <div className="memories-empty-body">Photos and short clips from the road — everyone on this ride will see them.</div>
          <Button variant="primary" icon="plus" onClick={() => setCompose(true)}>
            Add your best memories
          </Button>
          <div className="memories-empty-cap">Up to {ride.memoryLimit} photos or clips each</div>
        </div>
      ) : (
        <div className="feed">
          {memories.map((m) => (
            <MemoryPost
              key={m.id}
              memory={m}
              youId={user.id}
              canDelete={m.userId === user.id || ride.isLeader}
              onLike={() => toggleLike(m)}
              onDelete={() => removeMemory(m)}
            />
          ))}
        </div>
      )}

      {hasMemories && remaining > 0 && (
        <button className="fab" onClick={() => setCompose(true)} aria-label="Add your best memories">
          <Icon name="plus" size={22} />
        </button>
      )}

      {compose && (
        <ComposeSheet
          ride={ride}
          remaining={remaining}
          onClose={() => setCompose(false)}
          onPosted={(memory) => {
            setMemories((prev) => [memory, ...(prev ?? [])])
            setUsedByMe((n) => n + 1)
            setCompose(false)
          }}
        />
      )}
      {limitSheet && (
        <LimitSheet
          ride={ride}
          onClose={() => setLimitSheet(false)}
          onSaved={(updated) => { onRideUpdated(updated); setLimitSheet(false) }}
        />
      )}
    </div>
  )
}

function MemoryPost({ memory, youId, canDelete, onLike, onDelete }) {
  return (
    <div className="post">
      <div className="post-head">
        <Avatar name={memory.authorName} color={memory.authorColor} size="sm" />
        <span className="post-who">
          <span className="post-name">{memory.authorName}{memory.userId === youId ? ' (you)' : ''}</span>
          <span className="post-time">{relativeTime(memory.createdAt)}</span>
        </span>
        {canDelete && (
          <button className="post-more" onClick={onDelete} aria-label="Remove this memory">
            <Icon name="trash" size={15} />
          </button>
        )}
      </div>
      <div className="post-media">
        {memory.mediaType === 'video'
          ? <video className="post-media-el" src={memory.mediaUrl} controls playsInline preload="metadata" />
          : <img className="post-media-el" src={memory.mediaUrl} alt="" loading="lazy" />}
      </div>
      {memory.caption && <div className="post-body">{memory.caption}</div>}
      <div className="post-actions">
        <button className={`stat ${memory.likedByMe ? 'liked' : ''}`} onClick={onLike}>
          <Icon name="heart" size={17} fill={memory.likedByMe ? 'currentColor' : 'none'} />
          {memory.likeCount}
        </button>
      </div>
    </div>
  )
}

function useSheetA11y(onClose, busy) {
  const panel = useRef(null)
  useEffect(() => {
    panel.current?.focus()
    const onKey = (e) => { if (e.key === 'Escape' && !busy) onClose() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose, busy])
  return panel
}

function ComposeSheet({ ride, remaining, onClose, onPosted }) {
  const toast = useToast()
  const fileRef = useRef(null)
  const [file, setFile] = useState(null)
  const [preview, setPreview] = useState(null)
  const [mediaType, setMediaType] = useState('photo')
  const [caption, setCaption] = useState('')
  const [busy, setBusy] = useState(false)
  const panel = useSheetA11y(onClose, busy)

  useEffect(() => {
    if (!file) { setPreview(null); return }
    const url = URL.createObjectURL(file)
    setPreview(url)
    return () => URL.revokeObjectURL(url)
  }, [file])

  function pick(e) {
    const f = e.target.files?.[0]
    if (!f) return
    setFile(f)
    setMediaType(f.type.startsWith('video/') ? 'video' : 'photo')
  }

  async function post() {
    if (!file || busy) return
    setBusy(true)
    try {
      const blob = await upload(`memories/${ride.id}/${Date.now()}-${file.name}`, file, {
        access: 'public',
        handleUploadUrl: Api.memoryUploadUrl(ride.id),
        headers: { Authorization: `Bearer ${getToken()}` },
      })
      const { memory } = await Api.createMemory(ride.id, {
        mediaUrl: blob.url,
        mediaType,
        caption: caption.trim() || undefined,
      })
      toast.success('Shared to the ride')
      onPosted(memory)
    } catch (e) {
      // @vercel/blob throws away our endpoint's response body and reports
      // every start-of-upload failure as "Failed to retrieve the client
      // token", which tells a rider nothing. The server logs the real cause.
      const raw = e?.message || ''
      toast.error(/retrieve the client token/i.test(raw)
        ? "Couldn't start the upload — photo storage may not be set up yet."
        : raw || 'Could not share that — try again')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="sheet-scrim" onClick={() => !busy && onClose()}>
      <div className="sheet" role="dialog" aria-modal="true" aria-label="Add your best memories"
           tabIndex={-1} ref={panel} onClick={(e) => e.stopPropagation()}>
        <div className="sheet-title-row">
          <div className="sheet-title">Add your best memories</div>
          <span className="usage-pill">{remaining} left</span>
        </div>

        <input ref={fileRef} type="file" accept="image/*,video/*" hidden onChange={pick} />
        {preview ? (
          <div className="picker-preview">
            {mediaType === 'video'
              ? <video src={preview} className="picker-preview-media" muted />
              : <img src={preview} className="picker-preview-media" alt="" />}
            <button className="picker-preview-clear" onClick={() => setFile(null)} aria-label="Choose a different file">
              <Icon name="close" size={14} />
            </button>
          </div>
        ) : (
          <button className="picker-tile-add" onClick={() => fileRef.current?.click()}>
            <Icon name="camera" size={22} />
            <span>Add a photo or clip</span>
          </button>
        )}

        <textarea
          className="caption-input"
          placeholder="Say something about this moment…"
          maxLength={MAX_CAPTION}
          value={caption}
          onChange={(e) => setCaption(e.target.value)}
        />

        <div className="visibility-note">
          <Icon name="shield" size={13} /> Visible to <b>{ride.name}</b> riders only
        </div>

        <Button variant="primary" size="lg" block icon="send" loading={busy} disabled={!file} onClick={post}>
          Post to ride
        </Button>
      </div>
    </div>
  )
}

function LimitSheet({ ride, onClose, onSaved }) {
  const toast = useToast()
  const [value, setValue] = useState(ride.memoryLimit)
  const [busy, setBusy] = useState(false)
  const panel = useSheetA11y(onClose, busy)

  const clamp = (n) => Math.min(50, Math.max(1, n))

  async function save() {
    setBusy(true)
    try {
      const { ride: updated } = await Api.updateRide(ride.id, { memoryLimit: value })
      toast.success('Limit updated')
      onSaved(updated)
    } catch (e) {
      toast.error(e)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="sheet-scrim" onClick={() => !busy && onClose()}>
      <div className="sheet" role="dialog" aria-modal="true" aria-label="Photo & video limit"
           tabIndex={-1} ref={panel} onClick={(e) => e.stopPropagation()}>
        <div className="limit-card">
          <div className="limit-icon"><Icon name="camera" size={19} /></div>
          <div className="limit-title">Photo &amp; video limit</div>
          <div className="limit-sub">How many memories can each rider add to this ride?</div>

          <div className="stepper">
            <button className="stepper-btn" aria-label="Decrease" disabled={value <= 1}
                    onClick={() => setValue((v) => clamp(v - 1))}>
              −
            </button>
            <div className="stepper-value">{value}</div>
            <button className="stepper-btn" aria-label="Increase" disabled={value >= 50}
                    onClick={() => setValue((v) => clamp(v + 1))}>
              +
            </button>
          </div>
          <div className="stepper-unit">per rider, this ride</div>

          <div className="limit-note">
            <Icon name="help" size={13} />
            Keeps the feed full of everyone's best shot, not their whole gallery. Applies only to this ride.
          </div>
        </div>
        <Button variant="primary" size="lg" block icon="check" loading={busy} onClick={save} style={{ marginTop: 16 }}>
          Save limit
        </Button>
      </div>
    </div>
  )
}
