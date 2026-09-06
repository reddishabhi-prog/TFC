import { test, expect } from '@playwright/test'
import { signUp, freshPhone, startRide } from './helpers.js'

/**
 * Each test here pins a bug that shipped and was caught by using the app, not
 * by a unit test. Each one was confirmed to fail against the pre-fix code.
 */
test.describe('Regressions', () => {
  test('a brand-new number can finish signing up', async ({ page }) => {
    // The OTP used to be consumed on the first verify, before the "this number
    // needs a name" check. The client then came back with the name and the
    // same code — and the server had already thrown the code away, so signup
    // was impossible for every new user.
    const phone = freshPhone()
    await page.goto('/')
    await page.locator('.auth-screen').waitFor()
    await page.getByLabel('Mobile number').fill(phone)
    await page.getByRole('button', { name: /Send verification code/i }).click()
    await page.locator('#code').waitFor()
    const code = ((await page.locator('#code-hint').innerText()).match(/(\d{6})/) || [])[1]
    await page.locator('#code').fill(code)
    await page.getByRole('button', { name: /Verify & continue/i }).click()

    // Name step appears, and the SAME code must still be accepted behind it.
    await expect(page.locator('#name')).toBeVisible()
    await page.locator('#name').fill('Newcomer Rider')
    await page.getByRole('button', { name: /Create my account/i }).click()

    await expect(page.locator('.home-greeting')).toContainText('Newcomer')
  })

  test('a form inside a bottom sheet is actually clickable', async ({ page }) => {
    // The scrim sat above the sheet in the stacking order and swallowed every
    // pointer event, so Add Expense, New Group, Members and Add Vehicle were
    // all dead. A visibility check passes either way — the fields are on
    // screen — so this asserts a real click reaches the input.
    await signUp(page, { phone: freshPhone(), name: 'Sheet Tester' })
    await page.locator('.tab-bar').getByRole('button', { name: 'Split', exact: true }).click()
    await page.getByRole('button', { name: /Group/i }).first().click()

    const nameInput = page.locator('#grp-name')
    await nameInput.waitFor()
    // .fill() would bypass the overlay; a real click is what regressed.
    await nameInput.click({ timeout: 5000 })
    await page.keyboard.type('Goa Trip')
    await expect(nameInput).toHaveValue('Goa Trip')

    await page.getByRole('button', { name: /Create group/i }).click()
    await expect(page.locator('#group-select')).toContainText('Goa Trip')
  })

  test('list titles and subtitles stack instead of running together', async ({ page }) => {
    // Both are spans inside a button (a button may not contain block-level
    // children), so without an explicit display they rendered inline and read
    // as "Priya owes" on one line.
    await signUp(page, { phone: freshPhone(), name: 'Layout Tester' })
    await startRide(page, { name: 'Layout Run' })
    await page.locator('.tab-bar').getByRole('button', { name: 'Split', exact: true }).click()

    const row = page.locator('.list-row').first()
    await row.waitFor()
    const title = row.locator('.list-row-title')
    const sub = row.locator('.list-row-sub')
    const [t, s] = await Promise.all([title.boundingBox(), sub.boundingBox()])
    // The subtitle must begin below the title, not beside it. The broken
    // version put them ~13px apart on the same line; a few px of tolerance
    // absorbs sub-pixel boundingBox() rounding without masking that bug.
    expect(s.y).toBeGreaterThanOrEqual(t.y + t.height - 4)
  })

  test('the generic bottom Sheet renders its own theme, not the dark action-sheet', async ({ page }) => {
    // ui.jsx's <Sheet> (Add vehicle, New group, Add a pit stop, ...) shared
    // the bare class name .sheet with RideMemories/RideShareCard's unrelated
    // dark full-bleed panel. Same specificity, later in the file, so that
    // rule's #1b1716 background/padding/animation silently won on every
    // generic sheet in the app instead of the intended surface-raised theme.
    await signUp(page, { phone: freshPhone(), name: 'Sheet Theme Checker' })
    await page.getByRole('button', { name: 'Me', exact: true }).click()
    await page.getByRole('button', { name: /garage/i }).click()
    await page.getByRole('button', { name: 'Add a vehicle' }).click()

    const sheet = page.locator('.sheet')
    await expect(sheet).toBeVisible()
    const bg = await sheet.evaluate((el) => getComputedStyle(el).backgroundColor)
    expect(bg).not.toBe('rgb(27, 23, 22)')
  })
})
