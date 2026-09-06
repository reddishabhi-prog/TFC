// Inline stroke icons on a 24px grid. Bundling only what the app uses keeps
// the payload small and avoids an icon-font network dependency.

const PATHS = {
  home: 'M3 10.5 12 3l9 7.5M5.5 9.5V20h13V9.5',
  bike: 'M5.5 18.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7ZM18.5 18.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7ZM8 15h6l-2.5-6M11 9h4M14 5h2.5l1.5 4',
  split: 'M4 6h16M4 12h10M4 18h7M17 15l3 3-3 3',
  chat: 'M20 12a8 8 0 0 1-11.6 7.1L4 20l.9-4.4A8 8 0 1 1 20 12Z',
  user: 'M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8ZM4.5 20a7.5 7.5 0 0 1 15 0',
  plus: 'M12 5v14M5 12h14',
  arrowLeft: 'M19 12H5M11 18l-6-6 6-6',
  arrowRight: 'M5 12h14M13 6l6 6-6 6',
  chevronRight: 'M9 6l6 6-6 6',
  chevronDown: 'M6 9l6 6 6-6',
  close: 'M6 6l12 12M18 6L6 18',
  check: 'M4.5 12.5 9 17 19.5 6.5',
  bell: 'M18 16V11a6 6 0 1 0-12 0v5l-1.5 2.5h15L18 16ZM10 19.5a2 2 0 0 0 4 0',
  alert: 'M12 8v5M12 16.5v.5M10.3 3.9 2.6 17.4A1.8 1.8 0 0 0 4.2 20h15.6a1.8 1.8 0 0 0 1.6-2.6L13.7 3.9a1.9 1.9 0 0 0-3.4 0Z',
  map: 'M9 4 3 6.5v13L9 17l6 2.5 6-2.5v-13L15 6.5 9 4ZM9 4v13M15 6.5v13',
  pin: 'M12 21s7-5.3 7-11a7 7 0 1 0-14 0c0 5.7 7 11 7 11ZM12 12.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5Z',
  calendar: 'M7 3v3M17 3v3M3.5 9.5h17M5 6h14a1.5 1.5 0 0 1 1.5 1.5V19A1.5 1.5 0 0 1 19 20.5H5A1.5 1.5 0 0 1 3.5 19V7.5A1.5 1.5 0 0 1 5 6Z',
  clock: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18ZM12 7.5V12l3 2',
  copy: 'M9 9h9.5v9.5H9zM15 9V5.5H5.5V15H9',
  send: 'M4.5 12 20 4.5 13 20l-2.5-6L4.5 12Z',
  search: 'M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14ZM16.2 16.2 21 21',
  trash: 'M4.5 7h15M9.5 7V5h5v2M6.5 7l1 13h9l1-13M10.5 11v5M13.5 11v5',
  edit: 'M4 20h4L19 9a2.1 2.1 0 0 0-3-3L5 17v3ZM14.5 6.5l3 3',
  pause: 'M9.5 5.5v13M14.5 5.5v13',
  play: 'M7.5 5 19 12 7.5 19V5Z',
  stop: 'M6.5 6.5h11v11h-11z',
  sun: 'M12 16.5a4.5 4.5 0 1 0 0-9 4.5 4.5 0 0 0 0 9ZM12 2v2.5M12 19.5V22M2 12h2.5M19.5 12H22M4.9 4.9l1.8 1.8M17.3 17.3l1.8 1.8M19.1 4.9l-1.8 1.8M6.7 17.3l-1.8 1.8',
  moon: 'M20 14.5A8.5 8.5 0 0 1 9.5 4a8.5 8.5 0 1 0 10.5 10.5Z',
  logout: 'M15 8V5.5H5v13h10V16M10 12h10M17 9l3 3-3 3',
  shield: 'M12 21s7-3.5 7-9V6l-7-3-7 3v6c0 5.5 7 9 7 9Z',
  wallet: 'M3.5 8.5h17V19a1.5 1.5 0 0 1-1.5 1.5H5A1.5 1.5 0 0 1 3.5 19V8.5ZM3.5 8.5 5.5 4h13l2 4.5M16 14.5h1.5',
  fuel: 'M5 20V5.5A1.5 1.5 0 0 1 6.5 4h5A1.5 1.5 0 0 1 13 5.5V20M3.5 20h11M13 10h3a2 2 0 0 1 2 2v4a1.5 1.5 0 0 0 3 0V9l-2.5-2.5M6 9h6',
  food: 'M6 3v8a2.5 2.5 0 0 0 5 0V3M8.5 11v10M17 3c-1.5 1.5-2 3.5-2 5.5s.5 3 2 3.5V21',
  toll: 'M4 20V9l8-5 8 5v11M9 20v-6h6v6M4 20h16',
  stay: 'M4 20V8l8-4 8 4v12M9.5 20v-5h5v5',
  more: 'M12 6.5v.01M12 12v.01M12 17.5v.01',
  users: 'M9 11a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7ZM2.5 20a6.5 6.5 0 0 1 13 0M16 4.5a3.5 3.5 0 0 1 0 7M17.5 14.5a6.5 6.5 0 0 1 4 5.5',
  link: 'M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7L11.5 6.8M14 10a4 4 0 0 0-5.7 0l-3 3A4 4 0 0 0 11 18.7l1.5-1.5',
  sos: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18ZM12 7.5V13M12 16v.5',
  settings: 'M12 15.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7ZM19.5 12a7.5 7.5 0 0 0-.1-1.2l2-1.5-2-3.5-2.4 1a7.5 7.5 0 0 0-2-1.2L14.5 3h-5l-.4 2.6a7.5 7.5 0 0 0-2 1.2l-2.4-1-2 3.5 2 1.5a7.6 7.6 0 0 0 0 2.4l-2 1.5 2 3.5 2.4-1a7.5 7.5 0 0 0 2 1.2l.4 2.6h5l.4-2.6a7.5 7.5 0 0 0 2-1.2l2.4 1 2-3.5-2-1.5c.1-.4.1-.8.1-1.2Z',
  help: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18ZM9.5 9.5a2.5 2.5 0 1 1 3.4 2.3c-.6.3-.9.8-.9 1.4v.3M12 16.5v.5',
  trophy: 'M7 4h10v5a5 5 0 0 1-10 0V4ZM7 6H4.5v1.5A3 3 0 0 0 7 10.4M17 6h2.5v1.5A3 3 0 0 1 17 10.4M9.5 20h5M12 14v6',
  checklist: 'M4 6.5 5.5 8 8 5M4 12.5 5.5 14 8 11M4 18.5 5.5 20 8 17M11 6.5h9M11 12.5h9M11 18.5h9',
  camera: 'M4 8.5 8 5h8l4 3.5M4 8.5V18a1.5 1.5 0 0 0 1.5 1.5h13A1.5 1.5 0 0 0 20 18V8.5M4 8.5h16M12 16.4a3.4 3.4 0 1 0 0-6.8 3.4 3.4 0 0 0 0 6.8Z',
  heart: 'M12 21s-7-4.5-9.5-9A5.5 5.5 0 0 1 12 6a5.5 5.5 0 0 1 9.5 6c-2.5 4.5-9.5 9-9.5 9Z',
  locate: 'M12 2v4M12 18v4M2 12h4M18 12h4M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8Z',
  download: 'M12 3v12M7 10l5 5 5-5M4.5 19.5h15',
}

export function Icon({ name, size = 20, strokeWidth = 1.9, ...rest }) {
  const d = PATHS[name]
  if (!d) return null
  return (
    <svg
      width={size} height={size} viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth={strokeWidth}
      strokeLinecap="round" strokeLinejoin="round"
      aria-hidden="true" focusable="false" {...rest}
    >
      {d.split('M').filter(Boolean).map((seg, i) => <path key={i} d={`M${seg}`} />)}
    </svg>
  )
}

export function LogoMark({ size = 40, ...rest }) {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" fill="none" aria-hidden="true" {...rest}>
      <defs>
        <linearGradient id="slip-mark" x1="2" y1="62" x2="62" y2="2" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#e8562b" />
          <stop offset="1" stopColor="#ffb84d" />
        </linearGradient>
      </defs>
      <rect x="2" y="2" width="60" height="60" rx="18" fill="url(#slip-mark)" />
      <path
        d="M12 52 L28 44 L16 36 L32 28 L20 20 L36 13"
        stroke="#fff6ec" strokeWidth="3.4" strokeLinecap="round" strokeLinejoin="round"
      />
      <circle cx="16" cy="36" r="3.6" fill="#2e6bff" />
    </svg>
  )
}
