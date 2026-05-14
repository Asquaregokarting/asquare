# Tickets Phase 8 — Knowledge Base, Canned Responses & @Mentions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development.

**Goal:** The final overhaul phase — admin-managed KB + canned responses, "/" menu in comment composer, `@mention` parsing in comments (populates watcherIds + fires Phase-5 mention notifications), customer-side rate limit (5/24h), and customer Help-page FAQ section consuming KB articles.

---

## File structure

| File                                                              | Status | Responsibility                                                                      |
| ----------------------------------------------------------------- | ------ | ----------------------------------------------------------------------------------- |
| `src/pipeline/api/types.ts`                                       | Modify | Add `TicketKbArticle`, `TicketCannedResponse`.                                      |
| `src/pipeline/api/ticket-kb-firestore.ts`                         | Create | CRUD for KB articles + customer-visible filter.                                     |
| `src/pipeline/api/ticket-kb.ts`                                   | Create | Barrel.                                                                             |
| `src/pipeline/api/ticket-canned-firestore.ts`                     | Create | CRUD for canned responses.                                                          |
| `src/pipeline/api/ticket-canned.ts`                               | Create | Barrel.                                                                             |
| `src/pipeline/api/ticket-mentions.ts`                             | Create | Pure `extractMentions(body, knownUsers)` helper + tests.                            |
| `src/pipeline/api/ticket-rate-limit.ts`                           | Create | Pure rate-limit checker; consumed by createTicket.                                  |
| `src/pipeline/pages/modules/settings/TicketKbSettings.tsx`        | Create | Admin UI for KB articles.                                                           |
| `src/pipeline/pages/modules/settings/TicketCannedSettings.tsx`    | Create | Admin UI for canned responses.                                                      |
| `src/pipeline/pages/modules/SettingsModule.tsx`                   | Modify | Two new view values.                                                                |
| `src/pipeline/app/router.tsx`                                     | Modify | Two new settings routes.                                                            |
| `src/pipeline/pages/modules/tickets/components/CommentThread.tsx` | Modify | "/" menu inserts canned response or KB article.                                     |
| `src/pipeline/api/tickets-firestore.ts`                           | Modify | createTicket enforces customer rate limit.                                          |
| `src/pipeline/api/ticket-comments-firestore.ts`                   | Modify | addTicketComment extracts mentions, populates `mentions` field, syncs `watcherIds`. |
| `src/pages/Help.tsx`                                              | Modify | Render published KB articles in the FAQ section.                                    |
| `src/services/ticketCustomerService.ts`                           | Modify | Customer rate-limit enforcement.                                                    |

---

## Task 1: KB + Canned types

`src/pipeline/api/types.ts` — append:

```ts
// ── Ticket KB & canned responses ────────────────────────────────────────────

export type TicketKbVisibility = 'internal' | 'customer'

export interface TicketKbArticle {
  id: string
  title: string
  body: string // markdown
  tags: string[]
  visibility: TicketKbVisibility
  active: boolean
  sortOrder: number
  createdAt: string
  updatedAt: string
}

export interface CreateTicketKbArticlePayload {
  title: string
  body: string
  tags: string[]
  visibility: TicketKbVisibility
  active?: boolean
  sortOrder?: number
}

export interface TicketCannedResponse {
  id: string
  title: string
  body: string
  categoryIds: string[] // applies to which categories (empty = all)
  active: boolean
  sortOrder: number
  createdAt: string
  updatedAt: string
}

export interface CreateTicketCannedPayload {
  title: string
  body: string
  categoryIds: string[]
  active?: boolean
  sortOrder?: number
}
```

Commit `feat(tickets): add KB article and canned-response types`.

---

## Task 2: KB & canned firestore modules

`src/pipeline/api/ticket-kb-firestore.ts` — same shape as `ticket-categories-firestore.ts`. Collection: `pipeline-ticket-kb`. Functions: `subscribeToTicketKbArticles(filters?, onData, onError)`, `upsertKbArticle(id, payload)`, `setKbArticleActive(id, active)`, `getCustomerKbArticles()` (one-shot for the customer Help page).

