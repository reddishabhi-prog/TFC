import { test, expect } from '@playwright/test'
import { signUp, freshPhone, startRide } from './helpers.js'

test.describe('Auth', () => {
  test('sign-in stands between the splash and the app', async ({ page }) => {
    await page.goto('/')
    // The splash is brief; the auth screen is what a signed-out rider lands on.
    await expect(page.locator('.auth-screen')).toBeVisible()
    await expect(page.locator('.home-greeting')).toHaveCount(0)
  })

  test('the home screen greets the signed-in rider by name', async ({ page }) => {
    await signUp(page, { phone: freshPhone(), name: 'Arjun Rao' })
    await expect(page.locator('.home-greeting')).toContainText('Hey Arjun')
  })

  test('a short mobile number cannot be submitted', async ({ page }) => {
    await page.goto('/')
    await page.locator('.auth-screen').waitFor()
    await page.getByLabel('Mobile number').fill('12345')
    await expect(page.getByRole('button', { name: /Send verification code/i })).toBeDisabled()
  })

  test('a wrong code is rejected with a field-level message', async ({ page }) => {
    await page.goto('/')
    await page.locator('.auth-screen').waitFor()
    await page.getByLabel('Mobile number').fill(freshPhone())
    await page.getByRole('button', { name: /Send verification code/i }).click()
    await page.locator('#code').fill('000000')
    await page.getByRole('button', { name: /Verify & continue/i }).click()
    await expect(page.locator('#code-error')).toContainText(/not right/i)
  })
})

test.describe('Rides', () => {
  test('creating a ride yields a shareable join code and a live map', async ({ page }) => {
    await signUp(page, { phone: freshPhone(), name: 'Ride Maker' })
    await startRide(page, { name: 'Coastal Sunrise Run', destination: 'Gokarna' })
    await expect(page.locator('.join-code-value')).toHaveText(/^[A-Z0-9]{6}$/)
    // The real Leaflet map (replacing the old fake SVG route) mounts into this
    // container — checked via the class Leaflet itself adds, not the tile
    // layer, since tile images depend on network access to OSM and marker
    // timing depends on the device's geolocation permission and poll cycle.
    await expect(page.locator('.ride-map-canvas.leaflet-container')).toBeVisible()
  })

  test('ending a ride asks for confirmation first', async ({ page }) => {
    await signUp(page, { phone: freshPhone(), name: 'Ender' })
    await startRide(page)
    await page.getByRole('button', { name: /^End$/ }).click()
    await expect(page.getByText('End this ride?')).toBeVisible()
    await page.getByRole('button', { name: /Keep riding/i }).click()
    await expect(page.locator('.sos-btn')).toBeVisible()
  })

  test('SOS needs confirmation and then reports it was sent', async ({ page }) => {
    await signUp(page, { phone: freshPhone(), name: 'Sosser' })
    await startRide(page)
    await page.locator('.sos-btn').click()
    await expect(page.getByText('Send SOS?')).toBeVisible()
    await page.locator('.dialog').getByRole('button', { name: /Send SOS/i }).click()
    await expect(page.locator('.sos-sent')).toBeVisible()
  })
})

test.describe('Checklist', () => {
  test('the leader adds an item, ticks it, and readiness updates', async ({ page }) => {
    await signUp(page, { phone: freshPhone(), name: 'List Maker' })
    await startRide(page, { name: 'Ghat Prep', destination: 'Coorg' })

    await page.locator('.ride-view-toggle').getByRole('button', { name: 'Checklist' }).click()
    await expect(page.getByText('No checklist yet')).toBeVisible()

    await page.getByPlaceholder('Helmet, full tank, rain gear…').fill('Helmet')
    await page.getByRole('button', { name: 'Add item' }).click()
    await expect(page.getByText('Your checklist · 0/1')).toBeVisible()
    await expect(page.locator('.list-row').getByText('0/1')).toBeVisible()

    await page.getByRole('button', { name: 'Check Helmet' }).click()
    await expect(page.getByText('Your checklist · 1/1')).toBeVisible()
    await expect(page.locator('.list-row').getByText('Ready')).toBeVisible()
  })
})

test.describe('Milestones', () => {
  test('a new rider sees locked badges with progress', async ({ page }) => {
    await signUp(page, { phone: freshPhone(), name: 'Fresh Rider' })
    await page.locator('.tab-bar').getByRole('button', { name: 'Me', exact: true }).click()
    await expect(page.getByText('Milestones · 0/9')).toBeVisible()
    await expect(page.locator('.badge', { hasText: 'First Ride' })).toBeVisible()
    await expect(page.locator('.badge.earned')).toHaveCount(0)
  })
})

