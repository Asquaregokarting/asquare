/**
 * Interakt Events API — queries the 4 Interakt event collections from Firestore.
 *
 * Collections:
 *   interakt_customer_events  — button clicks, orders, completed flows
 *   interakt_account_alerts   — account quality, capability alerts
 *   interakt_template_alerts  — template status & performance
 *   interakt_payments         — WhatsApp Pay confirmations/failures
 */

import { collection, getDocs, orderBy, query, limit, type Timestamp } from 'firebase/firestore'
import { initializeFirestore } from '../lib/firebase'

const getFs = () => {
  const fs = initializeFirestore()
  if (!fs) throw new Error('Firestore not configured.')
  return fs
}

// ─── Types ──────────────────────────────────────────────────────────

export interface InteraktCustomerEvent {
  id: string
  eventType: string
  phone: string | null
  customerName: string
  buttonText: string | null
  replyText: string | null
  isCompletedFlow?: boolean
  orderData?: Record<string, unknown>
  totalAmount?: number
  itemCount?: number
  orderNumber: string | null
  createdAt: string
}

export interface InteraktAccountAlert {
  id: string
  eventType: string
  alertData: Record<string, unknown>
  createdAt: string
}

export interface InteraktTemplateAlert {
  id: string
  eventType: string
  templateName: string | null
  templateStatus: string | null
  templateData: Record<string, unknown>
  createdAt: string
}

export interface InteraktPayment {
  id: string
  eventType: string
  phone: string | null
  customerName: string
  paymentStatus: string
  isSuccess: boolean
  isFailed: boolean
  amount: number
  paymentId: string | null
  orderNumber: string | null
  createdAt: string
}

export interface InteraktMessageRequest {
  id: string
  type: string
  phoneNumber: string
  invoiceNo: string
  responseStatus: number
  responseBody: Record<string, unknown>
  requestedAt: string
}

export interface InteraktDashboardData {
  customerEvents: InteraktCustomerEvent[]
  accountAlerts: InteraktAccountAlert[]
  templateAlerts: InteraktTemplateAlert[]
  payments: InteraktPayment[]
  messageRequests: InteraktMessageRequest[]
}

// ─── Helpers ────────────────────────────────────────────────────────

const toIso = (val: unknown): string => {
  if (!val) return ''
  if (typeof val === 'string') return val
  if (typeof val === 'object' && val !== null && 'toDate' in val) {
    return (val as Timestamp).toDate().toISOString()
  }
  return String(val)
}

// ─── Queries ────────────────────────────────────────────────────────

export const listCustomerEvents = async (max = 100): Promise<InteraktCustomerEvent[]> => {
  const col = collection(getFs(), 'interakt_customer_events')
  const q = query(col, orderBy('createdAt', 'desc'), limit(max))
  const snap = await getDocs(q)
  return snap.docs.map((d) => {
    const data = d.data()
    return {
      id: d.id,
      eventType: String(data.eventType ?? ''),
      phone: data.phone ?? null,
      customerName: String(data.customerName ?? ''),
      buttonText: data.buttonText ?? null,
      replyText: data.replyText ?? null,
      isCompletedFlow: data.isCompletedFlow ?? false,
      orderData: data.orderData ?? undefined,
      totalAmount: data.totalAmount ?? undefined,
      itemCount: data.itemCount ?? undefined,
      orderNumber: data.orderNumber ?? null,
      createdAt: toIso(data.createdAt),
    }
  })
}

export const listAccountAlerts = async (max = 50): Promise<InteraktAccountAlert[]> => {
  const col = collection(getFs(), 'interakt_account_alerts')
  const q = query(col, orderBy('createdAt', 'desc'), limit(max))
  const snap = await getDocs(q)
  return snap.docs.map((d) => {
    const data = d.data()
    return {
      id: d.id,
      eventType: String(data.eventType ?? ''),
      alertData: (data.alertData as Record<string, unknown>) ?? {},
      createdAt: toIso(data.createdAt),
    }
  })
}

export const listTemplateAlerts = async (max = 50): Promise<InteraktTemplateAlert[]> => {
  const col = collection(getFs(), 'interakt_template_alerts')
  const q = query(col, orderBy('createdAt', 'desc'), limit(max))
  const snap = await getDocs(q)
  return snap.docs.map((d) => {
    const data = d.data()
    return {
      id: d.id,
      eventType: String(data.eventType ?? ''),
      templateName: data.templateName ?? null,
      templateStatus: data.templateStatus ?? null,
      templateData: (data.templateData as Record<string, unknown>) ?? {},
      createdAt: toIso(data.createdAt),
    }
  })
}

export const listPayments = async (max = 100): Promise<InteraktPayment[]> => {
  const col = collection(getFs(), 'interakt_payments')
  const q = query(col, orderBy('createdAt', 'desc'), limit(max))
  const snap = await getDocs(q)
  return snap.docs.map((d) => {
    const data = d.data()
    return {
      id: d.id,
      eventType: String(data.eventType ?? ''),
      phone: data.phone ?? null,
      customerName: String(data.customerName ?? ''),
      paymentStatus: String(data.paymentStatus ?? ''),
      isSuccess: data.isSuccess ?? false,
      isFailed: data.isFailed ?? false,
      amount: Number(data.amount ?? 0),
      paymentId: data.paymentId ?? null,
      orderNumber: data.orderNumber ?? null,
      createdAt: toIso(data.createdAt),
    }
  })
}

export const listMessageRequests = async (max = 100): Promise<InteraktMessageRequest[]> => {
  const col = collection(getFs(), 'interakt_message_requests')
  const q = query(col, orderBy('requestedAt', 'desc'), limit(max))
  const snap = await getDocs(q)
  // Writers (booking-confirmation vs notifications vs razorpay vs invoice-cron)
  // disagree on field names; accept the documented aliases so the UI does not
  // render blanks for real data.
  return snap.docs.map((d) => {
    const data = d.data()
    const payload = (data.requestPayload as Record<string, unknown> | undefined) ?? {}
    const payloadPhone = typeof payload.phoneNumber === 'string' ? payload.phoneNumber : ''
    return {
      id: d.id,
      type: String(data.type ?? data.templateName ?? ''),
      phoneNumber: String(data.phoneNumber ?? payloadPhone ?? ''),
      invoiceNo: String(data.invoiceNo ?? data.orderNumber ?? data.vendorId ?? ''),
      responseStatus: Number(data.responseStatus ?? 0),
      responseBody: (data.responseBody as Record<string, unknown>) ?? {},
      requestedAt: toIso(data.requestedAt),
    }
  })
}

export const loadInteraktDashboard = async (): Promise<InteraktDashboardData> => {
  const [customerEvents, accountAlerts, templateAlerts, payments, messageRequests] =
    await Promise.all([
      listCustomerEvents(),
      listAccountAlerts(),
      listTemplateAlerts(),
      listPayments(),
      listMessageRequests(),
    ])
  return { customerEvents, accountAlerts, templateAlerts, payments, messageRequests }
}
