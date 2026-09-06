# Slipstream

Group-ride companion: live ride tracking, one-tap SOS, rider chat, a bike
garage, and Splitwise-style expense splitting that actually adds up.

React + Vite on the front, Express + SQLite on the back.

## Running it

```bash
npm install
npm run dev          # API on :5174, web on :5173 (proxied, so one origin)
```

Open http://localhost:5173.

For a single-process build (the API serves the built SPA):

```bash
npm run build
npm start            # everything on :5174
```

### Signing in during development

There is no SMS provider wired up. Rather than pretend a message was sent, the
server returns the code in the response and the UI prints it under the code
field. In production the same endpoint refuses to issue codes unless
`SMS_PROVIDER_URL` is configured.

## Configuration

| Variable | Default | Notes |
| --- | --- | --- |
| `PORT` | `5174` | API port |
| `SLIPSTREAM_DB` | `data/slipstream.db` | SQLite file path |
| `JWT_SECRET` | dev fallback | **Required** in production — the server refuses to boot without it |
| `SMS_PROVIDER_URL` | — | Required in production to issue OTPs |
| `VITE_API_URL` | `/api` | Point the client at a separate API host |

## Layout

```
server/
  index.js          Express app; serves dist/ when it exists
  lib/db.js         Schema (idempotent, runs on boot)
  lib/auth.js       JWT, password hashing, user serialisation
  lib/balances.js   Split maths and settlement suggestions
  routes/           auth, users, rides, groups, misc (chat/garage/notifications)
src/
  theme/tokens.css  Every colour, space, radius, duration
  components/       Button, Field, Sheet, ConfirmDialog, RiderPicker, Icon…
  context/          Auth, Theme, Toast
  screens/          One file per screen
  services/api.js   Typed endpoint map + error handling
  utils/validate.js Shared by the client AND the server
tests/e2e/          Playwright: flows.spec.js + regressions.spec.js
```

## Design notes

**Money is integer paise, never floats.** An even split distributes the
remainder a paisa at a time, so shares always sum to exactly the total. A
group can only be closed once every member's net balance is zero.

**Validation lives in one file.** `src/utils/validate.js` is imported by the
React forms *and* the Express routes, so the inline hint a rider sees and the
rule the server enforces cannot drift apart.

**Light and dark, no "system".** What a rider picks is what they get on every
device. Brand tokens are theme-invariant; only surfaces, text and borders
change.

**Authorisation is checked server-side.** Only the rider who logged an expense
can edit or delete it. Non-members get a 404 (not a 403) for groups and chats,
so the API never confirms that something exists to someone who can't see it.

## Testing

```bash
npm run test:e2e
```

24 Playwright tests covering auth, rides, split, chat, garage, profile
validation and theming. `regressions.spec.js` pins three bugs that were found
by using the app rather than by unit tests; each of those tests was verified to
fail against the pre-fix code, so it is testing behaviour rather than restating
the implementation.

The suite uses the Chromium already installed in this environment. Override
with `PLAYWRIGHT_CHROMIUM_PATH` if yours lives elsewhere.
