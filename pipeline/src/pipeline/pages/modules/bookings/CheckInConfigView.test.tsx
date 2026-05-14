import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'

// Mock the checkin API
const mockGetConfig = vi.fn()
const mockSaveConfig = vi.fn()
vi.mock('../../../api/asquare-checkin', () => ({
  asquareCheckinApi: {
    getConfig: (...args: unknown[]) => mockGetConfig(...args),
    saveConfig: (...args: unknown[]) => mockSaveConfig(...args),
  },
}))

import CheckInConfigView from './CheckInConfigView'

describe('CheckInConfigView', () => {
  beforeEach(() => {
    mockGetConfig.mockReset()
    mockSaveConfig.mockReset()
  })

  it('shows loading state initially', () => {
    mockGetConfig.mockReturnValue(new Promise(() => {})) // never resolves
    render(<CheckInConfigView />)
    expect(screen.getByText('Loading configuration...')).toBeInTheDocument()
  })

  it('renders config after loading', async () => {
    mockGetConfig.mockResolvedValue({
      slotCapacity: 10,
      availableTimings: ['09:00 AM', '11:00 AM', '02:00 PM'],
    })
    render(<CheckInConfigView />)
    await waitFor(() => {
      expect(screen.getByDisplayValue('10')).toBeInTheDocument()
    })
    expect(screen.getByText('09:00 AM')).toBeInTheDocument()
    expect(screen.getByText('11:00 AM')).toBeInTheDocument()
    expect(screen.getByText('02:00 PM')).toBeInTheDocument()
  })

  it('can change slot capacity', async () => {
    mockGetConfig.mockResolvedValue({
      slotCapacity: 10,
      availableTimings: ['09:00 AM'],
    })
    render(<CheckInConfigView />)
    await waitFor(() => {
      expect(screen.getByDisplayValue('10')).toBeInTheDocument()
    })
    fireEvent.change(screen.getByDisplayValue('10'), { target: { value: '15' } })
    expect(screen.getByDisplayValue('15')).toBeInTheDocument()
  })

  it('can add a new timing', async () => {
    mockGetConfig.mockResolvedValue({
      slotCapacity: 10,
      availableTimings: ['09:00 AM'],
    })
    render(<CheckInConfigView />)
    await waitFor(() => {
      expect(screen.getByText('09:00 AM')).toBeInTheDocument()
    })
    fireEvent.change(screen.getByPlaceholderText('e.g. 09:00 AM'), {
      target: { value: '04:00 PM' },
    })
    fireEvent.click(screen.getByText('Add'))
    expect(screen.getByText('04:00 PM')).toBeInTheDocument()
  })

  it('saves config on button click', async () => {
    mockGetConfig.mockResolvedValue({
      slotCapacity: 10,
      availableTimings: ['09:00 AM'],
    })
    mockSaveConfig.mockResolvedValue(undefined)
    render(<CheckInConfigView />)
    await waitFor(() => {
      expect(screen.getByText('Save Configuration')).toBeInTheDocument()
    })
    fireEvent.click(screen.getByText('Save Configuration'))
    await waitFor(() => {
      expect(mockSaveConfig).toHaveBeenCalledOnce()
    })
    expect(screen.getByText('Check-in configuration saved.')).toBeInTheDocument()
  })

  it('shows error when save fails', async () => {
    mockGetConfig.mockResolvedValue({
      slotCapacity: 10,
      availableTimings: [],
    })
    mockSaveConfig.mockRejectedValue(new Error('Network error'))
    render(<CheckInConfigView />)
    await waitFor(() => {
      expect(screen.getByText('Save Configuration')).toBeInTheDocument()
    })
    fireEvent.click(screen.getByText('Save Configuration'))
    await waitFor(() => {
      expect(screen.getByText('Network error')).toBeInTheDocument()
    })
  })

  it('shows error when load fails', async () => {
    mockGetConfig.mockRejectedValue(new Error('Load failed'))
    render(<CheckInConfigView />)
    await waitFor(() => {
      expect(screen.getByText('Load failed')).toBeInTheDocument()
    })
  })
})
