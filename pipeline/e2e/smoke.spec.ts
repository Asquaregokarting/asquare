import { test, expect } from '@playwright/test'

/**
 * Smoke test — verifies the app boots, the bundle loads, and the customer
 * router lands somewhere reasonable. This is the cheapest possible signal
 * that nothing in main.tsx / CustomerApp.tsx is broken on a release build.
 */
test.describe('customer app smoke', () => {
  test('boots and renders the activities route', async ({ page }) => {
    await page.goto('/')

    // Customer app's index redirects to /activities (see CustomerApp.tsx).
    // We don't assert on the URL because the location-select popup may
    // intercept first; instead, we wait for the body to have non-empty text.
    await expect(page.locator('body')).toBeVisible()
    await expect(page.locator('#root')).not.toBeEmpty()
  })

  test('serves a 200 for the privacy policy public route', async ({ page }) => {
    const response = await page.goto('/privacy')
    expect(response?.status()).toBeLessThan(400)
  })
})
