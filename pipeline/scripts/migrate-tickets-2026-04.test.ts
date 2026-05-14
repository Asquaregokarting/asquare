import { describe, it, expect } from 'vitest'
import { buildV2Patch } from './migrate-tickets-2026-04'

describe('buildV2Patch', () => {
  it('returns null when document is already v2', () => {
    expect(buildV2Patch({ schemaVersion: 2, issue: 'x' })).toBeNull()
  })

  it('maps a v1 document to a v2 patch with defaults', () => {
    const patch = buildV2Patch({
      issue: 'Card reader is offline at counter 2',
      location: 'rajahmundry',
      locationDisplayName: 'Rajahmundry',
      assignedToId: 'dev-1',
      assignedToName: 'Dev',
    })
    expect(patch).not.toBeNull()
    expect(patch!.schemaVersion).toBe(2)
    expect(patch!.title).toBe('Card reader is offline at counter 2')
    expect(patch!.description).toBe('Card reader is offline at counter 2')
    expect(patch!.categoryId).toBe('other')
    expect(patch!.priority).toBe('Normal')
    expect(patch!.branchId).toBe('rajahmundry')
    expect(patch!.branchDisplayName).toBe('Rajahmundry')
    expect(patch!.raisedByKind).toBe('staff')
    expect(patch!.assigneeId).toBe('dev-1')
    expect(patch!.assigneeName).toBe('Dev')
    expect(patch!.assigneeRole).toBe('Developer')
    expect(patch!.attachments).toEqual([])
    expect(patch!.linkedEntities).toEqual([])
    expect(patch!.tags).toEqual([])
    expect(patch!.watcherIds).toEqual([])
    expect(patch!.escalationLevel).toBe(0)
    expect(patch!.mergedInto).toBeNull()
    expect(patch!.reopenedFrom).toBeNull()
  })

  it('truncates very long issues to a 80-char title', () => {
    const longIssue = 'a'.repeat(200)
    const patch = buildV2Patch({ issue: longIssue, location: 'vizag' })
    expect(patch!.title).toHaveLength(80)
    expect(patch!.description).toBe(longIssue)
  })

  it('falls back when location is missing', () => {
    const patch = buildV2Patch({ issue: 'No location set' })
    expect(patch!.branchId).toBe('')
    expect(patch!.branchDisplayName).toBe('')
  })
})
