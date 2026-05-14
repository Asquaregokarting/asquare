import { Link } from 'react-router-dom'
import { Shield, Mail, MapPin, Phone } from 'lucide-react'

const SOCIAL_LINKS = [
  {
    label: 'Instagram',
    url: 'https://www.instagram.com/asquaregokarting/',
    icon: (
      <svg viewBox="0 0 24 24" fill="currentColor" className="w-4 h-4">
        <path d="M7.75 2h8.5A5.75 5.75 0 0 1 22 7.75v8.5A5.75 5.75 0 0 1 16.25 22h-8.5A5.75 5.75 0 0 1 2 16.25v-8.5A5.75 5.75 0 0 1 7.75 2Zm0 1.5A4.25 4.25 0 0 0 3.5 7.75v8.5A4.25 4.25 0 0 0 7.75 20.5h8.5A4.25 4.25 0 0 0 20.5 16.25v-8.5A4.25 4.25 0 0 0 16.25 3.5Zm4.25 3.25a5.25 5.25 0 1 1 0 10.5 5.25 5.25 0 0 1 0-10.5Zm0 1.5a3.75 3.75 0 1 0 0 7.5 3.75 3.75 0 0 0 0-7.5Zm5.5-1.5a1 1 0 1 1 0 2 1 1 0 0 1 0-2Z" />
      </svg>
    ),
  },
  {
    label: 'Facebook',
    url: 'https://www.facebook.com/asquaregokartingvzg/',
    icon: (
      <svg viewBox="0 0 24 24" fill="currentColor" className="w-4 h-4">
        <path d="M22 12c0-5.523-4.477-10-10-10S2 6.477 2 12c0 4.991 3.657 9.128 8.438 9.879V14.89h-2.54V12h2.54V9.797c0-2.506 1.492-3.89 3.777-3.89 1.094 0 2.238.195 2.238.195v2.46h-1.26c-1.243 0-1.63.771-1.63 1.562V12h2.773l-.443 2.89h-2.33v6.989C18.343 21.129 22 16.99 22 12Z" />
      </svg>
    ),
  },
  {
    label: 'YouTube',
    url: 'https://www.youtube.com/@asquaregokarting3851',
    icon: (
      <svg viewBox="0 0 24 24" fill="currentColor" className="w-4 h-4">
        <path d="M23.498 6.186a2.994 2.994 0 0 0-2.112-2.12C19.505 3.546 12 3.546 12 3.546s-7.505 0-9.386.52A2.994 2.994 0 0 0 .502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a2.994 2.994 0 0 0 2.112 2.12c1.881.52 9.386.52 9.386.52s7.505 0 9.386-.52a2.994 2.994 0 0 0 2.112-2.12C24 15.93 24 12 24 12s0-3.93-.502-5.814ZM9.546 15.568V8.432L15.818 12 9.546 15.568Z" />
      </svg>
    ),
  },
]

export default function Footer() {
  return (
    <footer className="border-t border-white/10 bg-dark-900/50 backdrop-blur-sm pb-28 lg:pb-8">
      <div className="max-w-7xl mx-auto px-4 pt-8 pb-4 lg:px-8">
        {/* Three-column grid */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
          {/* Column 1 — Brand */}
          <div>
            <h3 className="text-white font-display font-bold text-lg">A SQUARE ENTERTAINMENTS</h3>
            <p className="text-white/50 text-sm mt-1">Adventure & Entertainment Sports</p>
            <div className="flex items-center gap-3 mt-4">
              {SOCIAL_LINKS.map((link) => (
                <a
                  key={link.label}
                  href={link.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  aria-label={link.label}
                  className="w-9 h-9 rounded-full bg-white/5 hover:bg-white/10 flex items-center justify-center text-white/70 hover:text-primary-400 transition-colors"
                >
                  {link.icon}
                </a>
              ))}
            </div>
          </div>

          {/* Column 2 — Contact Us */}
          <div>
            <h4 className="text-white font-semibold text-sm uppercase tracking-wider">Contact Us</h4>
            <div className="flex items-center gap-2 mt-3">
              <Phone className="w-4 h-4 text-primary-400 flex-shrink-0" />
              <a
                href="tel:8499888872"
                className="text-white/70 hover:text-primary-400 text-sm transition-colors"
              >
                8499888872
              </a>
            </div>
            <div className="flex items-center gap-2 mt-2">
              <Mail className="w-4 h-4 text-primary-400 flex-shrink-0" />
              <a
                href="mailto:dev.asquaregokarting@gmail.com"
                className="text-white/70 hover:text-primary-400 text-sm transition-colors"
              >
                dev.asquaregokarting@gmail.com
              </a>
            </div>
            <div className="flex items-start gap-2 mt-2">
              <MapPin className="w-4 h-4 text-primary-400 flex-shrink-0 mt-0.5" />
              <p className="text-white/70 text-sm">
                Anandapuram Junction, Bus Stop, 16, National Highway, Visakhapatnam, Vellanki, Andhra Pradesh 531163
              </p>
            </div>
          </div>

          {/* Column 3 — Legal */}
          <div>
            <h4 className="text-white font-semibold text-sm uppercase tracking-wider">Legal</h4>
            <div className="flex flex-col gap-2 mt-3">
              <Link
                to="/privacy-security"
                className="flex items-center gap-1.5 text-white/70 hover:text-primary-400 text-sm transition-colors"
              >
                <Shield className="w-3.5 h-3.5" />
                <span>Privacy & Security</span>
              </Link>
              <Link
                to="/terms"
                className="text-white/70 hover:text-primary-400 text-sm transition-colors"
              >
                Terms
              </Link>
              <Link
                to="/refund-policy"
                className="text-white/70 hover:text-primary-400 text-sm transition-colors"
              >
                Refund Policy
              </Link>
            </div>
          </div>
        </div>

        {/* Divider + Copyright */}
        <div className="border-t border-white/10 mt-8 pt-4">
          <p className="text-white/50 text-xs text-center">
            &copy; 2026 A SQUARE ENTERTAINMENTS. ALL RIGHTS RESERVED.
          </p>
        </div>
      </div>
    </footer>
  )
}
