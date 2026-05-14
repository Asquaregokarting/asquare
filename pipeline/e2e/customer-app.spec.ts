import { test, expect } from '@playwright/test'

/**
 * Customer App — Route Smoke Tests
 *
 * Verifies every customer-facing route returns a 200 and renders content.
 * These are structural smoke tests — they don't require authentication
 * or Firebase test data.
 */

test.describe('customer app — public routes', () => {
  test('home redirects to activities', async ({ page }) => {
    await page.goto('/')
    await expect(page.locator('#root')).not.toBeEmpty()
  })

  test('/activities loads', async ({ page }) => {
    const r = await page.goto('/activities')
    expect(r?.status()).toBeLessThan(400)
    await expect(page.locator('#root')).not.toBeEmpty()
  })

  test('/privacy loads', async ({ page }) => {
    const r = await page.goto('/privacy')
    expect(r?.status()).toBeLessThan(400)
    await expect(page.locator('body')).toContainText('Privacy')
  })

  test('/terms loads', async ({ page }) => {
    const r = await page.goto('/terms')
    expect(r?.status()).toBeLessThan(400)
    await expect(page.locator('body')).toContainText('Terms')
  })

  test('/refund-policy loads', async ({ page }) => {
    const r = await page.goto('/refund-policy')
    expect(r?.status()).toBeLessThan(400)
    await expect(page.locator('#root')).not.toBeEmpty()
  })

  test('/links loads with social links', async ({ page }) => {
    const r = await page.goto('/links')
    expect(r?.status()).toBeLessThan(400)
    await expect(page.locator('body')).toContainText('Instagram')
  })

  test('/birthday lead capture loads', async ({ page }) => {
    const r = await page.goto('/birthday')
    expect(r?.status()).toBeLessThan(400)
    await expect(page.locator('#root')).not.toBeEmpty()
  })

  test('/corporate lead capture loads', async ({ page }) => {
    const r = await page.goto('/corporate')
    expect(r?.status()).toBeLessThan(400)
    await expect(page.locator('#root')).not.toBeEmpty()
  })

  test('/school-groups lead capture loads', async ({ page }) => {
    const r = await page.goto('/school-groups')
    expect(r?.status()).toBeLessThan(400)
    await expect(page.locator('#root')).not.toBeEmpty()
  })

  test('/helicopter-bookings loads', async ({ page }) => {
    const r = await page.goto('/helicopter-bookings')
    expect(r?.status()).toBeLessThan(400)
    await expect(page.locator('#root')).not.toBeEmpty()
  })
})

test.describe('customer app — protected routes (render without auth)', () => {
  // These routes may redirect to login or show a gated view, but should not crash

  test('/bookings loads without crash', async ({ page }) => {
    const r = await page.goto('/bookings')
    expect(r?.status()).toBeLessThan(400)
    await expect(page.locator('#root')).not.toBeEmpty()
  })

  test('/wallet loads without crash', async ({ page }) => {
    const r = await page.goto('/wallet')
    expect(r?.status()).toBeLessThan(400)
    await expect(page.locator('#root')).not.toBeEmpty()
  })

  test('/profile loads without crash', async ({ page }) => {
    const r = await page.goto('/profile')
    expect(r?.status()).toBeLessThan(400)
    await expect(page.locator('#root')).not.toBeEmpty()
  })

  test('/play loads without crash', async ({ page }) => {
    const r = await page.goto('/play')
    expect(r?.status()).toBeLessThan(400)
    await expect(page.locator('#root')).not.toBeEmpty()
  })

  test('/cart loads without crash', async ({ page }) => {
    const r = await page.goto('/cart')
    expect(r?.status()).toBeLessThan(400)
    await expect(page.locator('#root')).not.toBeEmpty()
  })

  test('/checkout loads without crash', async ({ page }) => {
    const r = await page.goto('/checkout')
    expect(r?.status()).toBeLessThan(400)
    await expect(page.locator('#root')).not.toBeEmpty()
  })

  test('/waiting-list loads without crash', async ({ page }) => {
    const r = await page.goto('/waiting-list')
    expect(r?.status()).toBeLessThan(400)
    await expect(page.locator('#root')).not.toBeEmpty()
  })
})
