import { Link } from 'react-router-dom'
import { Instagram, ArrowRight, Zap } from 'lucide-react'
import ElectricBorder from './reactbits/ElectricBorder'
import './reactbits/ElectricBorder.css'

const InfluencerBanner = () => (
  <ElectricBorder color="var(--instagram)" speed={1.5} chaos={0.12} borderRadius={16}>
    <div className="bg-dark-700 rounded-2xl p-5 sm:p-6">
      <div className="flex flex-col sm:flex-row sm:items-center gap-4">
        {/* Left */}
        <div className="flex items-start gap-3 flex-1 min-w-0">
          <div className="shrink-0 h-12 w-12 rounded-xl bg-instagram/10 flex items-center justify-center">
            <Instagram size={22} className="text-instagram" />
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-2 mb-1">
              <h3 className="text-base sm:text-lg font-black text-white uppercase tracking-tight">
                Are you an Influencer?
              </h3>
              <Zap size={16} className="text-secondary-500 shrink-0" />
            </div>
            <p className="text-xs sm:text-sm text-white/40 leading-relaxed">
              Create reels about your GoKarting experience and earn up to{' '}
              <span className="text-instagram font-bold">₹10,000</span> per reel based on views.
            </p>
          </div>
        </div>

        {/* Right CTA */}
        <Link
          to="/influencer-portal"
          className="shrink-0 flex items-center justify-center gap-2 px-6 py-3 rounded-lg bg-instagram text-white text-sm font-bold uppercase tracking-wider shadow-lg shadow-instagram/20 hover:bg-instagram-700 hover:shadow-instagram/30 active:scale-[0.98] transition-all cursor-pointer"
        >
          <Instagram size={16} />
          Join Kartfluencer
          <ArrowRight size={14} />
        </Link>
      </div>
    </div>
  </ElectricBorder>
)

export default InfluencerBanner