test.describe('Memories', () => {
  // Actually uploading a file needs a live Vercel Blob token this suite has
  // no access to, so this covers everything reachable without one: the
  // empty state, and the leader-only per-rider limit.
  test('the leader can switch to Memories and change the per-rider limit', async ({ page }) => {
    await signUp(page, { phone: freshPhone(), name: 'Memory Keeper' })
    await startRide(page, { name: 'Ghat Loop', destination: 'Coorg' })

    await page.locator('.ride-view-toggle').getByRole('button', { name: 'Memories' }).click()
    await expect(page.locator('.memories-empty-title')).toHaveText('Add your best memories')
    await expect(page.getByText('0 / 10 shared')).toBeVisible()

    await page.getByRole('button', { name: /Limit/i }).click()
    await expect(page.getByText('Photo & video limit')).toBeVisible()
    await page.getByRole('button', { name: 'Increase' }).click()
    await page.getByRole('button', { name: 'Increase' }).click()
    await expect(page.locator('.stepper-value')).toHaveText('12')
    await page.getByRole('button', { name: /Save limit/i }).click()

    await expect(page.getByText('0 / 12 shared')).toBeVisible()
  })
})

test.describe('Split', () => {
  test.beforeEach(async ({ page }) => {
    await signUp(page, { phone: freshPhone(), name: 'Split Tester' })
    await startRide(page, { name: 'Split Run' })
    await page.locator('.tab-bar').getByRole('button', { name: 'Split', exact: true }).click()
  })

  test('an expense splits evenly and updates the balance', async ({ page }) => {
    await page.getByRole('button', { name: /^Add$/ }).first().click()
    await page.locator('#exp-desc').fill('Petrol')
    await page.locator('#exp-amt').fill('1000')
    await page.getByRole('button', { name: /Add expense/i }).click()
    // Solo group: the payer owes themselves nothing.
    await expect(page.locator('.balance-figure')).toContainText('All square')
    await expect(page.getByText('Petrol')).toBeVisible()
  })

  test('a non-numeric amount is refused', async ({ page }) => {
    await page.getByRole('button', { name: /^Add$/ }).first().click()
    await page.locator('#exp-desc').fill('Chai')
    await page.locator('#exp-amt').fill('abc')
    await page.getByRole('button', { name: /Add expense/i }).click()
    await expect(page.locator('#exp-amt-error')).toBeVisible()
  })

  test('the author can edit their own expense', async ({ page }) => {
    await page.getByRole('button', { name: /^Add$/ }).first().click()
    await page.locator('#exp-desc').fill('Chai')
    await page.locator('#exp-amt').fill('100')
    await page.getByRole('button', { name: /Add expense/i }).click()
    await expect(page.getByText('Chai')).toBeVisible()

    await page.getByRole('button', { name: /Edit Chai/i }).click()
    await page.locator('#exp-desc').fill('Chai and snacks')
    await page.getByRole('button', { name: /Save changes/i }).click()
    await expect(page.getByText('Chai and snacks')).toBeVisible()
  })

  test('a standalone group can be created without any ride', async ({ page }) => {
    await page.getByRole('button', { name: /Group/i }).first().click()
    await page.locator('#grp-name').fill('Flatmates')
    await page.getByRole('button', { name: /Create group/i }).click()
    await expect(page.locator('#group-select')).toContainText('Flatmates')
  })
})

test.describe('Profile & settings', () => {
  test.beforeEach(async ({ page }) => {
    await signUp(page, { phone: freshPhone(), name: 'Profile Tester' })
    await page.locator('.tab-bar').getByRole('button', { name: 'Me', exact: true }).click()
  })

  test('an invalid email is rejected inline', async ({ page }) => {
    await page.locator('#p-email').fill('not-an-email')
    await page.getByRole('button', { name: /Save changes/i }).click()
    await expect(page.locator('#p-email-error')).toContainText(/valid email/i)
  })

  test('a valid email saves', async ({ page }) => {
    await page.locator('#p-email').fill('rider@example.com')
    await page.getByRole('button', { name: /Save changes/i }).click()
    await expect(page.getByText('Profile saved')).toBeVisible()
  })

  test('an emergency number must be 10 digits', async ({ page }) => {
    await page.locator('#p-ename').fill('Dad')
    await page.locator('#p-ephone').fill('98765')
    await page.getByRole('button', { name: /Save changes/i }).click()
    await expect(page.locator('#p-ephone-error')).toBeVisible()
  })

  test('appearance offers light and dark only', async ({ page }) => {
    // Target the control by its accessible name — picking it positionally
    // ("the last .segmented") depends on render order and is flaky.
    const themes = page.getByRole('radiogroup', { name: 'Theme' })
    await expect(themes.getByRole('radio')).toHaveCount(2)
    await expect(themes).toContainText('Light')
    await expect(themes).toContainText('Dark')
    await expect(themes).not.toContainText('System')
  })

  test('choosing dark applies it and survives a reload', async ({ page }) => {
    await page.getByRole('radio', { name: /Dark/i }).click()
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
    await page.reload()
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
  })
})

