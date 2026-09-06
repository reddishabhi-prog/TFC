/**
 * Signing in for real: the suite drives the same OTP flow a rider does. The
 * server surfaces the code in development, and the UI prints it in the field
 * hint, so the test reads it from the screen rather than reaching into the DB.
 */
export async function signUp(page, { phone, name }) {
  await page.goto('/')
  await page.locator('.auth-screen').waitFor()
  await page.getByLabel('Mobile number').fill(phone)
  await page.getByRole('button', { name: /Send verification code/i }).click()
  await page.locator('#code').waitFor()
  const hint = await page.locator('#code-hint').innerText()
  const code = (hint.match(/(\d{6})/) || [])[1]
  await page.locator('#code').fill(code)
  await page.getByRole('button', { name: /Verify & continue/i }).click()

  // A number the server has not seen before needs a name first. Wait for
  // whichever surface the verify call actually produces — sampling
  // isVisible() straight after the click races the network, and when the
  // response is slow the name step is silently skipped and the helper then
  // waits forever for a home screen that never arrives.
  const nameField = page.locator('#name')
  await Promise.race([
    nameField.waitFor({ state: 'visible' }),
    page.locator('.home-greeting').waitFor({ state: 'visible' }),
  ])
  if (await nameField.isVisible()) {
    await nameField.fill(name)
    await page.getByRole('button', { name: /Create my account/i }).click()
  }
  await page.locator('.home-greeting').waitFor()
}

/** A phone number nothing else in the suite has used. */
export function freshPhone() {
  return '9' + String(Math.floor(100000000 + Math.random() * 899999999))
}

export async function startRide(page, { name = 'Test Ride', destination = 'Coorg' } = {}) {
  await page.getByRole('button', { name: /Start a ride/i }).click()
  await page.locator('#ride-name').waitFor()
  await page.locator('#ride-name').fill(name)
  if (destination) await page.locator('#ride-to').fill(destination)
  await page.getByRole('button', { name: /Start the ride/i }).click()
  await page.locator('.join-code-value').waitFor()
}
