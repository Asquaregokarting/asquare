import type { LeadStatus, LeadSource, LeadScoreLabel, LeadSubStatus } from '../../api/types'
import { getBranchIdToDisplayNameMap } from '../../../lib/locations'

// ─── Branch Map (sourced from centralized registry) ─────────────
export const BRANCH_MAP: Record<string, string> = getBranchIdToDisplayNameMap()

// ─── Status Labels ───────────────────────────────────────────────
export const LEAD_STATUS_LABELS: Record<LeadStatus, string> = {
  new: 'New',
  contacted: 'Contacted',
  interested: 'Interested',
  follow_up_pending: 'Follow-up Pending',
  booked: 'Booked',
  closed: 'Closed',
  lost: 'Lost',
}

export const LEAD_SUB_STATUS_LABELS: Record<LeadSubStatus, string> = {
  no_answer: 'No Answer',
  callback_requested: 'Callback Requested',
  not_interested: 'Not Interested',
  wrong_number: 'Wrong Number',
  already_booked: 'Already Booked',
}

// ─── Source Labels ───────────────────────────────────────────────
export const LEAD_SOURCE_LABELS: Record<LeadSource, string> = {
  inquiry_whatsapp: 'WhatsApp Inquiry',
  inquiry_call: 'Phone Inquiry',
  inquiry_website: 'Website Inquiry',
  interakt: 'Interakt',
  abandoned_cart: 'Abandoned Cart',
  landing_page: 'Landing Page',
  exit_intent: 'Exit Intent',
  webhook: 'Webhook',
  manual: 'Manual',
  import: 'Excel Import',
}

// ─── Score Labels ────────────────────────────────────────────────
export const SCORE_LABEL_CONFIG: Record<
  LeadScoreLabel,
  { label: string; tone: string; color: string }
> = {
  hot: { label: 'Hot', tone: 'critical', color: 'border-critical/35 bg-critical/10 text-critical' },
  warm: { label: 'Warm', tone: 'warning', color: 'border-warning/35 bg-warning/10 text-warning' },
  cold: { label: 'Cold', tone: 'info', color: 'border-info/35 bg-info/10 text-info' },
}

// ─── Status Transitions ─────────────────────────────────────────
export const ALLOWED_TRANSITIONS: Record<LeadStatus, LeadStatus[]> = {
  new: ['contacted', 'lost'],
  contacted: ['interested', 'follow_up_pending', 'closed', 'lost'],
  interested: ['follow_up_pending', 'booked', 'closed', 'lost'],
  follow_up_pending: ['interested', 'booked', 'closed', 'lost'],
  booked: ['closed'],
  closed: [],
  lost: ['new'], // admin reopen only
}

// ─── Kanban Column Order ─────────────────────────────────────────
export const KANBAN_COLUMNS: LeadStatus[] = [
  'new',
  'contacted',
  'interested',
  'follow_up_pending',
  'booked',
  'closed',
]

// ─── Default Automation Config ───────────────────────────────────
export const DEFAULT_AUTOMATION_CONFIG = {
  noAnswerWhatsappThreshold: 2,
  autoCloseInactiveDays: 30,
  abandonedCartHours: 24,
  autoScoreWeights: {
    recencyWeight: 40,
    frequencyWeight: 30,
    spendWeight: 20,
    channelWeight: 10,
  },
  scoreThresholds: {
    hotMin: 70,
    warmMin: 40,
  },
  enableAutoWhatsapp: true,
  enableAutoClose: false,
  enableAutoAssign: true,
  leadsPageSize: 250,
  freshLeadWindowSeconds: 60,
}

// ─── Leads Page Size ─────────────────────────────────────────────
// 250 fits ~one-and-a-half screens of kanban cards across the seven status
// columns. Pipeline view surfaces a "more leads match" banner when this
// ceiling is hit so truncation is never silent for an Owner audit.
export const LEADS_PAGE_SIZE = 250
