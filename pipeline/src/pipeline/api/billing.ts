import { HelicopterActivityRecord, HelicopterPaymentRecord, TransactionRecord } from './types'
import {
  cancelFirestoreBillingTransaction,
  createFirestoreHelicopterActivity,
  createFirestoreHelicopterPayment,
  getFirestoreBillingInvoice,
  getFirestoreBillingTransactionById,
  listFirestoreBillingTransactions,
  listFirestoreHelicopterActivities,
  listFirestoreHelicopterPayments,
  queryTransactionsByPhone,
  rescheduleFirestoreBillingTransaction,
  updateFirestoreHelicopterActivity,
  updateFirestoreTransactionPaymentStatus,
} from './billing-firestore'
import { buildFirestoreRevenueReport } from './reports-firestore'
import { generateFirestoreWeeklyInvoices } from './accounting-firestore'
import { logger } from '../../lib/logger'

export const billingApi = {
  listTransactions(_token: string): Promise<{ transactions: TransactionRecord[] }> {
    return listFirestoreBillingTransactions().then((transactions) => ({ transactions }))
  },
  getTransaction(
    _token: string,
    transactionId: string,
  ): Promise<{ transaction: TransactionRecord }> {
    return getFirestoreBillingTransactionById(transactionId).then((transaction) => ({
      transaction,
    }))
  },
  getInvoice(_token: string, invoiceNumber: string): Promise<{ invoice: TransactionRecord }> {
    return getFirestoreBillingInvoice(invoiceNumber).then((invoice) => ({ invoice }))
  },
  async cancel(
    _token: string,
    payload: {
      transactionId: string
      reason: string
      cancelledBy: string
      cancelledByName: string
    },
  ): Promise<{ transaction: TransactionRecord }> {
    const transaction = await cancelFirestoreBillingTransaction(payload.transactionId, payload)
    try {
      await generateFirestoreWeeklyInvoices(new Date(transaction.transactionDate))
    } catch (err) {
      logger.error('billing.invoice_regen_failed_on_cancel', err, {
        transactionId: payload.transactionId,
      })
    }
    return { transaction }
  },
  reschedule(
    token: string,
    transactionId: string,
    newVisitDate: string,
  ): Promise<{ transaction: TransactionRecord }> {
    return rescheduleFirestoreBillingTransaction(token, transactionId, newVisitDate).then(
      (transaction) => ({ transaction }),
    )
  },
  revenueSummary(
    _token: string,
    query?: { from?: string; to?: string },
  ): Promise<{
    summary: {
      totalRevenue: number
      totalTransactions: number
      averageTransactionValue: number
      paymentMethodBreakdown: Record<string, number>
      refundsCount: number
      refundsValue: number
    }
  }> {
    return buildFirestoreRevenueReport(query).then((report) => ({
      summary: {
        totalRevenue: report.totalRevenue,
        totalTransactions: report.totalTransactions,
        averageTransactionValue: report.averageTransactionValue,
        paymentMethodBreakdown: report.paymentMethodBreakdown,
        refundsCount: report.refundsCount,
        refundsValue: report.refundsValue,
      },
    }))
  },
  async updateTransactionPaymentStatus(
    transactionId: string,
    updates: { paymentStatus: 'pending' | 'completed' | 'failed'; paymentReference?: string },
  ): Promise<void> {
    return updateFirestoreTransactionPaymentStatus(transactionId, updates)
  },
  listHelicopterActivities(
    _token: string,
    includeInactive = false,
  ): Promise<{ activities: HelicopterActivityRecord[] }> {
    return listFirestoreHelicopterActivities(includeInactive).then((activities) => ({ activities }))
  },
  createHelicopterActivity(
    _token: string,
    payload: { name: string; amount: number; status?: 'Active' | 'Inactive' },
  ): Promise<{ activity: HelicopterActivityRecord }> {
    return createFirestoreHelicopterActivity(payload).then((activity) => ({ activity }))
  },
  updateHelicopterActivity(
    _token: string,
    activityId: string,
    payload: Partial<{ name: string; amount: number; status: 'Active' | 'Inactive' }>,
  ): Promise<{ activity: HelicopterActivityRecord }> {
    return updateFirestoreHelicopterActivity(activityId, payload).then((activity) => ({ activity }))
  },
  listHelicopterPayments(
    _token: string,
    query?: { limit?: number; cursor?: string },
  ): Promise<{ payments: HelicopterPaymentRecord[]; nextCursor?: string }> {
    return listFirestoreHelicopterPayments({ limit: query?.limit }).then((payments) => ({
      payments,
    }))
  },
  sendHelicopterPayment(
    token: string,
    payload: {
      customerName: string
      phone: string
      activityId: string
      discountPercentage?: number
    },
  ): Promise<{ payment: HelicopterPaymentRecord }> {
    return createFirestoreHelicopterPayment(token, payload).then((payment) => ({ payment }))
  },

  /** Search recent refundable transactions by customer phone number. */
  searchTransactionsByPhone(_token: string, phone: string): Promise<TransactionRecord[]> {
    return queryTransactionsByPhone(phone)
  },

  // Refunds are not exposed via billingApi: they must go through the
  // approval queue in `./refund-approvals.ts`. `approveAndExecuteRefund`
  // is the only caller of `refundSelectedItems`/`creditCustomerWallet`.
}
