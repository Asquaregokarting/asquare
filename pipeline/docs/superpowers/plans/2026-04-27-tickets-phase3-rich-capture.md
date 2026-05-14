# Tickets Phase 3 — Rich Capture Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development.

**Goal:** Upgrade `RaiseTicketModal` to capture images (≤5), a voice note (≤30s), a short video (≤10MB), auto-context (URL, UA, app version, build SHA, last logger error), and surface duplicate detection (similar tickets in last 7 days at same branch+category by keyword overlap).

**Architecture:**

- Attachments are uploaded to Firebase Storage under `tickets/<ticketId>/<attachment-id>.<ext>`. The ticket doc stores `TicketAttachment[]`.
- Auto-context is captured client-side at submit time and stored on the ticket doc as `autoContext`.
- Duplicate detection is a pure keyword-overlap function on title+description, with a Firestore query for recent tickets at the same branch/category.

---

## File structure

| File                                                     | Status | Responsibility                                                                                                                             |
| -------------------------------------------------------- | ------ | ------------------------------------------------------------------------------------------------------------------------------------------ |
| `src/pipeline/api/ticket-attachments.ts`                 | Create | Upload helpers: image (compress), voice (raw), video; return `TicketAttachment`.                                                           |
| `src/pipeline/api/ticket-attachments.test.ts`            | Create | Test the pure file-shape helpers (no real Firebase Storage; mock).                                                                         |
| `src/pipeline/api/ticket-duplicates.ts`                  | Create | `findDuplicateTickets(branchId, categoryId, title, description) → Ticket[]`.                                                               |
| `src/pipeline/api/ticket-duplicates.test.ts`             | Create | Pure keyword-overlap test.                                                                                                                 |
| `src/pipeline/api/ticket-auto-context.ts`                | Create | `captureAutoContext() → TicketAutoContext` (browser-side only).                                                                            |
| `src/pipeline/lib/logger.ts`                             | Modify | Optional: add `getLastError()` accessor (in-memory ring of last error).                                                                    |
| `src/pipeline/components/tickets/AttachmentUploader.tsx` | Create | UI for image/voice/video pickers with previews + size validation.                                                                          |
| `src/pipeline/components/tickets/RaiseTicketModal.tsx`   | Modify | Add attachments + duplicate check + auto-context.                                                                                          |
| `src/pipeline/api/types.ts`                              | Modify | `CreateTicketPayload` adds `attachments?: TicketAttachment[]`, `autoContext?: TicketAutoContext`, `linkedEntities?: TicketLinkedEntity[]`. |
| `src/pipeline/api/tickets-firestore.ts`                  | Modify | `createTicket` consumes the new optional fields.                                                                                           |

---

## Task 1: Pure duplicate-detection helper

**Files:** `src/pipeline/api/ticket-duplicates.ts`, `.test.ts`

```ts
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
```

Tests cover `tokenize` and `jaccardSimilarity` purity; the integration is covered by manual smoke later.

```ts
import { describe, it, expect } from 'vitest'
import { tokenize, jaccardSimilarity } from './ticket-duplicates'

describe('tokenize', () => {
  it('lowercases, strips punctuation, drops stopwords and short tokens', () => {
    expect(tokenize('The Card Reader is BROKEN at counter 2!')).toEqual([
      'card',
      'reader',
      'broken',
      'counter',
    ])
  })

  it('returns empty array for blank input', () => {
    expect(tokenize('   ')).toEqual([])
  })
})

describe('jaccardSimilarity', () => {
  it('is 1 for identical token sets', () => {
    expect(jaccardSimilarity(['a', 'b', 'c'], ['c', 'b', 'a'])).toBe(1)
  })

  it('is 0 for disjoint sets', () => {
    expect(jaccardSimilarity(['a', 'b'], ['c', 'd'])).toBe(0)
  })

  it('matches partial overlap', () => {
    expect(jaccardSimilarity(['a', 'b', 'c'], ['b', 'c', 'd'])).toBeCloseTo(2 / 4)
  })

  it('returns 0 for two empty sets', () => {
    expect(jaccardSimilarity([], [])).toBe(0)
  })
})
```

Commit `feat(tickets): add pure duplicate-detection primitives`.

---

## Task 2: Auto-context helper

**Files:** `src/pipeline/api/ticket-auto-context.ts`

