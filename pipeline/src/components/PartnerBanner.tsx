import { Users, ArrowRight, Download } from 'lucide-react'
import SpotlightCard from './reactbits/SpotlightCard'
import './reactbits/SpotlightCard.css'

const PIPELINE_DOMAIN = window.location.hostname.includes('localhost')
  ? 'http://pipeline.localhost:5173'
  : 'https://pipeline.asquaregokarting.com'

const PartnerBanner = () => (
  <SpotlightCard spotlightColor="rgba(0, 102, 255, 0.25)" className="rounded-2xl">
    <div className="bg-dark-700 rounded-2xl p-5 sm:p-6">
      <div className="flex flex-col sm:flex-row sm:items-center gap-4">
        {/* Left */}
        <div className="flex items-start gap-3 flex-1 min-w-0">
          <div className="shrink-0 h-12 w-12 rounded-xl bg-primary-500/10 flex items-center justify-center">
            <Users size={22} className="text-primary-500" />
          </div>
          <div className="min-w-0">
            <h3 className="text-base sm:text-lg font-black text-white uppercase tracking-tight mb-1">
              Partner with Us
            </h3>
            <p className="text-xs sm:text-sm text-white/40 leading-relaxed">
              Become an A Square GoKarting franchise partner. Download our{' '}
              <span className="text-primary-500 font-semibold">Srikakulam project brochure</span>.
            </p>
          </div>
        </div>

        {/* Right CTAs */}
        <div className="flex items-center gap-2 shrink-0">
          <a
            href={`${PIPELINE_DOMAIN}/third-party`}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-2 px-5 py-3 rounded-lg bg-primary-500 text-white text-sm font-bold uppercase tracking-wider shadow-lg shadow-primary-500/20 hover:bg-primary-600 hover:shadow-primary-500/30 active:scale-[0.98] transition-all cursor-pointer"
          >
            Become a Partner
            <ArrowRight size={14} />
          </a>
          <a
            href="/brochure-srikakulam.pdf"
            download
            className="flex items-center gap-2 px-5 py-3 rounded-lg border border-white/10 bg-white/[0.03] text-white text-sm font-bold uppercase tracking-wider hover:bg-white/[0.06] active:scale-[0.98] transition-all cursor-pointer"
          >
            <Download size={14} />
            Brochure
          </a>
        </div>
      </div>
    </div>
  </SpotlightCard>
)

export default PartnerBanner
