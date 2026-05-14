# Tickets Overhaul — Design Spec

**Date:** 2026-04-27
**Status:** Approved (brainstorming complete; pending implementation plan)
**Owner:** Pipeline Admin team
**Replaces:** Current minimal `RaiseTicketModal` + `TicketsView` (in `ReportsModule`)

---

## 1. Goal

Upgrade the Raise Ticket / Issues feature from a 3-field form into a full helpdesk-grade ticketing platform serving **both** pipeline staff and customers. Add category-based routing, custom SLAs per category, multi-channel notifications, rich capture (images/voice/video), full resolution workspace, and analytics — without losing the existing speed-of-capture for staff. No AI / LLM features in scope.

## 2. Non-goals

- CSAT survey loop (deferred — answered "no" during brainstorming).
- AI / LLM features of any kind — no auto-reply, no category/priority classification, no transcription, no smart anything. Pure rules + keyword matching only.
- Migrating away from Firestore for tickets.
- Replacing Interakt as the WhatsApp provider.
- Building a public-internet status page.

## 3. Current state

| Area          | Today                                                                                           |
| ------------- | ----------------------------------------------------------------------------------------------- |
| Trigger       | `RaiseTicketButton` in topbar + sidebar (all pipeline users)                                    |
| Form          | Role + Location + Issue (≥10 chars)                                                             |
| Storage       | `asquare-app-db/pipeline-tickets`, status `Open`, auto-assigned to first active Developer       |
| Viewing       | `TicketsView` inside `ReportsModule.tsx`, gated to Owner/Developer; filter by status + location |
| Notifications | None                                                                                            |
| Customer side | None                                                                                            |

References:

- `src/pipeline/components/tickets/RaiseTicketButton.tsx`
- `src/pipeline/components/tickets/RaiseTicketModal.tsx`
- `src/pipeline/api/tickets-firestore.ts`, `src/pipeline/api/tickets.ts`
- `src/pipeline/pages/modules/ReportsModule.tsx` (TicketsView around L1817)
- `src/pipeline/api/types.ts` L1870–L1897 (Ticket types)

## 4. Target experience

### 4.1 Customer-facing entry points

1. **Booking-specific** — "Report an issue" button on `BookingDetails.tsx`, prefilled with booking link.
2. **General help** — Bottom-nav "Help" entry routing to `src/pages/Help.tsx`.
3. **Free-form** — Inside Help: "Raise a ticket" with optional booking picker.

Customers see status updates live in their profile; comment thread mirrors what staff post (internal notes hidden).

### 4.2 Pipeline-staff entry points

- Existing `RaiseTicketButton` (topbar + sidebar) keeps single-click capture.
- New top-level **Tickets module** in sidebar — replaces the embedded `TicketsView` in `ReportsModule`.
- Role-gated views: Owner/Admin (all), Incharge (their branch), Cashier/Telecaller/TrackMarshall/Editor/Developer/Backend (their assigned + raised + mentioned).

## 5. Capture (Rich)

Modal upgrade. Fields:

- **Category** (required) — drives routing and SLA. Drop-down values configured in Settings (defaults below).
- **Priority** — defaults to category's priority floor; overridable by the raiser.
- **Title** (≤120 chars) + **Description** (markdown, no HTML).
- **Related entity** picker — booking / kart / customer / payment (optional, multi-select).
- **Attachments** — up to 5 images, one ≤30s voice note (recorded clip, no transcription), one short video ≤10MB. Stored in Firebase Storage under `tickets/{ticketId}/`. Auto-compresses images on upload.
- **Auto-context** (silently captured) — current URL, user agent, last-error from `logger`, branch context, app version, build SHA.
- **Duplicate detection** — when the user clicks Submit, query last 7 days at the same branch + category and surface up to 3 similar tickets via title/description keyword overlap ("3 similar tickets at Vizag in the last 7 days — view?"). User can attach to existing instead of creating new.

## 6. Routing & SLA

### 6.1 Default category config

