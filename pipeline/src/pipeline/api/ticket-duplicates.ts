import { collection, getDocs, limit, query, where, Timestamp } from 'firebase/firestore'
import { getAsquareFirestore } from './asquare-firestore'
import type { Ticket } from './types'
import { mapTicketForTest as mapTicket } from './tickets-firestore'

const STOPWORDS = new Set([
  'the',
  'a',
  'an',
  'is',
  'are',
  'was',
  'were',
  'i',
  'we',
  'you',
  'they',
  'to',
  'of',
  'in',
  'on',
  'at',
  'for',
  'with',
  'and',
  'or',
  'but',
  'that',
  'this',
  'it',
  'be',
  'been',
  'have',
  'has',
  'had',
  'will',
  'would',
  'could',
  'should',
  'can',
  'not',
])

export function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((t) => t.length > 2 && !STOPWORDS.has(t))
}

export function jaccardSimilarity(a: string[], b: string[]): number {
  if (a.length === 0 && b.length === 0) return 0
  const sa = new Set(a)
  const sb = new Set(b)
  let inter = 0
  for (const t of sa) if (sb.has(t)) inter += 1
  const union = sa.size + sb.size - inter
  return union === 0 ? 0 : inter / union
}

export interface DuplicateMatch {
  ticket: Ticket
  similarity: number
}

export interface DuplicateInputs {
  branchId: string
  categoryId: string
  title: string
  description: string
  windowDays?: number
  threshold?: number
  maxResults?: number
}

export async function findDuplicateTickets(input: DuplicateInputs): Promise<DuplicateMatch[]> {
  const windowDays = input.windowDays ?? 7
  const threshold = input.threshold ?? 0.25
  const maxResults = input.maxResults ?? 3

  const since = new Date()
  since.setDate(since.getDate() - windowDays)

  const ref = collection(getAsquareFirestore(), 'pipeline-tickets')
  const q = query(
    ref,
    where('branchId', '==', input.branchId),
    where('categoryId', '==', input.categoryId),
    where('createdAt', '>=', Timestamp.fromDate(since)),
    where('status', 'in', ['Open', 'In Progress']),
    limit(50),
  )
  const snap = await getDocs(q)
  const candidateTokens = tokenize(`${input.title} ${input.description}`)

  const matches: DuplicateMatch[] = []
  for (const docSnap of snap.docs) {
    const t = mapTicket(docSnap.id, docSnap.data() as Record<string, unknown>)
    const tokens = tokenize(`${t.title} ${t.description}`)
    const sim = jaccardSimilarity(candidateTokens, tokens)
    if (sim >= threshold) matches.push({ ticket: t, similarity: sim })
  }
  matches.sort((a, b) => b.similarity - a.similarity)
  return matches.slice(0, maxResults)
}
