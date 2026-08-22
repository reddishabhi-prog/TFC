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
    await expect(page.locator('.road-svg')).toBeVisible()
    await expect(page.locator('.rider-marker')).toHaveCount(1)
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
