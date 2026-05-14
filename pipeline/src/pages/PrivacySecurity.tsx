import { motion } from 'framer-motion'
import { ChevronLeft, Shield, FileText, RotateCcw, ChevronRight, Lock } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import SEO from '../components/SEO'

export default function PrivacySecurity() {
  const navigate = useNavigate()

  const links = [
    {
      icon: Shield,
      title: 'Privacy Policy',
      description: 'Read how we collect, use, and protect your data',
      path: '/privacy',
    },
    {
      icon: FileText,
      title: 'Terms & Conditions',
      description: 'Our terms of service and governing law',
      path: '/terms',
    },
    {
      icon: RotateCcw,
      title: 'Return & Refund Policy',
      description: 'Cancellation timeframes and refund details',
      path: '/refund-policy',
    },
  ]

  return (
    <div className="min-h-screen bg-dark-900 pb-20">
      <SEO
        title="Privacy & Security"
        description="A Square GoKarting privacy and security information. View our privacy policy, terms of service, and refund policy."
        path="/privacy-security"
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
          <h1 className="text-white font-display font-bold text-lg">Privacy & Security</h1>
          <p className="text-dark-500 text-xs">Your data, your rights</p>
        </div>
      </div>

      <div className="max-w-3xl mx-auto px-4 py-8">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="space-y-6"
        >
          {/* Hero Section */}
          <div className="bg-gradient-to-br from-primary-500/10 to-secondary-500/10 border border-white/10 rounded-3xl p-6">
            <div className="flex items-center gap-3 mb-3">
              <div className="p-3 bg-primary-500/20 rounded-2xl">
                <Lock className="w-6 h-6 text-primary-400" />
              </div>
              <div>
                <h2 className="text-white font-display font-bold text-xl">We Value Your Privacy</h2>
                <p className="text-dark-400 text-sm">Transparency builds trust</p>
              </div>
            </div>
            <p className="text-dark-300 text-sm leading-relaxed mt-3">
              At A Square GoKarting, we are committed to protecting your personal information and being transparent about how we handle your data. Review our policies below.
            </p>
          </div>

          {/* Policy Links */}
          <div className="space-y-3">
            {links.map((link, idx) => (
              <motion.button
                key={link.path}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: idx * 0.1 }}
                onClick={() => navigate(link.path)}
                className="w-full p-4 bg-dark-800 rounded-xl flex items-center gap-4 group hover:bg-dark-700 transition-colors"
              >
                <div className="p-2 bg-dark-700 rounded-xl group-hover:bg-dark-600 transition-colors">
                  <link.icon className="w-6 h-6 text-primary-400" />
                </div>
                <div className="text-left flex-1">
                  <p className="text-white font-medium group-hover:text-primary-400 transition-colors">
                    {link.title}
                  </p>
                  <p className="text-dark-400 text-xs">{link.description}</p>
                </div>
                <ChevronRight className="w-5 h-5 text-dark-500 group-hover:text-dark-400 transition-colors" />
              </motion.button>
            ))}
          </div>

          {/* Footer Note */}
          <p className="text-center text-dark-600 text-[10px] mt-8">
            © 2026 A Square Go-Karting & Entertainment. All Rights Reserved.
          </p>
        </motion.div>
      </div>
    </div>
  )
}
