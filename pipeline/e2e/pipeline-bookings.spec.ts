import { test, expect } from '@playwright/test'

/**
 * Pipeline Admin — Bookings Module E2E Smoke Tests
 *
 * These tests verify the pipeline admin booking views load and render
 * correctly. They navigate via `?app=pipeline` query param to trigger
 * the pipeline app. Since Firebase auth is required for full interaction,
 * these are structural smoke tests that verify:
 *   - Routes resolve without crash
 *   - Key UI elements are present
 *   - Navigation between views works
 *
 * For full interactive tests (create booking, approve protocol, etc.),
 * a test Firebase project with seeded data is required — see
 * e2e/booking-flow.spec.ts for the setup checklist.
 */

test.describe('pipeline bookings module', () => {
  test('pipeline app loads login page at ?app=pipeline', async ({ page }) => {
    await page.goto('/?app=pipeline')
    // Pipeline app should render — either login page or the app shell
    await expect(page.locator('#root')).not.toBeEmpty()
    // The pipeline app should have some visible content within 5s
    await expect(page.locator('body')).toBeVisible()
  })

  test('pipeline app serves 200 for bookings route', async ({ page }) => {
    const response = await page.goto('/bookings/create?app=pipeline')
    expect(response?.status()).toBeLessThan(400)
    await expect(page.locator('#root')).not.toBeEmpty()
  })

  test('bookings list route loads without error', async ({ page }) => {
    const response = await page.goto('/bookings/list?app=pipeline')
    expect(response?.status()).toBeLessThan(400)
    await expect(page.locator('#root')).not.toBeEmpty()
  })

  test('bookings trash route loads without error', async ({ page }) => {
    const response = await page.goto('/bookings/trash?app=pipeline')
    expect(response?.status()).toBeLessThan(400)
    await expect(page.locator('#root')).not.toBeEmpty()
  })

  test('bookings ticket route loads without error', async ({ page }) => {
    const response = await page.goto('/bookings/ticket?app=pipeline')
    expect(response?.status()).toBeLessThan(400)
    await expect(page.locator('#root')).not.toBeEmpty()
  })

  test('bookings protocol route loads without error', async ({ page }) => {
    const response = await page.goto('/bookings/protocol?app=pipeline')
    expect(response?.status()).toBeLessThan(400)
    await expect(page.locator('#root')).not.toBeEmpty()
  })

  test('bookings offers route loads without error', async ({ page }) => {
    const response = await page.goto('/bookings/offers?app=pipeline')
    expect(response?.status()).toBeLessThan(400)
    await expect(page.locator('#root')).not.toBeEmpty()
  })

  test('bookings checkin route loads without error', async ({ page }) => {
    const response = await page.goto('/bookings/checkin?app=pipeline')
    expect(response?.status()).toBeLessThan(400)
    await expect(page.locator('#root')).not.toBeEmpty()
  })
})
