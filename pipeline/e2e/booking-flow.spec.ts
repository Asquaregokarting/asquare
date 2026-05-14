import { test, expect } from '@playwright/test'

/**
 * End-to-end: OTP login → activity selection → checkout → Razorpay test mode.
 *
 * This test is SKIPPED until the team wires up:
 *
 *   1. A dedicated test Firebase project (separate from production
 *      a-square-6720c) with:
 *        - Auth › Phone › Test phone numbers configured (e.g. +910000000001
 *          → OTP 123456). See Firebase docs.
 *        - A test branch + a test activity seeded in `bookings`/`activities`.
 *        - Cloud Functions deployed to a test region OR mocked via
 *          page.route('**\/createOnlineOrder', …).
 *
 *   2. A `.env.e2e` (gitignored) loaded by Playwright via `webServer.env`
 *      with VITE_FIREBASE_* and VITE_RAZORPAY_KEY_ID pointing at TEST
 *      credentials, never prod.
 *
 *   3. Razorpay test mode key (rzp_test_*) and a stubbed checkout — Razorpay
 *      runs in an iframe and is hard to drive directly. The pragmatic
 *      approach is to intercept window.Razorpay in a page init script and
 *      auto-resolve the handler with a fake payment_id.
 *
 * Once the above is in place, replace `test.skip` with `test` and fill in
 * the selectors. The shape below is what the flow should look like.
 */

test.skip('OTP login → checkout → Razorpay payment success', async ({ page }) => {
  // 1. Stub Razorpay so the test never opens the real iframe.
  await page.addInitScript(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(window as any).Razorpay = function (options: any) {
      return {
        open: () => {
          options.handler({
            razorpay_payment_id: 'pay_test_e2e',
            razorpay_order_id: options.order_id,
            razorpay_signature: 'sig_test_e2e',
          })
        },
        on: () => {},
      }
    }
  })

  await page.goto('/')

  // 2. Pick a branch via the location popup
  await page.getByRole('button', { name: /vizag/i }).click()

  // 3. Sign in with the test phone number that Firebase Auth recognizes
  await page.getByRole('link', { name: /profile/i }).click()
  await page.getByLabel(/phone/i).fill('+910000000001')
  await page.getByRole('button', { name: /send otp/i }).click()
  await page.getByLabel(/otp/i).fill('123456')
  await page.getByRole('button', { name: /verify/i }).click()

  // 4. Add an activity and check out
  await page.getByRole('link', { name: /activities/i }).click()
  await page.getByRole('button', { name: /book now/i }).first().click()
  await page.getByRole('button', { name: /add to cart/i }).click()
  await page.getByRole('link', { name: /cart/i }).click()
  await page.getByRole('button', { name: /checkout/i }).click()
  await page.getByRole('button', { name: /pay now/i }).click()

  // 5. After the stubbed Razorpay handler resolves, the app should land on
  //    a confirmation screen.
  await expect(page.getByText(/booking confirmed/i)).toBeVisible({ timeout: 15_000 })
})
