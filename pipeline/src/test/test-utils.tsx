/* eslint-disable react-refresh/only-export-components -- test helpers + render wrapper co-located by convention */
/**
 * Test Utilities — Render wrappers and mock data factories
 *
 * Usage:
 *   import { renderWithProviders, createMockUser } from '../test/test-utils'
 *
 *   it('renders profile', () => {
 *     const user = createMockUser({ displayName: 'Test User' })
 *     renderWithProviders(<Profile />, { user })
 *   })
 */

import React, { type ReactElement } from 'react'
import { render, type RenderOptions } from '@testing-library/react'
import { BrowserRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { HelmetProvider } from 'react-helmet-async'

import type {
  User,
  Activity,
  Booking,
  BookingItem,
  SpinPrize,
  UserSpins,
  GameProgress,
} from '../types'

// ── Query Client for tests (no retries, no refetch) ────────────────

function createTestQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
        gcTime: 0,
      },
      mutations: {
        retry: false,
      },
    },
  })
}

// ── Provider wrapper for Customer App ───────────────────────────────

interface CustomerProviderOptions {
  route?: string
}

function CustomerProviders({
  children,
  options,
}: {
  children: React.ReactNode
  options?: CustomerProviderOptions
}) {
  const queryClient = createTestQueryClient()

  if (options?.route) {
    window.history.pushState({}, 'Test page', options.route)
  }

  return (
    <QueryClientProvider client={queryClient}>
      <HelmetProvider>
        <BrowserRouter>{children}</BrowserRouter>
      </HelmetProvider>
    </QueryClientProvider>
  )
}

// ── Provider wrapper for Pipeline Admin App ─────────────────────────

function PipelineProviders({ children }: { children: React.ReactNode }) {
  const queryClient = createTestQueryClient()

  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>{children}</BrowserRouter>
    </QueryClientProvider>
  )
}

// ── Render helpers ──────────────────────────────────────────────────

export function renderWithProviders(
  ui: ReactElement,
  options?: CustomerProviderOptions & Omit<RenderOptions, 'wrapper'>,
) {
  const { route, ...renderOptions } = options ?? {}
  return render(ui, {
    wrapper: ({ children }) => (
      <CustomerProviders options={{ route }}>{children}</CustomerProviders>
    ),
    ...renderOptions,
  })
}

export function renderPipelineWithProviders(
  ui: ReactElement,
  options?: Omit<RenderOptions, 'wrapper'>,
) {
  return render(ui, {
    wrapper: PipelineProviders,
    ...options,
  })
}

// ── Mock Data Factories ─────────────────────────────────────────────

export function createMockUser(overrides?: Partial<User>): User {
  return {
    id: 'test-user-001',
    displayName: 'Test User',
    phone: '+919876543210',
    email: 'test@example.com',
    tires: 50,
    walletBalance: 500,
    tier: 'silver',
    referralCode: 'TEST123',
    createdAt: new Date('2025-01-01'),
    updatedAt: new Date('2025-06-01'),
    isVerified: true,
    ...overrides,
  }
}

export function createMockActivity(overrides?: Partial<Activity>): Activity {
  return {
    id: 'gokarting-adult',
    name: 'Go Karting — Adult',
    description: 'High-speed go-kart racing for adults',
    image: '/img/gokarting.webp',
    basePrice: 500,
    available: true,
    category: 'gokarting',
    platforms: ['web', 'android', 'ios', 'pos'],
    variants: [
      { laps: 5, price: 400, apiId: 'gk-adult-5' },
      { laps: 8, price: 600, apiId: 'gk-adult-8' },
      { laps: 10, price: 750, apiId: 'gk-adult-10' },
    ],
    locationIds: ['vizag', 'kakinada', 'rajahmundry'],
    ...overrides,
  }
}

export function createMockBookingItem(overrides?: Partial<BookingItem>): BookingItem {
  return {
    activity: createMockActivity(),
    quantity: 2,
    duration: 30,
    date: '2026-04-15',
    timeSlot: '10:00',
    price: 1000,
    ...overrides,
  }
}

export function createMockBooking(overrides?: Partial<Booking>): Booking {
  return {
    id: 'booking-001',
    userId: 'test-user-001',
    locationId: 'vizag',
    items: [createMockBookingItem()],
    totalAmount: 1000,
    discountAmount: 0,
    finalAmount: 1000,
    paymentStatus: 'completed',
    bookingStatus: 'confirmed',
    qrCode: 'ASQUARE-booking-001-XYZ',
    createdAt: new Date('2026-04-01'),
    sessionDate: new Date('2026-04-15'),
    tires: 100,
    paymentMethod: 'upi',
    ...overrides,
  }
}

export function createMockSpinPrize(overrides?: Partial<SpinPrize>): SpinPrize {
  return {
    id: 'prize-001',
    name: '10 Tires',
    description: 'Win 10 bonus tires',
    tier: 'common',
    type: 'tires',
    value: 10,
    icon: '🏎️',
    color: '#0066FF',
    weight: 40,
    ...overrides,
  }
}

export function createMockUserSpins(overrides?: Partial<UserSpins>): UserSpins {
  return {
    available: 3,
    total: 10,
    used: 7,
    history: [],
    lastEarnedAt: new Date('2026-03-30'),
    ...overrides,
  }
}

export function createMockGameProgress(overrides?: Partial<GameProgress>): GameProgress {
  return {
    puzzlesCompleted: 5,
    memoryGamesWon: 3,
    runnerHighScore: 1200,
    triviaQuestionsAnswered: 20,
    currentStreak: 4,
    longestStreak: 7,
    lastPlayedAt: new Date('2026-03-30'),
    ...overrides,
  }
}

/**
 * Create a mock pipeline user session for admin app testing.
 */
export function createMockPipelineSession(
  role: string = 'Admin',
  overrides?: Record<string, unknown>,
) {
  return {
    uid: 'admin-001',
    email: 'admin@asquaregokarting.com',
    displayName: 'Test Admin',
    role,
    allowedLocations: ['visakhapatnam', 'kakinada', 'rajahmundry', 'srikakulam'],
    loginAt: new Date().toISOString(),
    ...overrides,
  }
}

// ── Re-export testing library for convenience ───────────────────────

export { render, cleanup, screen, waitFor, within, act, fireEvent } from '@testing-library/react'
