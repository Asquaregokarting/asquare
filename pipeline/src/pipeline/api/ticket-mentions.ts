/**
 * Pure helper for extracting `@mentions` from a comment body and resolving
 * them to known users. Used by the staff comment composer to turn free-form
 * mentions into a `mentions: string[]` array of user ids — the existing
 * Phase-5 onTicketCommentCreate trigger turns those into notifications.
 */

export interface KnownUser {
  id: string
  name: string
  /** Optional explicit @handle; if absent, derived from name. */
  handle?: string
}

export interface MentionMatch {
  userId: string
  /** The literal text in the body, e.g. "@alice". */
  rawText: string
  startIndex: number
}

function normalizeHandle(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9_]/g, '')
}

export function extractMentions(body: string, users: ReadonlyArray<KnownUser>): MentionMatch[] {
  const re = /@([a-zA-Z0-9_]{2,})/g
  const matches: MentionMatch[] = []
  const seen = new Set<string>()

  for (let m = re.exec(body); m !== null; m = re.exec(body)) {
    const handle = normalizeHandle(m[1])
    if (!handle) continue
    const user = users.find((u) => {
      const candidate = normalizeHandle(u.handle ?? u.name)
      if (!candidate) return false
      return candidate === handle || candidate.startsWith(handle)
    })
    if (!user) continue
    if (seen.has(user.id)) continue
    seen.add(user.id)
    matches.push({ userId: user.id, rawText: m[0], startIndex: m.index })
  }
  return matches
}
