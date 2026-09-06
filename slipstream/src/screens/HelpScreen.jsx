import { useState } from 'react'
import { Icon } from '../components/Icon'

// Support address lives here, not scattered across mailto: links — swap this
// one constant if the real inbox changes.
const SUPPORT_EMAIL = 'support@slipstream.app'

// Grounded in what the app actually does, grouped the way a rider thinks
// about it rather than by screen name, so an answer is easy to scan for
// even without knowing which tab something lives on.
const FAQ_SECTIONS = [
  {
    title: 'Rides',
    items: [
      {
        q: 'How do I start a ride?',
        a: 'From Home, tap "Start a ride". Add a name, when it starts, and — optionally — a route. Once it\'s live you get a 6-character join code to share with the group.',
      },
      {
        q: 'How does someone else join?',
        a: 'They enter your join code on their Home screen, or you invite them by phone number when creating the ride — if they\'re not on Slipstream yet, they get a WhatsApp message with an invite.',
      },
      {
        q: 'Can I plan a multi-day trip?',
        a: 'Yes — set a trip end date when creating the ride to unlock a day-by-day plan. Pick a route to get a distance/duration check and a weather snapshot for each day, then export the whole plan as a PDF from the Plan tab.',
      },
      {
        q: 'How does live location sharing work?',
        a: 'While a ride is live, your position updates on the shared map for everyone on that ride only. It stops the moment the ride is paused or ended — nothing is tracked outside an active ride.',
      },
    ],
  },
  {
    title: 'Safety',
    items: [
      {
        q: 'What does the SOS button do?',
        a: 'It immediately alerts every rider on your current ride, in-app and by push notification, with your last known location. Add an emergency contact in your profile so it\'s on hand if you ever need it.',
      },
      {
        q: 'What\'s a pit stop?',
        a: 'Any rider can drop a pin on the live map for fuel, food, rest, or anything else worth flagging — it shows up for the whole group with an optional note.',
      },
    ],
  },
  {
    title: 'Notifications',
    items: [
      {
        q: 'Why am I not getting push notifications?',
        a: 'Enable them from the card at the top of the Notifications screen. Your browser will ask for permission once — if you dismissed that prompt, you\'ll need to allow notifications for this site in your browser or phone settings first.',
      },
    ],
  },
  {
    title: 'Split & memories',
    items: [
      {
        q: 'How does splitting expenses work?',
        a: 'From the Split tab, add an expense to a ride or a standalone group and it\'s divided evenly across everyone in it. Balances update instantly so it\'s clear who owes what.',
      },
      {
        q: 'Who can see the photos I post to Memories?',
        a: 'Only riders on that specific ride. The ride leader sets how many photos or clips each rider can add, shown as a running count at the top of the tab.',
      },
    ],
  },
  {
    title: 'Your account',
    items: [
      {
        q: 'Is my email or phone number visible to other riders?',
        a: 'Your phone number is only ever matched exactly when someone searches to invite you — it\'s never shown in full. Your email is never shown to anyone else at all.',
      },
      {
        q: 'How do I change my profile photo?',
        a: 'Tap the camera icon on your avatar at the top of the Profile tab and pick a photo — it\'s automatically cropped to a square, no manual cropping needed.',
      },
    ],
  },
]

function FaqItem({ q, a }) {
  const [open, setOpen] = useState(false)
  return (
    <div className="faq-item">
      <button className="faq-q" onClick={() => setOpen((v) => !v)} aria-expanded={open}>
        <span>{q}</span>
        <Icon name="chevronDown" size={16} className={`faq-chevron ${open ? 'open' : ''}`} />
      </button>
      {open && <p className="faq-a">{a}</p>}
    </div>
  )
}

export function HelpScreen({ onBack }) {
  return (
    <div className="screen screen-enter">
      <header className="app-bar">
        <button className="icon-btn" onClick={onBack} aria-label="Back"><Icon name="arrowLeft" /></button>
        <div className="app-bar-title">
          <div className="app-bar-title-1">Help &amp; support</div>
          <div className="app-bar-title-2">FAQs and contact</div>
        </div>
      </header>

      <div className="screen-scroll">
        <div className="pad">
          <a className="card contact-card" href={`mailto:${SUPPORT_EMAIL}`}>
            <span className="contact-card-icon"><Icon name="chat" size={20} /></span>
            <span className="grow">
              <span className="list-row-title">Email us</span>
              <span className="list-row-sub">{SUPPORT_EMAIL}</span>
            </span>
            <Icon name="chevronRight" size={17} />
          </a>
        </div>

        {FAQ_SECTIONS.map((section) => (
          <div className="section" key={section.title}>
            <div className="section-title">{section.title}</div>
            <div className="card faq-card">
              {section.items.map((item) => <FaqItem key={item.q} {...item} />)}
            </div>
          </div>
        ))}

        <div className="pad" style={{ paddingBottom: 'var(--sp-7)' }}>
          <p className="caption" style={{ textAlign: 'center' }}>Slipstream</p>
        </div>
      </div>
    </div>
  )
}
