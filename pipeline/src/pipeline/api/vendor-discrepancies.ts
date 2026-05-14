/**
 * Vendor Discrepancies API facade — used by the AccountingModule
 * Discrepancies tab and the public report route.
 */

import {
  createDiscrepancy,
  CreateDiscrepancyInput,
  getDiscrepancyById,
  getDiscrepancyByReference,
  listDiscrepancies,
  markDiscrepancyNotified,
  markDiscrepancyResolved,
} from './vendor-discrepancies-firestore'
import type { VendorDiscrepancyRecord } from './types'

const SEND_NOTICE_URL =
  'https://asia-south1-a-square-6720c.cloudfunctions.net/sendVendorDiscrepancyNotice'

const reportUrlForReference = (reference: string): string => {
  const origin = typeof window !== 'undefined' && window.location ? window.location.origin : ''
  return `${origin}/r/disc/${encodeURIComponent(reference)}`
}

export const vendorDiscrepanciesApi = {
  list(): Promise<VendorDiscrepancyRecord[]> {
    return listDiscrepancies()
  },
  getByReference(reference: string): Promise<VendorDiscrepancyRecord | null> {
    return getDiscrepancyByReference(reference)
  },
  getById(id: string): Promise<VendorDiscrepancyRecord | null> {
    return getDiscrepancyById(id)
  },
  create(input: CreateDiscrepancyInput): Promise<VendorDiscrepancyRecord> {
    return createDiscrepancy(input)
  },
  markNotified(id: string): Promise<void> {
    return markDiscrepancyNotified(id)
  },
  markResolved(id: string, ledgerEntryId: string): Promise<void> {
    return markDiscrepancyResolved(id, ledgerEntryId)
  },

  /**
   * Send the WhatsApp notice to the vendor via the `vendor_discrepancy_notice`
   * Interakt template, then mark the discrepancy as `notified`. Caller
   * supplies the loaded record so we don't double-fetch.
   */
  async sendNotice(record: VendorDiscrepancyRecord): Promise<void> {
    if (!record.vendorPhone) {
      throw new Error('Vendor has no phone number on file — cannot notify.')
    }
    const reportUrl = reportUrlForReference(record.reference)
    const res = await fetch(SEND_NOTICE_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        vendorName: record.vendorName,
        branchName: record.branchDisplayName ?? record.branchId,
        gameName: record.gameLabel,
        bookingCount: record.affectedBookings.length,
        grossAmount: record.grossAmount,
        reference: record.reference,
        reportUrl,
        phoneNumber: record.vendorPhone,
      }),
    })
    if (!res.ok) {
      const body = await res.text().catch(() => '')
      throw new Error(`Interakt send failed (${res.status}): ${body || 'no body'}`)
    }
    await markDiscrepancyNotified(record.id)
  },
}
