import { describe, it, expect } from 'vitest'
import { extractMentions, type KnownUser } from './ticket-mentions'

const USERS: KnownUser[] = [
  { id: 'u1', name: 'Alice Anderson' },
  { id: 'u2', name: 'Bob Brown', handle: 'bobby' },
  { id: 'u3', name: 'Charlie Chen' },
]

describe('extractMentions', () => {
  it('returns empty array when there are no @mentions', () => {
    expect(extractMentions('hello world, no mentions here', USERS)).toEqual([])
  })

  it('matches a single mention to the right user', () => {
    const matches = extractMentions('Hey @alice, please look at this', USERS)
    expect(matches).toHaveLength(1)
    expect(matches[0].userId).toBe('u1')
    expect(matches[0].rawText).toBe('@alice')
  })

  it('dedupes duplicate mentions to the same user', () => {
    const matches = extractMentions('@alice and again @alice and @alice', USERS)
    expect(matches).toHaveLength(1)
    expect(matches[0].userId).toBe('u1')
  })

  it('skips mentions that match no user', () => {
    const matches = extractMentions('cc @nobody and @alice', USERS)
    expect(matches.map((m) => m.userId)).toEqual(['u1'])
  })

  it('matches users by their explicit handle', () => {
    const matches = extractMentions('please verify @bobby', USERS)
    expect(matches).toHaveLength(1)
    expect(matches[0].userId).toBe('u2')
    expect(matches[0].rawText).toBe('@bobby')
  })
})
