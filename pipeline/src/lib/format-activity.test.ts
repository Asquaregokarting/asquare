import { describe, it, expect } from 'vitest'
import { formatActivityLabel, formatActivityDisplay } from './format-activity'

describe('formatActivityLabel', () => {
  it('formats gokarting with laps', () => {
    expect(formatActivityLabel({ name: 'Gokarting Adult (8 Laps)', category: 'gokarting' })).toBe(
      'Go Karting – Adult – 8 Laps',
    )
  })

  it('formats gokarting without laps', () => {
    expect(formatActivityLabel({ name: 'Gokarting Child', category: 'gokarting' })).toBe(
      'Go Karting – Child',
    )
  })

  it('formats gokarting case insensitive', () => {
    expect(formatActivityLabel({ name: 'Gokarting Double (10 Laps)', category: 'GoKarting' })).toBe(
      'Go Karting – Double – 10 Laps',
    )
  })

  it('formats non-gokarting with different category', () => {
    expect(formatActivityLabel({ name: 'Single Zipline', category: 'Zipline' })).toBe(
      'Zipline – Single Zipline',
    )
  })

  it('returns name alone when category matches name', () => {
    expect(formatActivityLabel({ name: 'Mechanical Bull', category: 'Mechanical Bull' })).toBe(
      'Mechanical Bull',
    )
  })

  it('returns name alone when no category', () => {
    expect(formatActivityLabel({ name: 'Paintball' })).toBe('Paintball')
  })

  it('handles empty category', () => {
    expect(formatActivityLabel({ name: 'Archery', category: '' })).toBe('Archery')
  })

  it('handles kart in category name', () => {
    expect(formatActivityLabel({ name: 'Gokarting Adult (5 Laps)', category: 'go-kart' })).toBe(
      'Go Karting – Adult – 5 Laps',
    )
  })
})

describe('formatActivityDisplay', () => {
  it('appends quantity', () => {
    expect(
      formatActivityDisplay({ name: 'Gokarting Adult (8 Laps)', category: 'gokarting' }, 4),
    ).toBe('Go Karting – Adult – 8 Laps × 4')
  })

  it('works with simple activity', () => {
    expect(formatActivityDisplay({ name: 'Paintball' }, 2)).toBe('Paintball × 2')
  })

  it('quantity of 1', () => {
    expect(formatActivityDisplay({ name: 'Zipline', category: 'Zipline' }, 1)).toBe('Zipline × 1')
  })
})