`src/pipeline/api/ticket-canned-firestore.ts` — same shape. Collection: `pipeline-ticket-canned-responses`. Functions: `subscribeToCannedResponses(onData, onError)`, `upsertCannedResponse(id, payload)`, `setCannedResponseActive(id, active)`.

Both expose `mapXForTest` for testing with simple defaults+preserve cases.

Commit `feat(tickets): add KB and canned-response firestore modules with tests`.

---

## Task 3: `extractMentions` pure helper

`src/pipeline/api/ticket-mentions.ts`:

```ts
export interface KnownUser {
  id: string
  name: string
  handle?: string // optional explicit @handle; if absent, derive from name
}

export interface MentionMatch {
  userId: string
  rawText: string // the literal text in the body, e.g. "@alice"
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
    const user = users.find((u) => {
      const candidate = normalizeHandle(u.handle ?? u.name)
      return candidate === handle || candidate.startsWith(handle)
    })
    if (!user) continue
    if (seen.has(user.id)) continue
    seen.add(user.id)
    matches.push({ userId: user.id, rawText: m[0], startIndex: m.index })
  }
  return matches
}
```

Tests (5 cases):

- No mentions → empty array.
- One unique mention → matches.
- Duplicate mentions → unique only.
- Mention with no matching user → skipped.
- Mention by handle → matches.

Commit `feat(tickets): add pure @mention extraction helper`.

---

## Task 4: Customer rate-limit helper

`src/pipeline/api/ticket-rate-limit.ts`:

```ts
import { collection, getCountFromServer, query, where, Timestamp } from 'firebase/firestore'
import { getAsquareFirestore } from './asquare-firestore'

export const CUSTOMER_RATE_LIMIT_PER_24H = 5

export async function customerTicketCountInLast24h(userId: string): Promise<number> {
  const since = new Date()
  since.setHours(since.getHours() - 24)
  const q = query(
    collection(getAsquareFirestore(), 'pipeline-tickets'),
    where('raisedBy', '==', userId),
    where('raisedByKind', '==', 'customer'),
    where('createdAt', '>=', Timestamp.fromDate(since)),
  )
  const snap = await getCountFromServer(q)
  return snap.data().count
}

export class CustomerRateLimitError extends Error {
  constructor(public count: number) {
    super(`rate limit reached (${count}/${CUSTOMER_RATE_LIMIT_PER_24H} in last 24h)`)
    this.name = 'CustomerRateLimitError'
  }
}

export async function assertCustomerUnderRateLimit(userId: string): Promise<void> {
  const count = await customerTicketCountInLast24h(userId)
  if (count >= CUSTOMER_RATE_LIMIT_PER_24H) {
    throw new CustomerRateLimitError(count)
  }
}
```

Wire into `src/services/ticketCustomerService.ts`'s `createTicket`: call `assertCustomerUnderRateLimit(input.userId)` before validation.

`src/services/ticketCustomerService.test.ts` — add a test that mocks `assertCustomerUnderRateLimit` to throw, asserts the error bubbles.

Commit `feat(tickets): enforce 5-per-24h customer ticket rate limit`.

---

## Task 5: Mention extraction in addTicketComment

`src/pipeline/api/ticket-comments-firestore.ts` — modify `addTicketComment`:

After computing `mentions`, also patch the parent ticket's `watcherIds` to include the mentioned user ids (use `arrayUnion`).

The caller passes `body` and a list of known users (the implementer of the comment composer will fetch them via existing user listing). Keep the caller responsible for resolving mention text → user ids:

Change the API to accept `mentions: string[]` (already does) and `bodyMentionTextToIds?: never` — keep it simple: caller does extraction.

The CommentThread composer (modify in Task 7) will:

1. On submit, fetch `listFirestoreUsers({ status: 'Active' })` (or use a cached list).
2. Call `extractMentions(body, users)`.
3. Pass `mentions: matches.map(m => m.userId)` to `addTicketComment`.

Inside `addTicketComment`, after the `addDoc`, patch the ticket:

