import { test, expect } from '@playwright/test'

/**
 * Pipeline Admin — Bookings Module Visual Regression Tests
 *
 * Uses Playwright's built-in `toHaveScreenshot()` for pixel-level comparison.
 *
 * First run:  npx playwright test e2e/pipeline-bookings-visual.spec.ts --update-snapshots
 *             → generates baseline screenshots in e2e/__screenshots__/
 *
 * Later runs: npx playwright test e2e/pipeline-bookings-visual.spec.ts
 *             → compares against baselines, fails on visual diff
 *
 * These tests capture the login/landing page state for each bookings route.
 * Once a test Firebase project is available and auth can be automated,
 * expand these to capture authenticated view states.
 */

const VISUAL_OPTIONS = {
  maxDiffPixelRatio: 0.02,
  // Allow small timing differences in animations
  animations: 'disabled' as const,
}

test.describe('bookings visual regression', () => {
  test('pipeline landing matches baseline', async ({ page }) => {
    await page.goto('/?app=pipeline')
    await expect(page.locator('#root')).not.toBeEmpty()
    // Wait for any initial render to settle
    await page.waitForTimeout(500)
    await expect(page).toHaveScreenshot('pipeline-landing.png', VISUAL_OPTIONS)
  })

  test('bookings create route matches baseline', async ({ page }) => {
    await page.goto('/bookings/create?app=pipeline')
    await expect(page.locator('#root')).not.toBeEmpty()
    await page.waitForTimeout(500)
    await expect(page).toHaveScreenshot('bookings-create.png', VISUAL_OPTIONS)
  })

  test('bookings list route matches baseline', async ({ page }) => {
    await page.goto('/bookings/list?app=pipeline')
    await expect(page.locator('#root')).not.toBeEmpty()
    await page.waitForTimeout(500)
    await expect(page).toHaveScreenshot('bookings-list.png', VISUAL_OPTIONS)
  })

  test('bookings trash route matches baseline', async ({ page }) => {
    await page.goto('/bookings/trash?app=pipeline')
    await expect(page.locator('#root')).not.toBeEmpty()
    await page.waitForTimeout(500)
    await expect(page).toHaveScreenshot('bookings-trash.png', VISUAL_OPTIONS)
  })

  test('bookings ticket route matches baseline', async ({ page }) => {
    await page.goto('/bookings/ticket?app=pipeline')
    await expect(page.locator('#root')).not.toBeEmpty()
    await page.waitForTimeout(500)
    await expect(page).toHaveScreenshot('bookings-ticket.png', VISUAL_OPTIONS)
  })

  test('bookings protocol route matches baseline', async ({ page }) => {
    await page.goto('/bookings/protocol?app=pipeline')
    await expect(page.locator('#root')).not.toBeEmpty()
    await page.waitForTimeout(500)
    await expect(page).toHaveScreenshot('bookings-protocol.png', VISUAL_OPTIONS)
  })

  test('bookings checkin route matches baseline', async ({ page }) => {
    await page.goto('/bookings/checkin?app=pipeline')
    await expect(page.locator('#root')).not.toBeEmpty()
    await page.waitForTimeout(500)
    await expect(page).toHaveScreenshot('bookings-checkin.png', VISUAL_OPTIONS)
  })
})
