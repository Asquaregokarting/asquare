import { describe, it, expect, beforeEach } from 'vitest'

// Capacitor mock is in setup.ts — isNativePlatform returns false (web)
import { storage } from './storage'

describe('storage (web mode)', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it('set stores value in localStorage', async () => {
    await storage.set('test_key', 'test_value')
    expect(localStorage.getItem('test_key')).toBe('test_value')
  })

  it('get retrieves value from localStorage', async () => {
    localStorage.setItem('test_key', 'hello')
    const result = await storage.get('test_key')
    expect(result).toBe('hello')
  })

  it('get returns null for missing key', async () => {
    const result = await storage.get('nonexistent')
    expect(result).toBeNull()
  })

  it('remove deletes key from localStorage', async () => {
    localStorage.setItem('test_key', 'value')
    await storage.remove('test_key')
    expect(localStorage.getItem('test_key')).toBeNull()
  })

  it('clear empties localStorage', async () => {
    localStorage.setItem('a', '1')
    localStorage.setItem('b', '2')
    await storage.clear()
    expect(localStorage.length).toBe(0)
  })

  it('set overwrites existing value', async () => {
    await storage.set('key', 'old')
    await storage.set('key', 'new')
    expect(await storage.get('key')).toBe('new')
  })

  it('handles empty string value', async () => {
    await storage.set('empty', '')
    expect(await storage.get('empty')).toBe('')
  })

  it('handles JSON serialized objects', async () => {
    const obj = { name: 'Test', tier: 'gold' }
    await storage.set('user', JSON.stringify(obj))
    const result = await storage.get('user')
    expect(JSON.parse(result!)).toEqual(obj)
  })
})