| Category              | Priority floor | Response SLA | Resolve SLA | Routing chain                            |
| --------------------- | -------------- | ------------ | ----------- | ---------------------------------------- |
| Track / Safety        | Critical       | 15 min       | 2 hr        | TrackMarshall → Incharge → Admin → Owner |
| Billing / Refund      | High           | 1 hr         | 8 hr        | Cashier → Incharge → Admin               |
| Booking change        | Normal         | 2 hr         | 24 hr       | Telecaller → Incharge                    |
| App bug / tech        | Normal         | 4 hr         | 3 days      | Developer → Backend                      |
| Feedback / suggestion | Low            | —            | 7 days      | Editor (no escalation)                   |
| Other                 | Normal         | 4 hr         | 24 hr       | Incharge → Admin                         |

These live in `pipeline-ticket-categories` (one doc per category) and are editable by Owner/Admin in Settings → Tickets.

### 6.2 Assignment

- Within the target role at the customer's (or raiser's) branch, assign **round-robin** among active users with that role.
- If no active user with that role at the branch, fall back to the next link in the chain.
- Cross-branch fallback only after the full chain at branch is exhausted (rare).

### 6.3 Escalation

- A scheduled Cloud Function (`slaWatcher`, every 5 min) inspects open tickets.
- Response breach: reassign one level up the chain, log activity, notify (in-app + WhatsApp).
- Resolve breach: same, plus mark `escalationLevel++`.
- Top-of-chain breaches notify Owner via WhatsApp + email immediately.

## 7. Resolution workspace

### 7.1 Surfaces

- **Modal** — default open from list (fast triage).
- **Full route** — `/pipeline/tickets/:id` with shareable URL. "Open full page" button on the modal.

### 7.2 Tabs / panels

1. **Details** — title, description, attachments, raiser, assignee, branch, category, priority, tags.
2. **Comments** — threaded, with internal-note toggle (hidden from customer). Supports `@mentions` → in-app + WhatsApp ping. Insert canned response / KB article via "/" menu.
3. **Activity log** — every status change, reassignment, comment, SLA event, edit.
4. **Linked entities** — booking / kart / customer / payment cards (auto-populated, click to open in respective module).
5. **Resolution form** — required when moving to Resolved: resolution note + root-cause tag (drop-down maintained in Settings).

### 7.3 Actions

- Status transitions enforce a legal-state machine:
  - `Open → In Progress → Resolved → Closed`
  - `Resolved → Open` only via explicit Reopen flow with reason (customer can reopen within 48h of Resolved).
  - `Closed` is terminal; reopen creates a new linked ticket.
- **Merge duplicates** (Admin only) — sets `mergedInto` on source, redirects status, copies attachments + watchers.
- **Quick actions** — context-sensitive: refund this booking (calls existing billing flow), comp tires (calls walletService), void payment, send WhatsApp template.
- **Tags / labels** — admin-managed list in Settings; multi-select on tickets; filterable in list view.

## 8. Notifications (Full tier)

| Channel                                 | When                                                                            |
| --------------------------------------- | ------------------------------------------------------------------------------- |
| In-app toast + red badge on Tickets nav | New ticket assigned to me, new comment on my ticket, mentioned, escalated to me |
| Browser web push                        | Same as above (when tab not focused)                                            |
| Sound                                   | New Critical-tier ticket assigned to me                                         |
| WhatsApp (Interakt)                     | Assignment, escalation, customer-side status change                             |
| SMS fallback                            | If WhatsApp delivery fails (Interakt webhook reports failure) within 5 min      |
| Email — daily 9 AM IST                  | Per-branch open-ticket digest to Incharge                                       |
| Email — Sunday 8 PM IST                 | Owner weekly digest (PDF) covering all branches                                 |

Customer notifications respect their saved opt-in (re-use existing notification prefs from customer profile).

## 9. Analytics

All eight surfaces:

1. **Owner dashboard** — open count by branch, MTTR per branch, SLA breach rate, top 5 categories this week, ticket trend chart (30 days).
2. **Incharge dashboard** (per branch) — branch's open tickets, breaches today, team's MTTR, oldest unresolved.
3. **My Tickets** — assigned to me / raised by me / mentioned in (topbar entry, available to all logged-in pipeline users).
4. **Customer-facing tracker** — list in customer profile; per-ticket page shows live status, ETA from SLA, comment thread.
5. **Heatmap** — branch × category × hour-of-day matrix.
6. **Kart / asset failure report** — auto-aggregates Track/Safety tickets per kart serial; flags repeat offenders (>3 tickets/30 days).
7. **CSV export** — filtered list export for any role with reports access.
8. **Weekly auto-report** — PDF emailed Sunday 8 PM IST to Owner with metrics + WoW deltas.

## 10. Knowledge base + canned responses

- Admin-managed `pipeline-ticket-canned-responses` — title + body + categories it applies to.
- Admin-managed `pipeline-ticket-kb` — title + body (markdown) + tags + visibility (`internal` | `customer`).
- Inline insertion via "/" menu in comment box.

## 11. Data model

### 11.1 `pipeline-tickets` (extended)

```ts
interface Ticket {
  id: string // TKT-xxxxxxxx
  title: string // NEW
  description: string // renamed from `issue`
  categoryId: string // NEW
  priority: 'Low' | 'Normal' | 'High' | 'Critical' // NEW
  tags: string[] // NEW
  status: 'Open' | 'In Progress' | 'Resolved' | 'Closed'

  raisedBy: string
  raisedByName: string
  raisedByKind: 'staff' | 'customer' // NEW
  branchId: string // NEW (replaces ad-hoc `location`)
  branchDisplayName: string

  assigneeId: string // renamed
  assigneeRole: Role // renamed
  assigneeName: string
  watcherIds: string[] // NEW (mentions, escalation hops)

  attachments: TicketAttachment[] // NEW
  linkedEntities: TicketLinkedEntity[] // NEW: { type, id, label }
  autoContext: TicketAutoContext // NEW

  slaSnapshot: { responseSeconds: number | null; resolveSeconds: number } // captured at create
  responseDueAt: string | null // NEW
  resolveDueAt: string // NEW
  firstResponseAt: string | null // NEW
  resolvedAt: string | null // NEW
  resolutionNote: string | null // NEW
  rootCauseTag: string | null // NEW

  escalationLevel: number // NEW
  mergedInto: string | null // NEW
  reopenedFrom: string | null // NEW

  createdAt: string
  updatedAt: string
}
```

### 11.2 New collections

- `pipeline-ticket-comments` — `{ ticketId, authorId, authorName, authorKind, body, internal: boolean, mentions: string[], createdAt, updatedAt }`
- `pipeline-ticket-activity` — `{ ticketId, type, actorId, payload, createdAt }`
- `pipeline-ticket-categories` — config (Owner/Admin only writes); see §6.1
- `pipeline-ticket-canned-responses` — see §10
- `pipeline-ticket-kb` — see §10

All comments + activity are read-time loaded; not embedded on ticket doc to keep doc size bounded.

## 12. Cloud Functions

- `onTicketCreate` — duplicate scan, routing + assignment, write activity log, send notifications.
- `onTicketUpdate` — activity log diffing, notify on status/assignee/priority change.
- `onTicketCommentCreate` — notify watchers + mentions.
- `slaWatcher` (cron `*/5 * * * *`) — detect breaches, escalate, notify.
- `weeklyOwnerDigest` (cron `0 20 * * 0` IST) — render PDF, email.
- `dailyInchargeDigest` (cron `30 3 * * *` UTC = 9 AM IST) — per-branch email.

## 13. Routes & module structure

