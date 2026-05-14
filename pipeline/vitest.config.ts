/// <reference types="vitest" />
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'path'

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@pipeline': resolve(__dirname, 'src/pipeline'),
    },
  },
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    include: ['src/**/*.{test,spec}.{ts,tsx}', 'scripts/**/*.{test,spec}.{ts,tsx}'],
    exclude: ['node_modules', 'dist', 'android', 'ios', 'functions', 'e2e'],
    // Don't fail CI when no tests exist yet — Sprint 2 backfills coverage.
    // Once coverage thresholds are set this becomes redundant.
    passWithNoTests: true,
    coverage: {
      provider: 'v8',
      include: ['src/**/*.{ts,tsx}'],
      exclude: [
        'src/**/*.{test,spec}.{ts,tsx}',
        'src/**/*.d.ts',
        'src/test/**',
        'src/vite-env.d.ts',
        'src/css.d.ts',
      ],
      // Per-file thresholds anchored at the current Sprint 2.6 baseline.
      // These act as regression guards — if a future change drops coverage on
      // any tested file, CI fails. Ratchet these up as more tests get added.
      thresholds: {
        'src/services/walletService.ts': {
          lines: 60,
          functions: 40,
          branches: 80,
          statements: 60,
        },
        'src/services/couponService.ts': {
          lines: 35,
          functions: 15,
          branches: 65,
          statements: 35,
        },
        'src/services/bookingService.ts': {
          lines: 15,
          functions: 3,
          branches: 95,
          statements: 15,
        },
        'src/lib/logger.ts': {
          lines: 80,
          functions: 80,
          branches: 70,
          statements: 80,
        },
        'src/pipeline/pages/modules/bookings/coupon-application.ts': {
          lines: 95,
          functions: 100,
          branches: 90,
          statements: 95,
        },
        'src/pipeline/features/game-revenue/aggregate.ts': {
          lines: 90,
          functions: 90,
          branches: 80,
          statements: 90,
        },
        // Session 3 additions — lock in coverage for newly tested modules
        'src/lib/utils.ts': {
          lines: 70,
          functions: 70,
          branches: 60,
          statements: 70,
        },
        'src/lib/date-format.ts': {
          lines: 80,
          functions: 80,
          branches: 70,
          statements: 80,
        },
        'src/lib/locations.ts': {
          lines: 50,
          functions: 40,
          branches: 40,
          statements: 50,
        },
        'src/lib/unified-booking.ts': {
          lines: 15,
          functions: 30,
          branches: 10,
          statements: 15,
        },
        'src/lib/format-activity.ts': {
          lines: 90,
          functions: 100,
          branches: 80,
          statements: 90,
        },
        'src/lib/storage.ts': {
          lines: 60,
          functions: 60,
          branches: 50,
          statements: 60,
        },
        'src/lib/analytics.ts': {
          lines: 30,
          functions: 30,
          branches: 20,
          statements: 30,
        },
        'src/pipeline/api/firestore-utils.ts': {
          lines: 90,
          functions: 100,
          branches: 80,
          statements: 90,
        },
        'src/pipeline/api/lead-scoring.ts': {
          lines: 80,
          functions: 100,
          branches: 70,
          statements: 80,
        },
        'src/pipeline/api/cache.ts': {
          lines: 90,
          functions: 100,
          branches: 80,
          statements: 90,
        },
        // Customer 360 — pure bucket derivation. Mirror of the bucket
        // Cloud Function trigger; locking high coverage prevents drift.
        'src/pipeline/api/customer-buckets.ts': {
          lines: 95,
          functions: 100,
          branches: 90,
          statements: 95,
        },
        // Staff Monitor — pure helpers are fully exercised by the unit tests.
        'src/pipeline/api/staff-presence-firestore.ts': {
          lines: 40,
          functions: 40,
          branches: 55,
          statements: 40,
        },
      },
    },
    // Prevent tests from making real network calls
    server: {
      deps: {
        inline: ['firebase'],
      },
    },
  },
})
