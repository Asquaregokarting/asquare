import { describe, it, expect } from 'vitest'
import { render, screen, act } from '@testing-library/react'
import OfflineToast from './OfflineToast'

describe('OfflineToast', () => {
  it('does not render when online', () => {
    render(<OfflineToast />)
    expect(screen.queryByText('No internet connection')).not.toBeInTheDocument()
  })

  it('renders when offline', () => {
    render(<OfflineToast />)
    act(() => {
      window.dispatchEvent(new Event('offline'))
    })
    expect(screen.getByText('No internet connection')).toBeInTheDocument()
  })

  it('disappears when back online', () => {
    render(<OfflineToast />)
    act(() => window.dispatchEvent(new Event('offline')))
    expect(screen.getByText('No internet connection')).toBeInTheDocument()
    act(() => window.dispatchEvent(new Event('online')))
    expect(screen.queryByText('No internet connection')).not.toBeInTheDocument()
  })
})