```ts
import type { TicketAutoContext } from './types'

const APP_VERSION = (import.meta.env.VITE_APP_VERSION as string | undefined) ?? 'unknown'
const BUILD_SHA = (import.meta.env.VITE_BUILD_SHA as string | undefined) ?? 'unknown'

let lastError: { message: string; at: string } | null = null

export function recordLastError(message: string): void {
  lastError = { message, at: new Date().toISOString() }
}

export function captureAutoContext(): TicketAutoContext {
  const ctx: TicketAutoContext = {
    appVersion: APP_VERSION,
    buildSha: BUILD_SHA,
  }
  if (typeof window !== 'undefined') {
    ctx.url = window.location.href
    ctx.userAgent = window.navigator.userAgent
  }
  if (lastError) {
    ctx.lastErrorMessage = lastError.message
    ctx.lastErrorAt = lastError.at
  }
  return ctx
}
```

Hook the logger to call `recordLastError` for `error` level. In `src/lib/logger.ts`, find the `error` method. After its existing body, add:

```ts
import('../pipeline/api/ticket-auto-context')
  .then(({ recordLastError }) => {
    recordLastError(typeof message === 'string' ? message : String(message))
  })
  .catch(() => {
    /* dynamic import shouldn't fail; ignore if it does */
  })
```

(Dynamic import to avoid a circular static import.)

Test: `ticket-auto-context.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { captureAutoContext, recordLastError } from './ticket-auto-context'

describe('captureAutoContext', () => {
  it('always returns appVersion and buildSha', () => {
    const ctx = captureAutoContext()
    expect(typeof ctx.appVersion).toBe('string')
    expect(typeof ctx.buildSha).toBe('string')
  })

  it('includes lastErrorMessage when recordLastError was called', () => {
    recordLastError('boom')
    const ctx = captureAutoContext()
    expect(ctx.lastErrorMessage).toBe('boom')
    expect(typeof ctx.lastErrorAt).toBe('string')
  })
})
```

Commit `feat(tickets): capture auto-context (URL, UA, version, last error)`.

---

## Task 3: Attachment upload helpers

**Files:** `src/pipeline/api/ticket-attachments.ts`, `.test.ts`

```ts
import { ref, uploadBytes, getDownloadURL } from 'firebase/storage'
import { getStorage } from 'firebase/storage'
import { getApp } from 'firebase/app'
import type { TicketAttachment, TicketAttachmentKind } from './types'

const MAX_IMAGE_BYTES = 5 * 1024 * 1024
const MAX_VOICE_BYTES = 2 * 1024 * 1024
const MAX_VIDEO_BYTES = 10 * 1024 * 1024
const MAX_VOICE_SECONDS = 30

export class AttachmentValidationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'AttachmentValidationError'
  }
}

export function validateAttachment(file: File, kind: TicketAttachmentKind): void {
  if (kind === 'image' && !file.type.startsWith('image/')) {
    throw new AttachmentValidationError('File is not an image')
  }
  if (kind === 'voice' && !(file.type.startsWith('audio/') || file.type === 'video/webm')) {
    throw new AttachmentValidationError('File is not an audio recording')
  }
  if (kind === 'video' && !file.type.startsWith('video/')) {
    throw new AttachmentValidationError('File is not a video')
  }
  const max =
    kind === 'image' ? MAX_IMAGE_BYTES : kind === 'voice' ? MAX_VOICE_BYTES : MAX_VIDEO_BYTES
  if (file.size > max) {
    throw new AttachmentValidationError(
      `File too large (${(file.size / 1024 / 1024).toFixed(1)}MB)`,
    )
  }
}

export interface UploadOptions {
  ticketId: string
  kind: TicketAttachmentKind
  file: File
}

export async function uploadAttachment(opts: UploadOptions): Promise<TicketAttachment> {
  validateAttachment(opts.file, opts.kind)
  const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  const ext = opts.file.name.split('.').pop() || 'bin'
  const path = `tickets/${opts.ticketId}/${id}.${ext}`
  const storageRef = ref(getStorage(getApp()), path)
  await uploadBytes(storageRef, opts.file, { contentType: opts.file.type })
  const url = await getDownloadURL(storageRef)
  return {
    id,
    kind: opts.kind,
    storagePath: path,
    url,
    sizeBytes: opts.file.size,
    mimeType: opts.file.type,
    uploadedAt: new Date().toISOString(),
  }
}

export const ATTACHMENT_LIMITS = {
  maxImages: 5,
  maxImageBytes: MAX_IMAGE_BYTES,
  maxVoiceBytes: MAX_VOICE_BYTES,
  maxVideoBytes: MAX_VIDEO_BYTES,
  maxVoiceSeconds: MAX_VOICE_SECONDS,
} as const
```

Test (only the pure validation function — Storage operations are mocked):

