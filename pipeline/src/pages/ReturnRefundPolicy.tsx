import { motion } from 'framer-motion'
import {
  ChevronLeft,
  RotateCcw,
  Clock,
  XCircle,
  CheckCircle,
  AlertTriangle,
  CreditCard,
  HelpCircle,
  Mail,
} from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import SEO from '../components/SEO'

export default function ReturnRefundPolicy() {
  const navigate = useNavigate()

  const sections = [
    {
      title: '1. Overview',
      icon: <RotateCcw className="w-5 h-5 text-primary-400" />,
      content: `At A Square GoKarting, we strive to ensure every customer has a great experience. This Return & Refund Policy outlines the conditions under which bookings may be cancelled and refunds issued.

This policy applies to all bookings made through the A Square GoKarting app (app.asquaregokarting.com) and at our facilities across Vizag, Kakinada, Rajahmundry, and Srikakulam.`,
    },
    {
      title: '2. Cancellation by Customer',
      icon: <XCircle className="w-5 h-5 text-red-400" />,
      content: `You may cancel a confirmed booking subject to the following timeframes and conditions:

• More than 24 hours before scheduled slot: Full refund (100%) to original payment method
• Between 12–24 hours before scheduled slot: 75% refund to original payment method
• Between 6–12 hours before scheduled slot: 50% refund, issued as wallet credit
• Less than 6 hours before scheduled slot: No refund

To cancel, go to My Bookings in the app, select the booking, and tap "Cancel Booking". Cancellations cannot be processed after the scheduled activity time has passed.`,
    },
    {
      title: '3. Cancellation by A Square GoKarting',
      icon: <AlertTriangle className="w-5 h-5 text-yellow-400" />,
      content: `We may cancel or reschedule bookings due to:
• Adverse weather conditions (rain, storms, extreme heat)
• Equipment maintenance or safety concerns
• Operational or staffing issues
• Unforeseen circumstances or force majeure events

In all such cases, you will receive:
• A full refund (100%) to your original payment method, OR
• The option to reschedule to another available slot at no additional cost

We will notify you via SMS/WhatsApp and in-app notification as soon as possible when a cancellation occurs.`,
    },
    {
      title: '4. Refund Timeframes',
      icon: <Clock className="w-5 h-5 text-primary-400" />,
      content: `Refund processing times depend on the payment method used:

• Wallet Credit: Instant — reflected immediately in your A Square wallet
• UPI (GPay, PhonePe, etc.): 3–5 business days
• Debit Card: 5–7 business days
• Credit Card: 7–10 business days
• Net Banking: 5–7 business days

Please note that while we initiate refunds promptly, the actual credit to your account depends on your bank or payment provider. If your refund is delayed beyond the above timeframes, please contact our support team.`,
    },
    {
      title: '5. Non-Refundable Items',
      icon: <XCircle className="w-5 h-5 text-secondary-400" />,
      content: `The following are non-refundable:

• No-shows: If you do not arrive for your scheduled booking without prior cancellation
• Partially used bookings: Rides or activities already consumed cannot be refunded
• Promotional or discounted bookings: Bookings made with special coupons or promotional offers may be non-refundable or subject to modified refund terms as specified at the time of purchase
• Wallet top-ups: Credits added to your A Square wallet are non-refundable but can be used for future bookings
• Expired bookings: Bookings that have passed their validity period`,
    },
    {
      title: '6. Rescheduling',
      icon: <CheckCircle className="w-5 h-5 text-green-400" />,
      content: `Instead of cancelling, you may reschedule your booking:

• Rescheduling is free if done more than 12 hours before the scheduled slot
• Rescheduling within 12 hours of the scheduled slot may incur a ₹50 rescheduling fee
• Each booking can be rescheduled a maximum of 2 times
• Rescheduled bookings are subject to availability at the selected branch and time

To reschedule, go to My Bookings, select the booking, and tap "Reschedule".`,
    },
    {
      title: '7. Refund for Technical Issues',
      icon: <HelpCircle className="w-5 h-5 text-primary-400" />,
      content: `If you experience a payment issue such as:
• Double charge for a single booking
• Payment deducted but booking not confirmed
• Incorrect amount charged

Please contact our support team within 48 hours of the transaction with your booking ID and payment details. We will investigate and process a full refund for any verified technical error within 5 business days.`,
    },
    {
      title: '8. How to Request a Refund',
      icon: <CreditCard className="w-5 h-5 text-secondary-400" />,
      content: `To request a refund:

1. Open the A Square GoKarting app
2. Go to My Bookings → select the booking
3. Tap "Cancel Booking" and confirm
4. The refund will be automatically initiated based on the cancellation timeframe

For refunds related to technical issues or disputes:
• Email: escalations@asquaregokarting.com
• Include your booking ID, transaction ID, and a brief description
• Our team will respond within 24 hours

For unresolved refund disputes, you may escalate to our General Manager at asquaregokarting@gmail.com.`,
    },
  ]

  return (
    <div className="min-h-screen bg-dark-900 pb-20">
      <SEO
        title="Return & Refund Policy"
        description="A Square GoKarting return and refund policy. Cancellation timelines, refund methods, rescheduling options, and wallet credit terms."
        path="/refund-policy"
      />
      {/* Sticky Header */}
      <div className="sticky top-0 z-50 bg-dark-900/80 backdrop-blur-xl border-b border-white/5 p-4 flex items-center gap-4">
        <button
          onClick={() => navigate(-1)}
          className="p-2 hover:bg-dark-800 rounded-full transition-colors"
        >
          <ChevronLeft className="w-6 h-6 text-white" />
        </button>
        <div>
          <h1 className="text-white font-display font-bold text-lg">Return & Refund Policy</h1>
          <p className="text-dark-500 text-xs">Last updated March 23, 2026</p>
        </div>
      </div>

      <div className="max-w-3xl mx-auto px-4 py-8">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="space-y-8"
        >
          {/* Hero Section */}
          <div className="bg-gradient-to-br from-primary-500/10 to-secondary-500/10 border border-white/10 rounded-3xl p-6 mb-8">
            <h2 className="text-white font-display font-bold text-xl mb-3">
              Our Refund Commitment
            </h2>
            <p className="text-dark-300 text-sm leading-relaxed">
              We believe in fair and transparent refund practices. If your plans change, we've got
              you covered with clear cancellation and refund timelines.
            </p>
          </div>

          {/* Refund Quick Reference */}
          <div className="grid grid-cols-2 gap-3">
            <div className="bg-green-500/10 border border-green-500/20 rounded-2xl p-4 text-center">
              <p className="text-green-400 font-bold text-lg">100%</p>
              <p className="text-dark-400 text-xs mt-1">24+ hrs before</p>
            </div>
            <div className="bg-primary-500/10 border border-primary-500/20 rounded-2xl p-4 text-center">
              <p className="text-primary-400 font-bold text-lg">75%</p>
              <p className="text-dark-400 text-xs mt-1">12–24 hrs before</p>
            </div>
            <div className="bg-yellow-500/10 border border-yellow-500/20 rounded-2xl p-4 text-center">
              <p className="text-yellow-400 font-bold text-lg">50%</p>
              <p className="text-dark-400 text-xs mt-1">6–12 hrs before</p>
            </div>
            <div className="bg-red-500/10 border border-red-500/20 rounded-2xl p-4 text-center">
              <p className="text-red-400 font-bold text-lg">0%</p>
              <p className="text-dark-400 text-xs mt-1">&lt; 6 hrs before</p>
            </div>
          </div>

          {/* Dynamic Sections */}
          {sections.map((section, idx) => (
            <motion.div
              key={idx}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: idx * 0.1 }}
              className="group"
            >
              <div className="flex items-center gap-3 mb-3">
                <div className="p-2 bg-dark-800 rounded-xl group-hover:bg-dark-700 transition-colors">
                  {section.icon}
                </div>
                <h3 className="text-white font-bold text-lg">{section.title}</h3>
              </div>
              <div className="pl-13">
                <p className="text-dark-400 text-sm leading-relaxed whitespace-pre-wrap">
                  {section.content}
                </p>
              </div>
              {idx !== sections.length - 1 && <div className="h-px bg-white/5 mt-8 ml-13" />}
            </motion.div>
          ))}

          {/* Contact Footer */}
          <div className="mt-12 p-6 bg-dark-800 rounded-3xl border border-white/5 text-center">
            <Mail className="w-8 h-8 text-primary-400 mx-auto mb-4" />
            <h3 className="text-white font-bold mb-2">Need Help with a Refund?</h3>
            <p className="text-dark-400 text-xs mb-4">
              Contact our support team for any refund-related queries.
            </p>
            <a
              href="mailto:escalations@asquaregokarting.com"
              className="inline-block px-6 py-2.5 bg-primary-500 text-white font-bold rounded-xl text-sm"
            >
              Email Support
            </a>
          </div>

          <p className="text-center text-dark-600 text-[10px] mt-8 pb-10">
            © 2026 A Square Go-Karting & Entertainment. All Rights Reserved.
          </p>
        </motion.div>
      </div>
    </div>
  )
}
