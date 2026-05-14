import { describe, it, expect } from 'vitest'
import type { Ticket } from './types'
import { escapeCsv, ticketsToCsv, TICKET_CSV_COLUMNS } from './ticket-csv-export'

const baseTicket: Ticket = {
  id: 'TKT-1',
  schemaVersion: 2,
  title: 'sample',
  description: 'sample',
  categoryId: 'other',
  priority: 'Normal',
  tags: [],
  status: 'Open',
  role: 'Admin',
  raisedBy: 'u1',
  raisedByName: 'User One',
  raisedByKind: 'staff',
  branchId: 'vizag',
  branchDisplayName: 'Vizag',
  assignedTo: 'Developer',
  assigneeId: 'a1',
  assigneeRole: 'Admin',
  assigneeName: 'Assignee',
  watcherIds: [],
  attachments: [],
  linkedEntities: [],
  autoContext: {},
  slaSnapshot: null,
  responseDueAt: null,
  resolveDueAt: null,
  firstResponseAt: null,
  resolvedAt: null,
  resolutionNote: null,
  rootCauseTag: null,
  escalationLevel: 0,
  mergedInto: null,
  reopenedFrom: null,
  location: 'vizag',
  locationDisplayName: 'Vizag',
  issue: 'sample',
  assignedToId: 'a1',
  assignedToName: 'Assignee',
  createdAt: '2026-04-20T10:00:00.000Z',
  updatedAt: '2026-04-20T10:00:00.000Z',
}

const t = (over: Partial<Ticket>): Ticket => ({ ...baseTicket, ...over })

describe('escapeCsv', () => {
  it('returns the value unchanged when no special chars are present', () => {
    expect(escapeCsv('hello')).toBe('hello')
  })

  it('quotes values with commas', () => {
    expect(escapeCsv('a, b')).toBe('"a, b"')
  })

  it('escapes embedded double quotes by doubling', () => {
    expect(escapeCsv('he said "hi"')).toBe('"he said ""hi"""')
  })

  it('quotes values with newlines', () => {
    expect(escapeCsv('line1\nline2')).toBe('"line1\nline2"')
  })

  it('quotes values with carriage returns', () => {
    expect(escapeCsv('line1\r\nline2')).toBe('"line1\r\nline2"')
  })
})

describe('ticketsToCsv', () => {
  it('emits a header row even for an empty ticket list', () => {
    const csv = ticketsToCsv([])
    expect(csv).toBe(TICKET_CSV_COLUMNS.join(','))
  })

  it('emits one row per ticket with all configured columns', () => {
    const csv = ticketsToCsv([
      t({
        id: 'TKT-1',
        title: 'simple',
        status: 'Open',
        priority: 'Normal',
        tags: ['fast', 'noisy'],
      }),
    ])
    const lines = csv.split('\n')
    expect(lines).toHaveLength(2)
    expect(lines[0]).toBe(TICKET_CSV_COLUMNS.join(','))
    // tags are pipe-joined to avoid the comma delimiter
    expect(lines[1]).toContain('fast|noisy')
    expect(lines[1].startsWith('TKT-1,simple,Open,Normal,')).toBe(true)
  })

  it('escapes values with commas, newlines, and quotes', () => {
    const csv = ticketsToCsv([
      t({
        id: 'TKT-2',
        title: 'broken, "really" bad\nticket',
        tags: [],
      }),
    ])
    const lines = csv.split('\n')
    // The escaped title includes the embedded newline so the row count
    // grows beyond 2 — assert directly on the substring instead.
    expect(csv).toContain('"broken, ""really"" bad\nticket"')
    expect(lines[0]).toBe(TICKET_CSV_COLUMNS.join(','))
  })

  it('serializes null/undefined values as empty strings', () => {
    const csv = ticketsToCsv([
      t({
        id: 'TKT-3',
        resolvedAt: null,
        rootCauseTag: null,
      }),
    ])
    const dataLine = csv.split('\n')[1]
    // Empty cell between two commas means null was rendered correctly.
    expect(dataLine).toMatch(/,,/)
  })
})
