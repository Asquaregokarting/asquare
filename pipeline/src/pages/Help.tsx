import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { motion } from 'framer-motion'
import {
  ArrowLeft,
  HelpCircle,
  MessageSquarePlus,
  Inbox,
  ChevronDown,
  ChevronUp,
  LifeBuoy,
} from 'lucide-react'
import SEO from '../components/SEO'
import { useAuth } from '../contexts/AuthContext'
import { ticketCustomerService } from '../services/ticketCustomerService'
import CustomerRaiseTicketModal from '../components/tickets/CustomerRaiseTicketModal'
import CustomerTicketCard from '../components/tickets/CustomerTicketCard'
import { logger } from '../lib/logger'
import type { Ticket, TicketKbArticle } from '../types'

export default function Help() {
  const navigate = useNavigate()
  const { user } = useAuth()
  const [tickets, setTickets] = useState<Ticket[]>([])
  const [loading, setLoading] = useState(true)
  const [modalOpen, setModalOpen] = useState(false)
  const [openFaq, setOpenFaq] = useState<string | null>(null)
  const [faqArticles, setFaqArticles] = useState<TicketKbArticle[]>([])
  const [faqLoading, setFaqLoading] = useState(true)

  useEffect(() => {
    if (!user) {
      setLoading(false)
      return
    }
    const unsub = ticketCustomerService.subscribeToMyTickets(
      user.id,
      (rows) => {
        setTickets(rows)
        setLoading(false)
      },
      (err) => {
        logger.error('help.tickets.subscribe_failed', err, { userId: user.id })
        setLoading(false)
      },
    )
    return () => unsub()
  }, [user])

  useEffect(() => {
    let cancelled = false
    setFaqLoading(true)
    ticketCustomerService
      .getCustomerKbArticles()
      .then((rows) => {
        if (!cancelled) {
          setFaqArticles(rows)
          setFaqLoading(false)
        }
      })
      .catch((err) => {
        logger.error('help.kb.fetch_failed', err instanceof Error ? err : new Error(String(err)))
        if (!cancelled) setFaqLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [])

  const recentTickets = tickets.slice(0, 5)

  return (
    <div className="min-h-screen bg-dark-950 text-white pb-32">
      <SEO
        title="Help & Support"
        description="Get help, raise a ticket, and track your support requests at A Square GoKarting."
        path="/help"
        noindex
      />

      {/* Header */}
      <div className="relative px-4 py-6 flex items-center gap-3">
        <button
          onClick={() => navigate(-1)}
          className="w-10 h-10 rounded-full bg-white/5 backdrop-blur-sm border border-white/10 flex items-center justify-center text-white hover:bg-white/10 transition-colors"
          aria-label="Go back"
        >
          <ArrowLeft className="w-5 h-5" />
        </button>
        <h1 className="text-lg font-bold">Help & Support</h1>
      </div>

      <div className="max-w-2xl mx-auto px-4 space-y-8">
        {/* Hero */}
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          className="card bg-gradient-to-br from-primary-500/15 via-secondary-500/10 to-transparent border-primary-500/20"
        >
          <div className="flex items-start gap-4">
            <div className="w-14 h-14 rounded-2xl bg-primary-500/20 flex items-center justify-center shrink-0">
              <LifeBuoy className="w-7 h-7 text-primary-400" />
            </div>
            <div className="flex-1">
              <h2 className="text-xl font-bold text-white">How can we help?</h2>
              <p className="text-white/60 text-sm mt-1">
                Browse FAQs below or raise a ticket and we&rsquo;ll get back to you fast.
              </p>
              <button
                type="button"
                onClick={() => setModalOpen(true)}
                className="mt-4 inline-flex items-center gap-2 bg-primary-600 hover:bg-primary-500 text-white font-bold px-4 py-2.5 rounded-xl transition-colors"
              >
                <MessageSquarePlus className="w-4 h-4" />
                Raise a ticket
              </button>
            </div>
          </div>
        </motion.div>

        {/* My recent tickets */}
        <section>
          <div className="flex items-center justify-between mb-3">
            <h3 className="font-semibold text-white flex items-center gap-2">
              <Inbox className="w-5 h-5 text-primary-400" />
              My recent tickets
            </h3>
            {tickets.length > 5 && (
              <span className="text-xs text-white/40">
                Showing {recentTickets.length} of {tickets.length}
              </span>
            )}
          </div>

          {!user ? (
            <div className="card text-center py-8">
              <p className="text-white/60 text-sm">Sign in to see your tickets.</p>
            </div>
          ) : loading ? (
            <div className="space-y-2">
              <div className="h-20 bg-dark-800 animate-pulse rounded-xl" />
              <div className="h-20 bg-dark-800 animate-pulse rounded-xl" />
            </div>
          ) : recentTickets.length === 0 ? (
            <div className="card text-center py-8">
              <Inbox className="w-8 h-8 text-white/30 mx-auto mb-2" />
              <p className="text-white/60 text-sm">No tickets yet.</p>
              <p className="text-white/40 text-xs mt-1">
                Tap &ldquo;Raise a ticket&rdquo; above to get started.
              </p>
            </div>
          ) : (
            <div className="space-y-2">
              {recentTickets.map((t) => (
                <CustomerTicketCard key={t.id} ticket={t} />
              ))}
            </div>
          )}
        </section>

        {/* FAQ — sourced from the admin-managed KB */}
        <section>
          <h3 className="font-semibold text-white flex items-center gap-2 mb-3">
            <HelpCircle className="w-5 h-5 text-primary-400" />
            Frequently asked
          </h3>
          {faqLoading ? (
            <div className="space-y-2">
              <div className="h-12 bg-dark-800 animate-pulse rounded-xl" />
              <div className="h-12 bg-dark-800 animate-pulse rounded-xl" />
              <div className="h-12 bg-dark-800 animate-pulse rounded-xl" />
            </div>
          ) : faqArticles.length === 0 ? (
            <div className="card text-center py-8">
              <p className="text-white/60 text-sm">No FAQs yet.</p>
              <p className="text-white/40 text-xs mt-1">
                Tap &ldquo;Raise a ticket&rdquo; above and we&rsquo;ll help you out.
              </p>
            </div>
          ) : (
            <div className="space-y-2">
              {faqArticles.map((article) => {
                const isOpen = openFaq === article.id
                return (
                  <div
                    key={article.id}
                    className="bg-dark-800 border border-white/5 rounded-xl overflow-hidden"
                  >
                    <button
                      type="button"
                      onClick={() => setOpenFaq(isOpen ? null : article.id)}
                      className="w-full flex items-center justify-between p-4 text-left hover:bg-dark-700 transition-colors"
                      aria-expanded={isOpen ? 'true' : 'false'}
                    >
                      <span className="text-sm font-medium text-white pr-4">{article.title}</span>
                      {isOpen ? (
                        <ChevronUp className="w-4 h-4 text-white/40 shrink-0" />
                      ) : (
                        <ChevronDown className="w-4 h-4 text-white/40 shrink-0" />
                      )}
                    </button>
                    {isOpen && (
                      <div className="px-4 pb-4 text-sm text-white/70 border-t border-white/5 pt-3 whitespace-pre-wrap">
                        {article.body}
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          )}
        </section>
      </div>

      <CustomerRaiseTicketModal open={modalOpen} onClose={() => setModalOpen(false)} />
    </div>
  )
}
