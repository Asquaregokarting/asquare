/**
 * Global Test Setup — PRODUCTION SAFETY
 *
 * This file runs before every test file. It ensures:
 * 1. Firebase is fully mocked (ZERO network calls, ZERO production data access)
 * 2. Capacitor is stubbed (tests think they're on web)
 * 3. Browser APIs are shimmed for jsdom
 * 4. Fake environment variables (not your real .env keys)
 * 5. All state is cleaned between tests
 */

import '@testing-library/jest-dom'
import { afterEach, vi } from 'vitest'
import { cleanup } from '@testing-library/react'
import { registerFirebaseMocks } from './mocks/firebase'
import { registerCapacitorMocks } from './mocks/capacitor'

// ── Fake environment variables (NOT real keys) ──────────────────────
// These satisfy the validation in src/lib/firebase.ts without exposing real config

vi.stubEnv('VITE_FIREBASE_API_KEY', 'FAKE_API_KEY_FOR_TESTING')
vi.stubEnv('VITE_FIREBASE_AUTH_DOMAIN', 'fake-project.firebaseapp.com')
vi.stubEnv('VITE_FIREBASE_PROJECT_ID', 'fake-project-id')
vi.stubEnv('VITE_FIREBASE_STORAGE_BUCKET', 'fake-project.appspot.com')
vi.stubEnv('VITE_FIREBASE_MESSAGING_SENDER_ID', '000000000000')
vi.stubEnv('VITE_FIREBASE_APP_ID', '1:000000000000:web:fake000000000000')
vi.stubEnv('VITE_FIREBASE_MEASUREMENT_ID', 'G-FAKEXXXXXX')
vi.stubEnv('VITE_RAZORPAY_KEY_ID', 'rzp_test_FAKE000000000')
vi.stubEnv('VITE_GOOGLE_MAPS_API_KEY', 'FAKE_MAPS_KEY')

// ── Register module mocks (before any imports resolve) ──────────────

registerFirebaseMocks()
registerCapacitorMocks()

// ── Framer Motion mock (global) ────────────────────────────────────
// Replaces motion components with plain HTML elements and AnimatePresence
// with a passthrough fragment. This unblocks ALL component tests that
// import framer-motion without needing per-file mocks.
vi.mock('framer-motion', async () => {
  const React = await import('react')
  // Proxy that turns motion.div / motion.span / motion.section etc. into
  // plain elements, stripping animation props so React doesn't warn.
  const MOTION_PROPS = new Set([
    'initial',
    'animate',
    'exit',
    'transition',
    'variants',
    'whileHover',
    'whileTap',
    'whileFocus',
    'whileDrag',
    'whileInView',
    'drag',
    'dragConstraints',
    'dragElastic',
    'dragMomentum',
    'dragTransition',
    'layout',
    'layoutId',
    'onAnimationStart',
    'onAnimationComplete',
    'onDragStart',
    'onDrag',
    'onDragEnd',
  ])
  function stripMotionProps(props: Record<string, unknown>) {
    const clean: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(props)) {
      if (!MOTION_PROPS.has(k)) clean[k] = v
    }
    return clean
  }
  const motion = new Proxy(
    {},
    {
      get(_target, tag: string) {
        return React.forwardRef((props: Record<string, unknown>, ref: unknown) =>
          React.createElement(tag, { ...stripMotionProps(props), ref }),
        )
      },
    },
  )
  return {
    motion,
    AnimatePresence: ({ children }: { children: React.ReactNode }) => children,
    useAnimation: () => ({ start: vi.fn(), stop: vi.fn(), set: vi.fn() }),
    useMotionValue: (init: number) => ({ get: () => init, set: vi.fn(), onChange: vi.fn() }),
    useTransform: () => ({ get: () => 0, set: vi.fn() }),
    useSpring: () => ({ get: () => 0, set: vi.fn() }),
    useInView: () => true,
    useScroll: () => ({ scrollY: { get: () => 0 }, scrollYProgress: { get: () => 0 } }),
  }
})

// ── Browser API shims for jsdom ─────────────────────────────────────

// matchMedia — used by Tailwind responsive components
Object.defineProperty(window, 'matchMedia', {
  writable: true,
  value: vi.fn().mockImplementation((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })),
})

// navigator.vibrate — used in src/lib/utils.ts
Object.defineProperty(navigator, 'vibrate', {
  writable: true,
  value: vi.fn(() => true),
})

// IntersectionObserver — used by Framer Motion and lazy loading
class MockIntersectionObserver {
  observe = vi.fn()
  unobserve = vi.fn()
  disconnect = vi.fn()
}
Object.defineProperty(window, 'IntersectionObserver', {
  writable: true,
  value: MockIntersectionObserver,
})

// ResizeObserver — used by some chart/UI libraries
class MockResizeObserver {
  observe = vi.fn()
  unobserve = vi.fn()
  disconnect = vi.fn()
}
Object.defineProperty(window, 'ResizeObserver', {
  writable: true,
  value: MockResizeObserver,
})

// scrollTo — jsdom doesn't implement it
window.scrollTo = vi.fn() as unknown as typeof window.scrollTo

// ── Razorpay — undefined by default (tests that need it override) ───

// window.Razorpay is intentionally NOT defined here.
// Tests that test payment flows should mock it explicitly:
//   vi.stubGlobal('Razorpay', vi.fn(() => ({ open: vi.fn(), on: vi.fn() })))

// ── Cleanup between tests ───────────────────────────────────────────

afterEach(() => {
  cleanup() // React Testing Library DOM cleanup
  vi.restoreAllMocks() // Reset all vi.fn() call history
  localStorage.clear()
  sessionStorage.clear()
})