```ts
import { describe, it, expect } from 'vitest'
import { validateAttachment, AttachmentValidationError } from './ticket-attachments'

const mockFile = (size: number, type: string, name = 'f.bin'): File => {
  const blob = new Blob([new Uint8Array(size)], { type })
  return new File([blob], name, { type })
}

describe('validateAttachment', () => {
  it('accepts a small image', () => {
    expect(() => validateAttachment(mockFile(1000, 'image/jpeg'), 'image')).not.toThrow()
  })
  it('rejects an oversize image', () => {
    expect(() => validateAttachment(mockFile(6 * 1024 * 1024, 'image/jpeg'), 'image')).toThrow(
      AttachmentValidationError,
    )
  })
  it('rejects a non-image when kind=image', () => {
    expect(() => validateAttachment(mockFile(100, 'application/pdf'), 'image')).toThrow(
      /not an image/,
    )
  })
  it('rejects an oversize video', () => {
    expect(() => validateAttachment(mockFile(11 * 1024 * 1024, 'video/mp4'), 'video')).toThrow(
      /too large/i,
    )
  })
  it('accepts webm voice', () => {
    expect(() => validateAttachment(mockFile(500_000, 'audio/webm'), 'voice')).not.toThrow()
  })
})
```

Commit `feat(tickets): add attachment validation + upload helpers`.

---

## Task 4: `AttachmentUploader.tsx`

**File:** `src/pipeline/components/tickets/AttachmentUploader.tsx`

A controlled component that takes `attachments: TicketAttachment[]` and `onChange(next: TicketAttachment[])`. Internal state tracks pending uploads (per-file progress). It uploads to Storage on file selection (using a temporary `ticketId = 'pending-<random>'` path; the file gets re-keyed under the real ticket id at submit time — for Phase 3, just use a stable per-modal pending id from `useRef`).

UI:

- Three buttons: "Add image" (input file), "Record voice" (uses `MediaRecorder` API for ≤30s clip), "Add video" (input file).
- Below the buttons: a chip per attachment with thumbnail (image) / play button (audio/video) / "Remove" link.
- Validation errors shown inline.

Voice recording: use `navigator.mediaDevices.getUserMedia({ audio: true })`, `MediaRecorder` with `audio/webm`, stop after 30s automatically.

Keep this component focused on UI; all uploads go through `uploadAttachment` from Task 3.

Commit `feat(tickets): add AttachmentUploader component (image/voice/video)`.

---

## Task 5: Integrate AttachmentUploader + auto-context + duplicates into RaiseTicketModal

**File:** `src/pipeline/components/tickets/RaiseTicketModal.tsx`

Add state:

- `attachments: TicketAttachment[]`
- `linkedEntities: TicketLinkedEntity[]` (booking picker is Phase-4 work; for Phase 3 just leave as `[]` — but the field gets passed through)
- `duplicates: DuplicateMatch[]`
- `dupesChecking: boolean`

Behavior:

- On `description` change (debounced 400ms), if `category` and `description` are non-empty, call `findDuplicateTickets({ branchId: location, categoryId: category.id, title: title || description.slice(0,80), description })` and set `duplicates`. If `duplicates.length > 0`, show a warning panel above the description with up to 3 entries (id, title, similarity %, "Open" link).
- On submit: capture `autoContext = captureAutoContext()` and pass `attachments`, `autoContext` to `createTicket`.
- Render the `<AttachmentUploader value={attachments} onChange={setAttachments} />` below the description.

Update `createTicket` (`tickets-firestore.ts`) to consume `payload.attachments`, `payload.autoContext`, `payload.linkedEntities` (default empty/`{}`).

Commit `feat(tickets): wire attachments, duplicates, auto-context into RaiseTicketModal`.

---

## Task 6: Verify

```bash
npx vitest run src/pipeline/api/ticket-duplicates.test.ts \
              src/pipeline/api/ticket-auto-context.test.ts \
              src/pipeline/api/ticket-attachments.test.ts \
              src/pipeline/api/tickets-firestore.test.ts
```

Type-check clean. Build clean.

Commit any small fixups, end of phase.

---

## Spec coverage check

| Spec item                                                           | Task |
| ------------------------------------------------------------------- | ---- |
| Up to 5 images                                                      | 3, 4 |
| ≤30s voice note (no transcription)                                  | 3, 4 |
| Short video ≤10MB                                                   | 3, 4 |
| Auto-context (URL, UA, app version, build SHA, last logger error)   | 2    |
| Duplicate detection (last 7 days, branch+category, keyword overlap) | 1, 5 |
