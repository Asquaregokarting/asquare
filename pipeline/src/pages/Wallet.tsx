import { useState, useEffect } from 'react'
import SEO from '../components/SEO'
import { motion, AnimatePresence } from 'framer-motion'
import {
  Wallet as WalletIcon,
  Plus,
  Clock,
  Sparkles,
  Trophy,
  Disc,
  ArrowUpRight,
  ArrowDownLeft,
  X,
  AlertTriangle,
} from 'lucide-react'
import { formatCurrency, getErrorMessage } from '../lib/utils'
import { fmtDateTimeFullIST } from '../lib/date-format'
import { useGames } from '../contexts/GamesContext'
import { useAuth } from '../contexts/AuthContext'
import { walletService, type Transaction } from '../services/walletService'
import { logger } from '../lib/logger'

const quickAmounts = [500, 1000, 2500, 5000]

export default function Wallet() {
  const { user } = useAuth()
  const { tires } = useGames()
  const [showTopUp, setShowTopUp] = useState(false)
  const [showHistoryModal, setShowHistoryModal] = useState(false)
  const [topUpAmount, setTopUpAmount] = useState<number>(0)
  const [processing, setProcessing] = useState(false)
  const [history, setHistory] = useState<Transaction[]>([])
  const [loadingHistory, setLoadingHistory] = useState(false)
  const [historyError, setHistoryError] = useState(false)
  const [statusMessage, setStatusMessage] = useState<{
    text: string
    type: 'success' | 'error'
  } | null>(null)

  const walletBalance = user?.walletBalance || 0

  const loadHistory = async (uid: string) => {
    setLoadingHistory(true)
    try {
      const [walletHistory, tireHistory] = await Promise.all([
        walletService.getWalletHistory(uid),
        walletService.getTireHistory(uid),
      ])

      const combined = [...walletHistory, ...tireHistory].sort((a, b) => {
        const timeA = a.timestamp?.seconds || 0
        const timeB = b.timestamp?.seconds || 0
        return timeB - timeA
      })

      setHistory(combined)
      setHistoryError(false)
    } catch (err) {
      logger.error('wallet.history_fetch_failed', err)
      setHistoryError(true)
    } finally {
      setLoadingHistory(false)
    }
  }

  // Fetch history on mount + when user changes. We deliberately do NOT
  // include showTopUp / showHistoryModal — the topup success path triggers
  // its own targeted refetch, and toggling the history modal shouldn't
  // re-pay for two collection scans on every open/close.
  useEffect(() => {
    if (!user?.id) return
    loadHistory(user.id)
  }, [user?.id])

  // Build a stable, unique orderNumber for topups. `Date.now()` alone
  // collides on multi-device same-millisecond requests, which the Cloud
  // Function rejects as a duplicate Razorpay receipt.
  const generateTopupOrderNumber = (): string =>
    `TOPUP-${Date.now()}-${Math.random().toString(36).slice(2, 8).toUpperCase()}`

  const handleTopUp = async () => {
    if (!user || topUpAmount < 50) return
    setProcessing(true)
    try {
      const { razorpayService } = await import('../services/razorpayService')
      const { createRazorpayOrder } = await import('../services/bookingService')

      const orderNumber = generateTopupOrderNumber()

      // Create Razorpay order via Cloud Function. The function recognizes
      // the TOPUP- prefix and skips the booking-amount check (it has its
      // own ₹50–₹1,00,000 cap for topups).
      const razorpayOrderId = await createRazorpayOrder({
        amount: topUpAmount,
        orderNumber,
        customerName: user.displayName || 'Customer',
        customerPhone: user.phone || '',
        customerEmail: user.email || '',
      })

      const paymentResponse = await razorpayService.initiatePayment({
        amount: topUpAmount * 100,
        razorpay_order_id: razorpayOrderId,
        name: user.displayName || 'Customer',
        email: user.email || 'customer@asquare.com',
        phone: user.phone || '',
        description: `Wallet Top-up ₹${topUpAmount}`,
      })

      // Razorpay payment_id is the natural idempotency key — guarantees a
      // retry of this credit (browser back, network blip, manual reload)
      // can never double-credit the wallet.
      const credited = await walletService.addBalance(
        user.id,
        topUpAmount,
        `Top-up via ${paymentResponse.razorpay_payment_id}`,
        paymentResponse.razorpay_payment_id,
      )

      if (!credited) {
        // The Razorpay charge succeeded but the wallet credit didn't land.
        // Surface the payment_id so support can reconcile manually rather
        // than letting the user think their topup worked.
        logger.error(
          'wallet.topup_credit_failed',
          new Error('addBalance returned false after Razorpay capture'),
          {
            userId: user.id,
            amount: topUpAmount,
            razorpayPaymentId: paymentResponse.razorpay_payment_id,
          },
        )
        setStatusMessage({
          text: `Payment received but wallet credit pending. Contact support with payment ID ${paymentResponse.razorpay_payment_id}.`,
          type: 'error',
        })
        setTimeout(() => setStatusMessage(null), 8000)
        return
      }

      setShowTopUp(false)
      setTopUpAmount(0)
      setStatusMessage({ text: 'Wallet topped up successfully!', type: 'success' })
      setTimeout(() => setStatusMessage(null), 4000)
      // Refresh history so the new tx shows up immediately.
      loadHistory(user.id)
    } catch (error: unknown) {
      logger.error('wallet.topup_failed', error)
      const fallback = "We couldn't process your topup right now. Please try again."
      const raw = getErrorMessage(error, fallback)
      // Hide leaky server-side phrases from end users.
      const friendly = /booking not found/i.test(raw) ? fallback : raw
      setStatusMessage({ text: friendly, type: 'error' })
      setTimeout(() => setStatusMessage(null), 5000)
    } finally {
      setProcessing(false)
    }
  }

  return (
    <div className="pt-0 px-4 md:px-6 lg:px-8 safe-bottom lg:max-w-6xl xl:max-w-7xl lg:mx-auto">
      {/* Status Message Banner */}
      <SEO
        title="Wallet"
        description="Manage your wallet balance, view transactions, and top up at A Square GoKarting."
        path="/wallet"
        noindex
      />
      <AnimatePresence>
        {statusMessage && (
          <motion.div
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            role="status"
            className={`mb-4 p-3 rounded-xl text-sm font-medium text-center ${
              statusMessage.type === 'success'
                ? 'bg-green-500/15 text-green-400 border border-green-500/20'
                : 'bg-red-500/15 text-red-400 border border-red-500/20'
            }`}
          >
            {statusMessage.text}
          </motion.div>
        )}
      </AnimatePresence>

      {/* Header */}
      <motion.div
        className="flex items-center justify-between mb-6"
        initial={{ opacity: 0, y: -20 }}
        animate={{ opacity: 1, y: 0 }}
      >
        <div>
          <h1 className="text-3xl md:text-4xl font-display font-bold text-white">
            My{' '}
            <span className="text-primary-500 drop-shadow-[0_0_15px_rgba(0,102,255,0.5)]">
              Wallet
            </span>
          </h1>
          <p className="text-primary-200/60 text-sm md:text-base mt-1">Manage your balance</p>
        </div>
        <div className="w-10 h-10 lg:w-12 lg:h-12 rounded-full bg-dark-800/50 backdrop-blur border border-white/10 flex items-center justify-center">
          <WalletIcon className="w-5 h-5 lg:w-6 lg:h-6 text-white/50" />
        </div>
      </motion.div>

      {/* Dashboard Layout: sidebar + main on lg+ */}
      <div className="lg:grid lg:grid-cols-[320px_1fr] xl:grid-cols-[360px_1fr] lg:gap-8 space-y-6 lg:space-y-0">
        {/* ===== LEFT SIDEBAR (sticky on desktop) ===== */}
        <aside className="lg:sticky lg:top-4 lg:self-start space-y-4 lg:space-y-5">
          {/* Balance Cards — 2-col on mobile, stacked on desktop */}
          <div className="grid grid-cols-2 lg:grid-cols-1 gap-4">
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-primary-600 to-primary-800 p-5 lg:p-6 border border-primary-400/20"
            >
              <div className="relative z-10">
                <div className="flex items-center gap-2 mb-3">
                  <WalletIcon className="w-4 h-4 text-primary-200" />
                  <span className="text-primary-200 text-xs font-bold uppercase tracking-wider">
                    Balance
                  </span>
                </div>
                <p className="text-3xl lg:text-4xl font-display font-bold text-white">
                  {formatCurrency(walletBalance)}
                </p>
                <button
                  onClick={() => setShowTopUp(true)}
                  className="mt-4 flex items-center gap-1.5 px-3 py-1.5 lg:px-4 lg:py-2 bg-white/20 backdrop-blur rounded-lg text-white text-xs lg:text-sm font-bold hover:bg-white/30 transition-colors"
                >
                  <Plus className="w-3 h-3" /> Add Money
                </button>
              </div>
              <Sparkles className="absolute right-3 bottom-3 w-12 h-12 text-white/10" />
            </motion.div>

            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ delay: 0.1 }}
              className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-secondary-600 to-secondary-800 p-5 lg:p-6 border border-secondary-400/20"
            >
              <div className="relative z-10">
                <div className="flex items-center gap-2 mb-3">
                  <Disc className="w-4 h-4 text-secondary-200" />
                  <span className="text-secondary-200 text-xs font-bold uppercase tracking-wider">
                    Tires
                  </span>
                </div>
                <p className="text-3xl lg:text-4xl font-display font-bold text-white">
                  {tires.toLocaleString()}
                </p>
              </div>
              <Trophy className="absolute right-3 bottom-3 w-12 h-12 text-white/10" />
            </motion.div>
          </div>

          {/* Quick Actions */}
          <motion.button
            onClick={() => setShowHistoryModal(true)}
            className="w-full flex flex-col items-center gap-2 p-4 lg:p-5 rounded-2xl bg-dark-800/50 border border-white/5 hover:bg-dark-800/70 transition-colors"
          >
            <div className="w-12 h-12 rounded-full bg-dark-700 flex items-center justify-center text-purple-400">
              <Clock className="w-6 h-6" />
            </div>
            <span className="text-sm text-dark-300 font-medium">View Full History</span>
          </motion.button>
        </aside>

        {/* ===== RIGHT MAIN CONTENT ===== */}
        <div className="space-y-4 lg:space-y-6">
          {/* Recent Activity Section */}
          <div className="flex items-center justify-between">
            <h2 className="text-white font-bold md:text-lg flex items-center gap-2">
              <Clock className="w-4 h-4 md:w-5 md:h-5 text-primary-400" /> Recent Activity
            </h2>
            <button
              onClick={() => setShowHistoryModal(true)}
              className="text-primary-400 text-xs md:text-sm font-bold"
            >
              View All
            </button>
          </div>

          {loadingHistory ? (
            <div className="space-y-3">
              {[...Array(5)].map((_, i) => (
                <div
                  key={i}
                  className="h-20 lg:h-24 bg-dark-800/20 border border-white/5 rounded-2xl animate-pulse"
                />
              ))}
            </div>
          ) : historyError ? (
            <div className="flex flex-col items-center justify-center py-10 lg:py-20 text-center bg-dark-800/30 rounded-3xl border border-red-500/10">
              <AlertTriangle className="w-8 h-8 lg:w-12 lg:h-12 text-red-400 mb-2" />
              <p className="text-dark-400 text-xs lg:text-sm mb-3">
                Failed to load transaction history
              </p>
              <button
                type="button"
                onClick={() => {
                  if (user?.id) loadHistory(user.id)
                }}
                className="px-4 py-2 bg-primary-500/20 text-primary-400 rounded-xl text-xs font-bold hover:bg-primary-500/30 transition-colors"
              >
                Try Again
              </button>
            </div>
          ) : history.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-10 lg:py-20 text-center opacity-50 bg-dark-800/30 rounded-3xl border border-white/5">
              <Clock className="w-8 h-8 lg:w-12 lg:h-12 text-dark-600 mb-2" />
              <p className="text-dark-400 text-xs lg:text-sm">No transactions yet</p>
            </div>
          ) : (
            <div className="space-y-3">
              {history.slice(0, 10).map((tx) => (
                <TransactionItem key={tx.id} tx={tx} />
              ))}
              {history.length > 10 && (
                <button
                  onClick={() => setShowHistoryModal(true)}
                  className="w-full py-3 text-center text-primary-400 text-sm font-bold bg-dark-800/30 rounded-2xl border border-white/5 hover:bg-dark-800/50 transition-colors"
                >
                  View all {history.length} transactions
                </button>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Modals */}
      <AnimatePresence>
        {showTopUp && (
          <div key="topup-modal">
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 bg-dark-950/80 backdrop-blur-sm z-[60]"
              onClick={() => setShowTopUp(false)}
            />
            <motion.div
              initial={{ y: '100%', x: '-50%' }}
              animate={{ y: 0, x: '-50%' }}
              exit={{ y: '100%', x: '-50%' }}
              className="fixed left-1/2 -translate-x-1/2 z-[61] w-[min(calc(100vw-32px),400px)] bg-dark-900 border border-white/10 rounded-[2.5rem] p-6 shadow-[0_20px_50px_rgba(0,0,0,0.5)] md:top-1/2 md:-translate-y-1/2 md:[bottom:auto!important] md:w-[420px]"
              style={{ bottom: 'max(6.5rem, calc(env(safe-area-inset-bottom, 1.5rem) + 5rem))' }}
            >
              <div className="w-16 h-1 bg-dark-700 rounded-full mx-auto mb-6" />
              <h2 className="text-2xl font-display font-bold text-white mb-6">Add Money</h2>
              <div className="grid grid-cols-4 gap-3 mb-6">
                {quickAmounts.map((amount) => (
                  <button
                    key={amount}
                    onClick={() => setTopUpAmount(amount)}
                    className={`py-3 rounded-xl font-bold text-sm ${topUpAmount === amount ? 'bg-primary-500 text-white' : 'bg-dark-800 text-dark-300'}`}
                  >
                    ₹{amount}
                  </button>
                ))}
              </div>

              {/* Custom Amount */}
              <div className="mb-6">
                <label className="text-dark-400 text-xs mb-2 block">Or enter custom amount</label>
                <div className="relative">
                  <span className="absolute left-4 top-1/2 -translate-y-1/2 text-dark-400 font-bold">
                    ₹
                  </span>
                  <input
                    type="number"
                    value={topUpAmount || ''}
                    onChange={(e) => setTopUpAmount(parseInt(e.target.value) || 0)}
                    placeholder="Enter amount"
                    className="w-full pl-10 pr-4 py-4 rounded-xl bg-dark-800 border border-white/10 text-white font-bold text-lg focus:border-primary-500 outline-none transition-colors"
                  />
                </div>
              </div>
              <button
                disabled={topUpAmount < 50 || processing}
                onClick={handleTopUp}
                className="w-full py-4 rounded-xl bg-primary-500 text-white font-bold text-lg disabled:opacity-50"
              >
                {processing ? 'Processing...' : `Pay ${formatCurrency(topUpAmount)}`}
              </button>
            </motion.div>
          </div>
        )}

        {showHistoryModal && (
          <div key="history-modal">
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 bg-dark-950/90 backdrop-blur-md z-[70]"
              onClick={() => setShowHistoryModal(false)}
            />
            <motion.div
              initial={{ x: '100%' }}
              animate={{ x: 0 }}
              exit={{ x: '100%' }}
              className="fixed inset-0 lg:inset-auto lg:top-1/2 lg:left-1/2 lg:-translate-x-1/2 lg:-translate-y-1/2 lg:w-full lg:max-w-2xl lg:max-h-[80vh] lg:rounded-3xl z-[71] bg-dark-950 lg:border lg:border-white/10 lg:shadow-2xl flex flex-col"
            >
              <div className="p-6 pt-12 lg:pt-6 flex items-center justify-between border-b border-white/5">
                <h2 className="text-xl font-display font-bold text-white">Transaction History</h2>
                <button
                  onClick={() => setShowHistoryModal(false)}
                  className="w-10 h-10 rounded-full bg-dark-800 flex items-center justify-center text-white"
                >
                  <X />
                </button>
              </div>
              <div className="flex-1 overflow-y-auto p-4 lg:p-6 space-y-3">
                {history.map((tx) => (
                  <TransactionItem key={tx.id} tx={tx} />
                ))}
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  )
}

function TransactionItem({ tx }: { tx: Transaction }) {
  const isCredit = tx.type === 'credit' || tx.type === 'tire_credit'
  const isTire = tx.type === 'tire_credit' || tx.type === 'tire_debit'
  return (
    <div className="bg-dark-800/40 border border-white/5 rounded-2xl p-4 md:p-5 lg:p-6 flex items-center justify-between">
      <div className="flex items-center gap-3 lg:gap-4">
        <div
          className={`w-10 h-10 lg:w-12 lg:h-12 rounded-xl flex items-center justify-center ${isCredit ? 'bg-green-500/10 text-green-400' : 'bg-red-500/10 text-red-400'}`}
        >
          {isCredit ? (
            <ArrowDownLeft size={20} className="lg:w-6 lg:h-6" />
          ) : (
            <ArrowUpRight size={20} className="lg:w-6 lg:h-6" />
          )}
        </div>
        <div>
          <p className="text-white font-bold text-sm lg:text-base leading-tight">
            {tx.description}
          </p>
          <p className="text-dark-400 text-xs lg:text-sm mt-1">
            {tx.timestamp
              ? fmtDateTimeFullIST(new Date(tx.timestamp.seconds * 1000))
              : 'Processing...'}
          </p>
        </div>
      </div>
      <div className="text-right">
        <p
          className={`font-bold text-sm lg:text-base ${isCredit ? 'text-green-400' : 'text-red-400'}`}
        >
          {isCredit ? '+' : '-'}
          {isTire ? tx.amount : formatCurrency(tx.amount)}
        </p>
        <span className="text-[9px] lg:text-[10px] uppercase font-black text-dark-500">
          {isTire ? 'Tires' : 'Cash'}
        </span>
      </div>
    </div>
  )
}