```
src/pipeline/pages/modules/tickets/
  TicketsModule.tsx              // list + filters
  TicketDetailRoute.tsx          // /pipeline/tickets/:id
  components/
    RaiseTicketModal.tsx         // upgraded
    TicketDetailModal.tsx
    TicketDetailContent.tsx      // shared between modal + route
    CommentThread.tsx
    ActivityLog.tsx
    LinkedEntitiesPanel.tsx
    ResolutionForm.tsx
    QuickActions.tsx
    DuplicateDetector.tsx
    AttachmentUploader.tsx
  hooks/
    useTicketSubscription.ts
    useTicketComments.ts
    useTicketActivity.ts

src/pipeline/api/
  tickets-firestore.ts            // expand
  ticket-comments-firestore.ts    // new
  ticket-activity-firestore.ts    // new
  ticket-categories-firestore.ts  // new
  ticket-canned-firestore.ts      // new
  ticket-kb-firestore.ts          // new

src/pages/
  Help.tsx                        // new — customer help hub
  HelpTicketDetail.tsx            // /help/tickets/:id

functions/src/tickets/
  onTicketCreate.ts
  onTicketUpdate.ts
  onTicketCommentCreate.ts
  slaWatcher.ts
  weeklyOwnerDigest.ts
  dailyInchargeDigest.ts
  routing.ts          // shared assignment logic
  notifications.ts    // shared notify dispatch
  duplicate-detection.ts
```

The current `TicketsView` inside `ReportsModule.tsx` is removed; `subscribeRecentTickets` usage in `RoleDashboardScene.tsx` is preserved (re-exported from `ticketsApi`).

## 14. Migration

- Existing tickets in `pipeline-tickets` are lightweight; migrate in place via one-shot script `scripts/migrate-tickets-2026-04.ts`:
  - Map `issue` → `description`, `issue.slice(0, 80)` → `title`.
  - Set `categoryId = 'other'`, `priority = 'Normal'`, `branchId = location`, `assigneeId = assignedToId`.
  - Compute `resolveDueAt` from `createdAt + 24h` (default Other SLA).
  - Empty `attachments`, `tags`, `linkedEntities`, `watcherIds`.
  - `raisedByKind = 'staff'`.
- Script is idempotent (skips already-migrated docs marked with `schemaVersion: 2`).

## 15. Build sequence (8 phases)

Each phase is shippable.

1. **Foundation** — Tickets module skeleton, types, migration script, move existing view, role-gated routes.
2. **Triage core** — categories config, priority field, routing + assignment logic, SLA snapshot at create.
3. **Rich capture** — attachments (image/voice/video), auto-context, duplicate detection.
4. **Resolution workspace** — modal + full route, comments, activity log, linked entities, resolution form, reopen, merge, quick actions, tags, `@mentions`, status workflow validation.
5. **Notifications** — in-app + push + sound + Interakt + SMS fallback + daily/weekly digests + `slaWatcher`.
6. **Customer-facing** — `Help.tsx`, BookingDetails entry, customer profile tracker, customer-side comments.
7. **Analytics** — Owner & Incharge dashboards, Heatmap, Kart failure report, CSV export, Sunday PDF.
8. **KB + canned responses** — admin Settings UI, "/" menu in comment box.

## 16. Risks & open questions

- **Notification fatigue** — Full tier is loud. Mitigate with: per-user prefs in profile (mute non-Critical, mute outside business hours).
- **Storage cost** — voice/video uploads. Mitigate with: 90-day retention on attachments for resolved tickets, hard caps per ticket.
- **Round-robin fairness** — track per-role last-assigned-at counter to avoid hot-spotting on the alphabetical first user.
- **Customer abuse** — rate-limit customer-raised tickets to 5 per 24h per phone number.
- **WhatsApp template approval** — Interakt requires approved templates for assignment / escalation / status-change pings; need to draft and submit before phase 5.

## 17. Testing strategy

- Unit (Vitest): routing logic, SLA calculation, duplicate detection, status state machine, migration script.
- Integration: Firebase emulator for Cloud Functions (`onTicketCreate`, `slaWatcher`, escalation chain).
- E2E (Playwright): customer raises ticket from BookingDetails → staff resolves → customer reopens → staff closes; cover Critical-tier sound + push.
- Coverage thresholds added in `vitest.config.ts` for new files (per project convention).

## 18. Rollout

- Phase 1–2 behind no flag (additive).
- Phase 3+ behind a `tickets.v2` flag in Settings, default off, enabled per branch.
- Owner-only rollout for the first week; full rollout after one week with no Critical bugs.
- Old `RaiseTicketModal` removed after the v2 flag is fully on for 14 days.
