import { useEffect, useRef, useState } from 'react'
import { Api } from '../services/api'
import { useAuth, useToast } from '../context/AppContext'
import { Button, EmptyState, SkeletonList, Avatar } from '../components/ui'
import { Icon } from '../components/Icon'
import { clockTime, relativeTime, dayLabel } from '../utils/format'

export function ChatListScreen({ onOpenThread }) {
  const [threads, setThreads] = useState(null)
  const [query, setQuery] = useState('')

  useEffect(() => {
    Api.threads().then((r) => setThreads(r.threads)).catch(() => setThreads([]))
  }, [])

  const shown = threads?.filter((t) => t.name.toLowerCase().includes(query.trim().toLowerCase())) ?? []

  return (
    <div className="screen screen-enter">
      <header className="app-bar">
        <div className="app-bar-title">
          <div className="app-bar-title-1">Chat</div>
          <div className="app-bar-title-2">Ride groups</div>
        </div>
      </header>
      <div className="screen-scroll">
        <div className="pad">
          <div className="search-wrap">
            <Icon name="search" size={17} className="search-icon" />
            <input className="input" placeholder="Search chats" value={query}
                   aria-label="Search chats" onChange={(e) => setQuery(e.target.value)} />
          </div>
        </div>
        <div className="section">
          {threads === null ? <SkeletonList rows={3} />
            : shown.length === 0 ? (
              <EmptyState icon="💬" title={query ? 'No matches' : 'No chats yet'}
                          body={query ? 'Try a different search.' : 'Start a ride and its group chat opens automatically.'} />
            ) : (
              <div className="stack" style={{ gap: 6 }}>
                {shown.map((t) => (
                  <button key={t.id} className="list-row" onClick={() => onOpenThread(t.id, t.name)}>
                    <span className="list-row-icon"><Icon name="bike" size={18} /></span>
                    <span className="grow">
                      <span className="list-row-title">{t.name}</span>
                      <span className="list-row-sub">
                        {t.lastMessage
                          ? `${t.lastMessage.author}: ${t.lastMessage.body}`
                          : 'No messages yet'}
                      </span>
                    </span>
                    {t.lastMessage && <span className="caption">{relativeTime(t.lastMessage.at)}</span>}
                  </button>
                ))}
              </div>
            )}
        </div>
      </div>
    </div>
  )
}

export function ChatThreadScreen({ rideId, title, onBack }) {
  const { user } = useAuth()
  const toast = useToast()
  const [messages, setMessages] = useState(null)
  const [draft, setDraft] = useState('')
  const [sending, setSending] = useState(false)
  const bottom = useRef(null)
  const lastSeen = useRef(0)

  // Poll for new messages. `since` means each tick returns only what arrived
  // after the last one, so the list grows instead of being refetched whole.
  useEffect(() => {
    let cancelled = false
    let timer

    async function pull(initial) {
      try {
        const { messages: batch } = await Api.messages(rideId, initial ? 0 : lastSeen.current)
        if (cancelled) return
        if (batch.length) lastSeen.current = batch[batch.length - 1].createdAt
        setMessages((prev) => (initial || prev === null ? batch : [...prev, ...batch]))
      } catch {
        if (!cancelled && initial) setMessages([])
      } finally {
        if (!cancelled) timer = setTimeout(() => pull(false), 4000)
      }
    }

    pull(true)
    return () => { cancelled = true; clearTimeout(timer) }
  }, [rideId])

  useEffect(() => { bottom.current?.scrollIntoView({ block: 'end' }) }, [messages?.length])

  async function send() {
    const body = draft.trim()
    if (!body || sending) return
    setSending(true)
    try {
      const { message } = await Api.sendMessage(rideId, body)
      lastSeen.current = Math.max(lastSeen.current, message.createdAt)
      setMessages((prev) => [...(prev ?? []), message])
      setDraft('')
    } catch (e) { toast.error(e) } finally { setSending(false) }
  }

  let lastDay = null

  return (
    <div className="screen screen-enter">
      <header className="app-bar">
        <button className="icon-btn" onClick={onBack} aria-label="Back"><Icon name="arrowLeft" /></button>
        <div className="app-bar-title">
          <div className="app-bar-title-1">{title}</div>
          <div className="app-bar-title-2">Ride group</div>
        </div>
      </header>

      <div className="screen-scroll chat-thread">
        {messages === null ? (
          <div className="pad"><SkeletonList rows={3} /></div>
        ) : messages.length === 0 ? (
          <EmptyState icon="👋" title="Say hello" body="Nobody's posted yet — kick things off." />
        ) : (
          messages.map((m) => {
            const day = dayLabel(m.createdAt)
            const showDay = day !== lastDay
            lastDay = day
            return (
              <div key={m.id}>
                {showDay && <div className="chat-day">{day}</div>}
                <div className={`chat-msg ${m.isMine ? 'mine' : ''}`}>
                  {!m.isMine && <Avatar name={m.authorName} color={m.avatarColor} size="xs" />}
                  <div className="chat-bubble">
                    {!m.isMine && <div className="chat-author">{m.authorName}</div>}
                    <div className="chat-body">{m.body}</div>
                    <div className="chat-time">{clockTime(m.createdAt)}</div>
                  </div>
                </div>
              </div>
            )
          })
        )}
        <div ref={bottom} />
      </div>

      <div className="chat-composer">
        <input
          className="input" placeholder="Message the pack…" value={draft}
          aria-label="Message" maxLength={2000}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send() } }}
        />
        <Button variant="primary" onClick={send} loading={sending} disabled={!draft.trim()}
                aria-label="Send message">
          <Icon name="send" size={17} />
        </Button>
      </div>
    </div>
  )
}