test.describe('Garage', () => {
  test.beforeEach(async ({ page }) => {
    await signUp(page, { phone: freshPhone(), name: 'Garage Tester' })
    await page.locator('.tab-bar').getByRole('button', { name: 'Me', exact: true }).click()
    await page.getByRole('button', { name: /Bike garage/i }).click()
  })

  test('the empty state offers exactly one way to add a vehicle', async ({ page }) => {
    // The header "Add" and the empty-state "Add a vehicle" were duplicates.
    await expect(page.getByRole('button', { name: /^Add( a vehicle)?$/i })).toHaveCount(1)
  })

  test('a malformed registration number is rejected', async ({ page }) => {
    await page.getByRole('button', { name: /Add a vehicle/i }).click()
    await page.locator('#v-nick').fill('Classic 350')
    await page.locator('#v-reg').fill('nope!!')
    await page.getByRole('button', { name: /^Save$/ }).click()
    await expect(page.locator('#v-reg-error')).toBeVisible()
  })

  test('a vehicle saves and shows its document status', async ({ page }) => {
    await page.getByRole('button', { name: /Add a vehicle/i }).click()
    await page.locator('#v-nick').fill('Classic 350')
    await page.locator('#v-reg').fill('KA01AB1234')
    await page.getByRole('button', { name: /^Save$/ }).click()
    await expect(page.getByText('Classic 350')).toBeVisible()
    await expect(page.locator('.doc-chip')).toHaveCount(3)
  })
})

test.describe('Chat', () => {
  test('a message sends and appears in the thread', async ({ page }) => {
    await signUp(page, { phone: freshPhone(), name: 'Chatter' })
    await startRide(page, { name: 'Chat Run' })
    await page.locator('.tab-bar').getByRole('button', { name: 'Chat', exact: true }).click()
    await page.locator('.list-row').first().click()
    await page.locator('.chat-composer input').fill('Meet at 6am')
    await page.getByLabel('Send message').click()
    await expect(page.locator('.chat-body')).toContainText('Meet at 6am')
  })

  test('an empty message cannot be sent', async ({ page }) => {
    await signUp(page, { phone: freshPhone(), name: 'Empty Chatter' })
    await startRide(page, { name: 'Quiet Run' })
    await page.locator('.tab-bar').getByRole('button', { name: 'Chat', exact: true }).click()
    await page.locator('.list-row').first().click()
    await expect(page.getByLabel('Send message')).toBeDisabled()
  })
})

test.describe('Multi-day trip planning', () => {
  // Planning a real route needs Nominatim/OSRM/Open-Meteo, which this suite
  // has no network access to — so this covers what's reachable without them:
  // the end-date field staying opt-in, and a network failure surfacing a
  // real message instead of hanging or crashing the plan request.
  test('a same-day ride has no end date or Plan tab by default', async ({ page }) => {
    await signUp(page, { phone: freshPhone(), name: 'Day Tripper' })
    await startRide(page, { name: 'Evening Loop' })
    await expect(page.locator('.ride-view-toggle').getByRole('button', { name: 'Plan' })).toHaveCount(0)
  })

  test('setting a trip end date reveals planning, and a failed lookup shows a real error', async ({ page }) => {
    await signUp(page, { phone: freshPhone(), name: 'Trip Planner' })
    await page.getByRole('button', { name: /Start a ride/i }).click()
    await page.locator('#ride-name').waitFor()
    await page.locator('#ride-name').fill('Jaipur to Leh')
    await page.locator('#ride-from').fill('Jaipur')
    await page.locator('#ride-to').fill('Leh')

    await expect(page.getByRole('button', { name: /Plan this route/i })).toHaveCount(0)

    const endDate = new Date(Date.now() + 5 * 86400000).toISOString().slice(0, 10)
    await page.locator('#ride-end-date').fill(endDate)

    const planButton = page.getByRole('button', { name: /Plan this route — 6 days/i })
    await expect(planButton).toBeVisible()
    await planButton.click()
    await expect(page.locator('.field-error')).toBeVisible({ timeout: 15000 })
  })
})
