import { test, expect } from '@playwright/test'

/**
 * Pipeline Admin — Customer 360 Smoke Tests
 *
 * Structural smoke tests for the new Customer 360 routes (list page with
 * advanced search/filter/sort + per-customer detail page with 7 tabs).
 *
 * Auth-gated routes redirect to login when no session exists, so these
 * tests verify:
 *   - Routes resolve without crash
 *   - Renders something (login page or page shell)
 *
 * For full interactive flows (search → click row → tab navigation →
 * cursor pagination), a seeded test Firebase project is needed —
 * see e2e/booking-flow.spec.ts header for the setup checklist.
 */

test.describe('customer 360', () => {
  test('customers list route loads without error', async ({ page }) => {
    const response = await page.goto('/admin/customers?app=pipeline')
    expect(response?.status()).toBeLessThan(400)
    await expect(page.locator('#root')).not.toBeEmpty()
  })

  test('customer detail route resolves for arbitrary id', async ({ page }) => {
    // Even with a non-existent id the page must render (it should show the
    // "Customer not found" ErrorState, not crash).
    const response = await page.goto('/admin/customers/test-customer-id?app=pipeline')
    expect(response?.status()).toBeLessThan(400)
    await expect(page.locator('#root')).not.toBeEmpty()
  })

  test('customer detail route accepts tab query param', async ({ page }) => {
    for (const tab of [
      'overview',
      'bookings',
      'games',
      'wallet',
      'tires',
      'coupons',
      'referrals',
    ]) {
      const response = await page.goto(`/admin/customers/test-id?app=pipeline&tab=${tab}`)
      expect(response?.status(), `tab=${tab} should resolve`).toBeLessThan(400)
      await expect(page.locator('#root')).not.toBeEmpty()
    }
  })

  test('legacy /admin/members redirects to /admin/customers', async ({ page }) => {
    await page.goto('/admin/members?app=pipeline')
    // The Navigate component swaps the URL client-side after the React
    // router boots — wait for the URL to settle on /admin/customers.
    await page.waitForURL(/\/admin\/customers(\?|$)/, { timeout: 10_000 })
  })
})
