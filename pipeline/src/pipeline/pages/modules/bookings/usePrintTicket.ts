import { useCallback, useState } from 'react'
import { AsquareBooking, asquareBookingsApi } from '../../../api/asquare-bookings'
import { reserveSerialsForItems } from '../../../api/serial-counters'
import { checkPrintCount, logPrint } from '../../../api/print-log'
import {
  requestReprintApproval,
  getApprovalForTransaction,
  completeReprint,
} from '../../../api/reprint-approvals'
import { printTransactionReceipt } from '../../../features/billing/generateBillingReceipt'
import { slugToBranchId } from '../../../../lib/locations'
import { formatDateInput } from './bookings-utils'

interface Actor {
  id: string
  name: string
  role: string
}

interface PrintState {
  printing: boolean
  reprintMessage: string | null
  reprintConfirm: {
    bookingId: string
    printCount: number
    resolve: (proceed: boolean) => void
  } | null
}

export const usePrintTicket = (actor: Actor) => {
  const [state, setState] = useState<PrintState>({
    printing: false,
    reprintMessage: null,
    reprintConfirm: null,
  })

  const clearReprintMessage = useCallback(() => {
    setState((s) => ({ ...s, reprintMessage: null }))
  }, [])

  const resolveReprintConfirm = useCallback((proceed: boolean) => {
    setState((s) => {
      s.reprintConfirm?.resolve(proceed)
      return { ...s, reprintConfirm: null }
    })
  }, [])

  const printTicket = useCallback(
    async (booking: AsquareBooking): Promise<{ success: boolean; message?: string }> => {
      if (booking.paymentStatus !== 'completed') {
        return { success: false, message: 'Cannot print ticket — payment is still pending.' }
      }

      setState((s) => ({ ...s, printing: true, reprintMessage: null }))

      try {
        const locationId = slugToBranchId(booking.locationId) ?? booking.locationId ?? ''
        const sessionDate = new Date(booking.sessionDate)
        const visitDate = isNaN(sessionDate.getTime()) ? undefined : formatDateInput(sessionDate)
        const txnDate = visitDate ?? formatDateInput(new Date())
        const couponCode = String((booking as Record<string, unknown>).couponCode ?? '')
        const couponDiscount = Number(
          (booking as Record<string, unknown>).couponAmount ?? booking.discountAmount ?? 0,
        )

        const gstPercent = 18
        const baseAmount = Math.round((booking.finalAmount / (1 + gstPercent / 100)) * 100) / 100
        const gstAmount = Math.round((booking.finalAmount - baseAmount) * 100) / 100

        type PrintableItem = {
          itemName: string
          quantity: number
          unitPrice: number
          gameId?: string
          subGameId?: string
          serialStart?: number
          printIndividualTokens?: boolean
        }

        // Event-package items collapse N internal games into one booking line
        // (the customer-side EventPage.tsx adds the whole package to the cart
        // as a single Activity with `__eventPackage.items` carrying the
        // breakdown). At print time we re-explode them so each internal game
        // gets its own token; otherwise a Combo with 6 games only prints 1
        // token. The package's own quantity multiplies each internal qty.
        const items: PrintableItem[] = (booking.items || []).flatMap((item) => {
          const itemRecord = item as unknown as Record<string, unknown>
          const activity = (item.activity as unknown as Record<string, unknown> | undefined) ?? {}
          const pkgAttachment = activity.__eventPackage as
            | {
                items?: Array<{
                  id?: string
                  name?: string
                  quantity?: number
                  price?: number
                  printIndividualTokens?: boolean
                }>
              }
            | undefined
          const pkgItems = Array.isArray(pkgAttachment?.items) ? pkgAttachment.items : null
          const bookingQty = Math.max(1, Number(item.quantity ?? 1))

          if (pkgItems && pkgItems.length > 0) {
            return pkgItems.map<PrintableItem>((pi) => ({
              itemName: String(pi.name ?? 'Activity'),
              quantity: bookingQty * Math.max(1, Number(pi.quantity ?? 1)),
              unitPrice: Number(pi.price ?? 0),
              printIndividualTokens: pi.printIndividualTokens === true ? true : undefined,
            }))
          }

          // Read printIndividualTokens at item top-level first (persisted by
          // unified-booking on creation); fall back to the activity-level
          // snapshot for older bookings written before that fix.
          const itemFlag =
            itemRecord.printIndividualTokens === true
              ? true
              : (activity as { printIndividualTokens?: boolean })?.printIndividualTokens === true
                ? true
                : undefined
          return [
            {
              itemName: item.activity?.name ?? 'Activity',
              quantity: bookingQty,
              unitPrice: Number(item.price ?? item.activity?.basePrice ?? 0) / bookingQty,
              gameId:
                (typeof itemRecord.gameId === 'string' && itemRecord.gameId) ||
                ((activity as { gameId?: string }).gameId ?? undefined),
              subGameId:
                (typeof itemRecord.subGameId === 'string' && itemRecord.subGameId) ||
                (item.activity?.id ?? undefined),
              printIndividualTokens: itemFlag,
            },
          ]
        })

        // Check if serials were already assigned
        const storedSerials = booking.printSerials as number[] | undefined
        if (storedSerials && storedSerials.length === items.length) {
          for (let i = 0; i < items.length; i++) {
            items[i].serialStart = storedSerials[i]
          }
        } else {
          try {
            const serialStarts = await reserveSerialsForItems(
              locationId,
              txnDate,
              items,
              booking.id,
            )
            for (let i = 0; i < items.length; i++) {
              items[i].serialStart = serialStarts[i]
            }
            await asquareBookingsApi.updateBooking(booking.id, booking.userId, {
              printSerials: serialStarts,
              printSerialDate: txnDate,
            } as Partial<AsquareBooking>)
          } catch {
            // Non-critical — print without serials if counter fails
          }
        }

        const txn = {
          id: booking.id,
          invoiceNumber: booking.id,
          customerName: booking.userDisplayName || 'Guest',
          customerPhone: booking.userPhone || '',
          totalAmount: booking.finalAmount,
          baseAmount,
          gstAmount,
          gstPercent,
          paymentMethod: ((): 'Cash' | 'Card' | 'UPI' | 'Razorpay' => {
            const m = String(booking.paymentMethod ?? '').toLowerCase()
            if (m === 'razorpay') return 'Razorpay'
            if (m === 'upi') return 'UPI'
            if (m === 'card') return 'Card'
            return 'Cash'
          })(),
          refundStatus: 'None' as const,
          transactionDate: booking.createdAt.toISOString(),
          visitDate,
          locationId,
          paymentStatus:
            booking.paymentStatus === 'completed' ? ('completed' as const) : ('pending' as const),
          source: 'Booking' as const,
          bookingId: booking.id,
          discount: booking.discountAmount,
          couponCode: couponCode || undefined,
          couponDiscount: couponDiscount || undefined,
          items,
        }

        const logEntry = {
          documentId: booking.id,
          source: 'booking' as const,
          printedBy: actor.id,
          printedByName: actor.name,
          printedByRole: actor.role,
          customerName: booking.userDisplayName || 'Guest',
          customerPhone: booking.userPhone,
          amount: booking.finalAmount,
          locationId,
        }

        // Reprint check
        try {
          const { isReprint, printCount } = await checkPrintCount(booking.id, 'booking')
          if (isReprint) {
            if (actor.role !== 'owner') {
              const existing = await getApprovalForTransaction(booking.id, actor.id)
              if (existing) {
                if (existing.status === 'approved') {
                  await logPrint(logEntry)
                  await printTransactionReceipt(txn)
                  await completeReprint(existing.id)
                  return { success: true }
                }
                setState((s) => ({
                  ...s,
                  reprintMessage:
                    'A reprint request is already pending for this ticket. Please wait for Owner approval.',
                }))
                return { success: false, message: 'Reprint pending approval.' }
              }
              try {
                await requestReprintApproval({
                  transactionId: booking.id,
                  invoiceNumber: booking.id,
                  customerName: booking.userDisplayName || 'Guest',
                  customerPhone: booking.userPhone,
                  amount: booking.finalAmount,
                  locationId,
                  requestedBy: actor.id,
                  requestedByName: actor.name,
                  requestedByRole: actor.role,
                })
                const msg = `This ticket has already been printed ${printCount} time(s). A reprint request has been sent to the Owner for approval.`
                setState((s) => ({ ...s, reprintMessage: msg }))
                return { success: false, message: msg }
              } catch (err) {
                const msg = err instanceof Error ? err.message : 'Failed to send reprint request.'
                return { success: false, message: msg }
              }
            }
            // Owner: ask for confirmation via state
            const proceed = await new Promise<boolean>((resolve) => {
              setState((s) => ({
                ...s,
                reprintConfirm: { bookingId: booking.id, printCount, resolve },
              }))
            })
            if (!proceed) return { success: false, message: 'Reprint cancelled.' }
          }
        } catch {
          // Non-critical — don't block first-time printing
        }

        await printTransactionReceipt(txn)
        try {
          await logPrint(logEntry)
        } catch {
          /* non-critical */
        }

        return { success: true }
      } finally {
        setState((s) => ({ ...s, printing: false }))
      }
    },
    [actor],
  )

  return {
    printTicket,
    printing: state.printing,
    reprintMessage: state.reprintMessage,
    clearReprintMessage,
    reprintConfirm: state.reprintConfirm,
    resolveReprintConfirm,
  }
}
