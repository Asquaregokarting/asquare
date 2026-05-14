import { describe, it, expect } from 'vitest'
import { renderHook } from '@testing-library/react'
import { usePlatform } from './usePlatform'

describe('usePlatform', () => {
  it('returns web platform in test environment', () => {
    const { result } = renderHook(() => usePlatform())
    expect(result.current.platform).toBe('web')
  })

  it('returns consistent value across re-renders', () => {
    const { result, rerender } = renderHook(() => usePlatform())
    const first = result.current.platform
    rerender()
    expect(result.current.platform).toBe(first)
  })
})
