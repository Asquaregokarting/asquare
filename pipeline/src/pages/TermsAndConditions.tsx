import { motion } from 'framer-motion'
import {
  ChevronLeft,
  Scale,
  Shield,
  Users,
  AlertTriangle,
  Ban,
  CreditCard,
  FileText,
  Gavel,
  Mail,
} from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import SEO from '../components/SEO'

export default function TermsAndConditions() {
  const navigate = useNavigate()

  const sections = [
    {
      title: '1. Acceptance of Terms',
      icon: <FileText className="w-5 h-5 text-primary-400" />,
      content: `By accessing or using the A Square GoKarting application ("App"), website (app.asquaregokarting.com), or any services provided by A Square Go-Karting & Entertainment ("Company", "we", "us"), you agree to be bound by these Terms and Conditions.

If you do not agree with any part of these terms, you must not use our services. We reserve the right to modify these terms at any time, and your continued use of our services constitutes acceptance of updated terms.`,
    },
    {
      title: '2. Eligibility',
      icon: <Users className="w-5 h-5 text-secondary-400" />,
      content: `You must be at least 18 years of age to create an account, make bookings, or conduct transactions on the App. Persons under 18 may participate in activities only under the supervision and consent of a parent or legal guardian.

By using our services, you represent and warrant that:
• You are at least 18 years old or have parental/guardian consent
• You have the legal capacity to enter into a binding agreement
• All information you provide is accurate and complete
• You will maintain the security of your account credentials`,
    },
    {
      title: '3. Services & Bookings',
      icon: <CreditCard className="w-5 h-5 text-primary-400" />,
      content: `A Square GoKarting provides go-karting, adventure activities, helicopter rides, and entertainment services across our branches in Vizag, Kakinada, Rajahmundry, and Srikakulam.

Booking Terms:
• All bookings are subject to availability at the selected branch and time slot
• Confirmed bookings are binding and subject to our Return & Refund Policy
• Booking prices are inclusive of applicable taxes unless stated otherwise
• We reserve the right to cancel or reschedule bookings due to weather, safety concerns, or operational reasons — in such cases, a full refund or reschedule will be offered
• Digital wallet credits and promotional balances are non-transferable and subject to expiry as specified at the time of credit`,
    },
    {
      title: '4. User Conduct',
      icon: <Shield className="w-5 h-5 text-green-400" />,
      content: `While using our services, you agree to:
• Follow all safety instructions provided by our staff and track marshals
• Wear mandatory safety gear (helmets, seat belts) as directed
• Not operate any equipment or vehicle under the influence of alcohol or drugs
• Behave respectfully toward staff, other customers, and property
• Not engage in reckless driving or behaviour that endangers yourself or others

We reserve the right to refuse service, revoke access, or terminate your account without refund if you violate these conduct guidelines.`,
    },
    {
      title: '5. Assumption of Risk & Liability',
      icon: <AlertTriangle className="w-5 h-5 text-yellow-400" />,
      content: `Go-karting and adventure activities involve inherent risks including but not limited to physical injury. By participating, you voluntarily assume all risks associated with these activities.

Limitation of Liability:
• The Company shall not be liable for any indirect, incidental, special, or consequential damages arising from the use of our services
• Our total liability for any claim shall not exceed the amount paid by you for the specific booking or service in question
• We are not responsible for personal belongings lost or damaged at our facilities
• Participants with pre-existing medical conditions must disclose them before engaging in activities`,
    },
    {
      title: '6. Intellectual Property',
      icon: <Ban className="w-5 h-5 text-primary-400" />,
      content: `All content on the App — including logos, text, graphics, images, software, and designs — is the property of A Square Go-Karting & Entertainment and protected under applicable intellectual property laws.

You may not:
• Copy, reproduce, or distribute any content without prior written consent
• Use our trademarks, brand name, or logos for any commercial purpose
• Reverse-engineer, decompile, or disassemble any part of the App`,
    },
    {
      title: '7. Privacy',
      icon: <Shield className="w-5 h-5 text-secondary-400" />,
      content: `Your use of the App is also governed by our Privacy Policy, which details how we collect, use, and protect your personal data. By using our services, you consent to the data practices described in our Privacy Policy.`,
    },
    {
      title: '8. Termination',
      icon: <Ban className="w-5 h-5 text-red-400" />,
      content: `We may suspend or terminate your account and access to our services at our sole discretion, without prior notice, if:
• You breach any provision of these Terms and Conditions
• You engage in fraudulent or illegal activity
• Your conduct poses a risk to the safety of others

Upon termination, any outstanding wallet balance or unused credits may be forfeited, except where prohibited by applicable law.`,
    },
    {
      title: '9. Governing Law & Jurisdiction',
      icon: <Gavel className="w-5 h-5 text-primary-400" />,
      content: `These Terms and Conditions shall be governed by and construed in accordance with the laws of India.

Any disputes arising out of or in connection with these terms shall be subject to the exclusive jurisdiction of the courts located in Visakhapatnam, Andhra Pradesh, India.

Before initiating legal proceedings, both parties agree to attempt to resolve disputes through good-faith negotiation. If unresolved within 30 days, disputes shall be referred to arbitration under the Arbitration and Conciliation Act, 1996, with the seat of arbitration in Visakhapatnam.`,
    },
    {
      title: '10. Contact Us',
      icon: <Scale className="w-5 h-5 text-green-400" />,
      content: `For questions or concerns regarding these Terms and Conditions, please contact:

A Square Go-Karting & Entertainment
Email: asquaregokarting@gmail.com
Escalations: escalations@asquaregokarting.com
Website: app.asquaregokarting.com`,
    },
  ]

  return (
    <div className="min-h-screen bg-dark-900 pb-20">
      <SEO
        title="Terms & Conditions"
        description="Terms and conditions for using A Square GoKarting app and services. Read about eligibility, bookings, payments, conduct, and liability."
        path="/terms"
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
          <h1 className="text-white font-display font-bold text-lg">Terms & Conditions</h1>
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
            <h2 className="text-white font-display font-bold text-xl mb-3">Terms of Service</h2>
            <p className="text-dark-300 text-sm leading-relaxed">
              Please read these terms carefully before using our services. By using the A Square
              GoKarting app or visiting our facilities, you agree to these terms.
            </p>
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
            <h3 className="text-white font-bold mb-2">Have Questions?</h3>
            <p className="text-dark-400 text-xs mb-4">
              If you have concerns about these terms, please reach out to us.
            </p>
            <a
              href="mailto:asquaregokarting@gmail.com"
              className="inline-block px-6 py-2.5 bg-primary-500 text-white font-bold rounded-xl text-sm"
            >
              Contact Us
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