```ts
if (payload.mentions && payload.mentions.length > 0) {
  const ticketRef = doc(getAsquareFirestore(), 'pipeline-tickets', payload.ticketId)
  await updateDoc(ticketRef, {
    watcherIds: arrayUnion(...payload.mentions),
    updatedAt: serverTimestamp(),
  })
}
```

(The Phase 5 onTicketCommentCreate trigger already turns mentions into notifications.)

Commit `feat(tickets): sync mentioned users into watcherIds on comment`.

---

## Task 6: Settings UIs for KB + canned

Two small components:

`src/pipeline/pages/modules/settings/TicketKbSettings.tsx` — Owner/Admin only. Table of articles + add/edit modal. Fields: title, body (textarea, plain text/markdown), tags (comma-separated), visibility (`internal | customer`), active toggle, sort order.

`src/pipeline/pages/modules/settings/TicketCannedSettings.tsx` — Owner/Admin only. Table + add/edit modal. Fields: title, body, categoryIds (comma-separated, validated against active categories), active, sort order.

Modify `SettingsModule.tsx` to add two new view values: `'tickets-kb'` and `'tickets-canned'`. Add subnav entries.

Modify `router.tsx`:

```tsx
<Route path="/settings/tickets/kb" element={<ProtectedRoute><SettingsModule view="tickets-kb" /></ProtectedRoute>} />
<Route path="/settings/tickets/canned" element={<ProtectedRoute><SettingsModule view="tickets-canned" /></ProtectedRoute>} />
```

Commit `feat(tickets): add KB and canned-response Settings UIs`.

---

## Task 7: "/" menu in CommentThread + mention extraction

Modify `src/pipeline/pages/modules/tickets/components/CommentThread.tsx`:

1. On mount, subscribe to `subscribeToCannedResponses` and `subscribeToTicketKbArticles({ visibility: 'internal' })`.
2. Subscribe to active users for mention resolution: keep a small cached list via `listFirestoreUsers({ status: 'Active' })` called once on mount.
3. When the user types `/` at the start of a word in the textarea, open a dropdown listing matching canned responses + KB article titles (filterable by what they type after `/`). Select inserts the body at the cursor position.
4. On submit:
   - `mentions = extractMentions(body, users).map(m => m.userId)`
   - Call `addTicketComment({ ticketId, authorId, authorName, authorKind: 'staff', body, internal, mentions })`.

Use a controlled textarea + `<ul>` popup positioned absolutely. Keep it simple — no autocomplete library.

Commit `feat(tickets): add "/" menu and mention extraction to comment composer`.

---

## Task 8: Customer Help FAQ from KB

Modify `src/pages/Help.tsx`:

1. Replace the placeholder FAQ section with a list of `customer`-visibility KB articles via `getCustomerKbArticles()` (one-shot read on mount).
2. Each article: title (collapsible) + body rendered as plain text (or whitespace-pre-wrap for now; markdown rendering is a future polish).

Commit `feat(customer): render KB articles on Help page`.

---

## Verify

```bash
npx vitest run src/pipeline/api/ src/pipeline/pages/modules/tickets/ src/services/ticketCustomerService.test.ts
npx tsc -p tsconfig.app.json --noEmit | grep -i ticket
```

Both clean. Total ticket tests should be ~225+ (+10 new across KB, canned, mentions, rate-limit).

---

## Spec coverage

| Spec item                                                                       | Task       |
| ------------------------------------------------------------------------------- | ---------- |
| Admin-managed canned responses                                                  | 1, 2, 6, 7 |
| Admin-managed KB articles                                                       | 1, 2, 6    |
| Inline insertion via "/" menu                                                   | 7          |
| `@mentions` ping (in-app + WhatsApp via existing onTicketCommentCreate trigger) | 3, 5, 7    |
| 5-per-24h customer rate limit                                                   | 4          |
| Customer FAQ from KB                                                            | 8          |

After this, the entire 8-phase spec is shipped (modulo the explicit deferrals in Phase 5: web push, SMS fallback).
