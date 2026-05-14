import { useState } from 'react'
import SEO from '../components/SEO'
import { motion, AnimatePresence } from 'framer-motion'
import {
  Sparkles,
  Gift,
  Trophy,
  ChevronRight,
  Calendar,
  Gamepad2,
  ShoppingBag,
  Users,
  Disc,
} from 'lucide-react'
import { useGames } from '../contexts/GamesContext'
import SpinWheel from '../components/SpinWheel'
import { spinPrizes } from '../data/spinPrizes'
import type { SpinPrize, SpinResult } from '../types'

export default function SpinAndWin() {
  const { spins, useSpin: spinOnce, claimSpinPrize, earnSpin } = useGames()
  const [wonPrize, setWonPrize] = useState<SpinPrize | null>(null)
  const [currentSpinResult, setCurrentSpinResult] = useState<SpinResult | null>(null)
  const [referralMsg, setReferralMsg] = useState<string | null>(null)
  const [showReferralInput, setShowReferralInput] = useState(false)
  const [referralCode, setReferralCode] = useState('')

  const handleSpinComplete = (prize: SpinPrize) => {
    const result = spinOnce()
    if (result) {
      setWonPrize(prize)
      setCurrentSpinResult(result)
    }
  }

  const handleClaimPrize = () => {
    if (currentSpinResult) {
      claimSpinPrize(currentSpinResult.id)
      setWonPrize(null)
      setCurrentSpinResult(null)
    }
  }

  const spinSources = [
    {
      icon: Calendar,
      title: 'Daily Login',
      description: '1 spin automatically every day',
      color: 'from-blue-500 to-cyan-500',
      action: null,
    },
    {
      icon: ShoppingBag,
      title: 'First Booking',
      description: 'Get 1 spin on your first booking',
      color: 'from-orange-500 to-red-500',
      action: null,
    },
    {
      icon: Users,
      title: 'Refer Friends',
      description: 'Get 1 spin for every referral',
      color: 'from-green-500 to-emerald-500',
      action: () => setShowReferralInput(true),
    },
    {
      icon: Gamepad2,
      title: 'Play Games',
      description: '1 spin per 3 games completed',
      color: 'from-purple-500 to-pink-500',
      action: null,
    },
  ]

  const prizeTiers = [
    { tier: 'common', name: 'Common', icon: '⭐', color: 'text-blue-400', percentage: '60-70%' },
    { tier: 'grand', name: 'Grand', icon: '🎁', color: 'text-purple-400', percentage: '25-35%' },
    { tier: 'mega', name: 'Mega', icon: '🏆', color: 'text-yellow-400', percentage: '5-10%' },
  ]

  return (
    <div className="min-h-screen bg-dark-950 safe-bottom lg:max-w-4xl lg:mx-auto">
      {/* Hero Section */}
      <SEO
        title="Spin & Win"
        description="Spin the wheel and win exciting prizes at A Square GoKarting!"
        path="/spin-and-win"
        noindex
      />
      <div className="relative bg-gradient-to-br from-primary-900/20 via-dark-900 to-secondary-900/20 pt-20 pb-12 px-4 overflow-hidden">
        {/* Animated Background Elements */}
        <div className="absolute inset-0 overflow-hidden pointer-events-none">
          {[...Array(20)].map((_, i) => (
            <motion.div
              key={i}
              className="absolute w-2 h-2 bg-primary-400/20 rounded-full"
              style={{
                top: `${Math.random() * 100}%`,
                left: `${Math.random() * 100}%`,
              }}
              animate={{
                y: [0, -30, 0],
                opacity: [0.2, 0.8, 0.2],
                scale: [1, 1.5, 1],
              }}
              transition={{
                duration: 3 + Math.random() * 2,
                repeat: Infinity,
                delay: Math.random() * 2,
              }}
            />
          ))}
        </div>

        <div className="relative z-10 text-center">
          <h1 className="text-4xl font-display font-extrabold text-white mb-2">Spin & Win</h1>
          <p className="text-dark-300 mb-6">Test your luck and win amazing prizes!</p>

          {/* Available Spins Counter */}
          <div className="flex flex-col items-center gap-6">
            <motion.div
              className="inline-flex items-center gap-3 bg-gradient-to-r from-primary-500/20 to-secondary-500/20 backdrop-blur-md border border-primary-500/30 rounded-2xl px-6 py-4 shadow-glow-primary"
              whileHover={{ scale: 1.05 }}
            >
              <Sparkles className="w-8 h-8 text-primary-400" />
              <div className="text-left">
                <div className="text-3xl font-display font-bold text-white">{spins.available}</div>
                <div className="text-xs text-dark-300">Available Spins</div>
              </div>
            </motion.div>

            {/* Direct Wheel in Page */}
            <div className="w-full max-w-[280px] mx-auto scale-90 sm:scale-100 origin-center">
              <SpinWheel
                prizes={spinPrizes}
                onSpinComplete={handleSpinComplete}
                disabled={spins.available === 0}
              />
            </div>

            {spins.available === 0 && (
              <p className="text-primary-400 text-sm font-medium animate-pulse">
                Get more spins below!
              </p>
            )}
          </div>
        </div>
      </div>

      {/* Main Content */}
      <div className="p-4 space-y-6">
        {/* How to Earn More Spins */}
        <section>
          <h2 className="text-xl font-display font-bold text-white mb-4 flex items-center gap-2">
            <Gift className="w-6 h-6 text-primary-400" />
            How to Earn More Spins
          </h2>
          {referralMsg && (
            <div
              role="status"
              className="mb-3 p-3 rounded-xl text-sm font-medium text-center bg-green-500/15 text-green-400 border border-green-500/20"
            >
              {referralMsg}
            </div>
          )}
          {showReferralInput && (
            <div className="mb-3 p-3 rounded-xl bg-dark-800/60 border border-white/10">
              <p className="text-white text-sm font-medium mb-2">Enter Referral Code</p>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={referralCode}
                  onChange={(e) => setReferralCode(e.target.value.toUpperCase())}
                  placeholder="e.g. REF123ABC"
                  className="flex-1 bg-dark-900 border border-white/10 rounded-lg px-3 py-2 text-white text-sm placeholder-dark-500 focus:outline-none focus:border-primary-500"
                  autoFocus
                />
                <button
                  onClick={() => {
                    if (referralCode.trim()) {
                      earnSpin(1, 'referral')
                      setReferralMsg('Referral successful! 1 Spin added.')
                      setTimeout(() => setReferralMsg(null), 3000)
                      setShowReferralInput(false)
                      setReferralCode('')
                    }
                  }}
                  disabled={!referralCode.trim()}
                  className="px-4 py-2 bg-green-600 text-white text-sm font-bold rounded-lg disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  Apply
                </button>
                <button
                  onClick={() => {
                    setShowReferralInput(false)
                    setReferralCode('')
                  }}
                  className="px-3 py-2 text-dark-400 hover:text-white text-sm"
                >
                  Cancel
                </button>
              </div>
            </div>
          )}
          <div className="grid grid-cols-2 gap-3">
            {spinSources.map((source, idx) => (
              <motion.div
                key={idx}
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: idx * 0.1 }}
                onClick={() => source.action && source.action()}
                className={`card text-center ${source.action ? 'cursor-pointer hover:border-primary-500/50 hover:bg-white/5 active:scale-95 transition-all' : ''}`}
              >
                <div
                  className={`w-12 h-12 mx-auto mb-3 rounded-xl bg-gradient-to-br ${source.color} flex items-center justify-center`}
                >
                  <source.icon className="w-6 h-6 text-white" />
                </div>
                <h3 className="font-semibold text-white text-sm mb-1">{source.title}</h3>
                <p className="text-dark-400 text-xs">{source.description}</p>
              </motion.div>
            ))}
          </div>
        </section>

        {/* Prize Tiers */}
        <section>
          <h2 className="text-xl font-display font-bold text-white mb-4 flex items-center gap-2">
            <Trophy className="w-6 h-6 text-primary-400" />
            Prize Tiers
          </h2>
          <div className="space-y-3">
            {prizeTiers.map((tier, idx) => (
              <motion.div
                key={tier.tier}
                initial={{ opacity: 0, x: -20 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: idx * 0.1 }}
                className="card flex items-center gap-4"
              >
                <div className="text-4xl">{tier.icon}</div>
                <div className="flex-1">
                  <h3 className={`font-display font-bold text-lg ${tier.color}`}>{tier.name}</h3>
                  <p className="text-dark-400 text-xs">Win chance: {tier.percentage}</p>
                </div>
                <ChevronRight className="w-5 h-5 text-dark-500" />
              </motion.div>
            ))}
          </div>
        </section>

        {/* Recent Spins */}
        {spins.history.length > 0 && (
          <section>
            <h2 className="text-xl font-display font-bold text-white mb-4 flex items-center gap-2">
              <Disc className="w-6 h-6 text-primary-400" />
              Recent Wins
            </h2>
            <div className="space-y-2">
              {spins.history.slice(0, 10).map((spin) => (
                <motion.div
                  key={spin.id}
                  initial={{ opacity: 0, scale: 0.9 }}
                  animate={{ opacity: 1, scale: 1 }}
                  className={`card flex items-center gap-3 ${spin.claimed ? 'opacity-60' : ''}`}
                >
                  <div className="text-3xl">{spin.prize.icon}</div>
                  <div className="flex-1">
                    <h3 className="font-semibold text-white text-sm">{spin.prize.name}</h3>
                    <p className="text-dark-400 text-xs">{spin.prize.description}</p>
                  </div>
                  <div className="text-right">
                    {spin.claimed ? (
                      <span className="text-green-400 text-xs font-medium">✓ Claimed</span>
                    ) : (
                      <span className="text-primary-400 text-xs font-medium">Unclaimed</span>
                    )}
                  </div>
                </motion.div>
              ))}
            </div>
          </section>
        )}

        {/* Stats */}
        <section className="card">
          <h3 className="font-semibold text-white mb-4">Your Stats</h3>
          <div className="grid grid-cols-3 gap-4 text-center">
            <div>
              <div className="text-2xl font-bold text-primary-400">{spins.total}</div>
              <div className="text-dark-400 text-xs">Total Spins</div>
            </div>
            <div>
              <div className="text-2xl font-bold text-secondary-400">{spins.used}</div>
              <div className="text-dark-400 text-xs">Spins Used</div>
            </div>
            <div>
              <div className="text-2xl font-bold text-yellow-400">
                {spins.history.filter((s) => s.prize.tier === 'mega').length}
              </div>
              <div className="text-dark-400 text-xs">Mega Wins</div>
            </div>
          </div>
        </section>
      </div>

      {/* Prize Won Modal */}
      <AnimatePresence>
        {wonPrize && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-dark-950/95 backdrop-blur-sm z-50 flex items-center justify-center p-4"
          >
            <motion.div
              initial={{ scale: 0.5, opacity: 0, y: 50 }}
              animate={{ scale: 1, opacity: 1, y: 0 }}
              exit={{ scale: 0.5, opacity: 0, y: 50 }}
              className="w-full max-w-sm bg-dark-900 rounded-3xl p-8 border border-primary-500/30 shadow-glow-primary"
            >
              {/* Confetti effect for grand/mega prizes */}
              {(wonPrize.tier === 'grand' || wonPrize.tier === 'mega') && (
                <div className="absolute inset-0 overflow-hidden pointer-events-none">
                  {[...Array(30)].map((_, i) => (
                    <motion.div
                      key={i}
                      className="absolute w-2 h-2 bg-primary-400 rounded-full"
                      initial={{
                        top: '50%',
                        left: '50%',
                        scale: 0,
                      }}
                      animate={{
                        top: `${Math.random() * 100}%`,
                        left: `${Math.random() * 100}%`,
                        scale: [0, 1, 0],
                        opacity: [0, 1, 0],
                      }}
                      transition={{
                        duration: 2,
                        delay: Math.random() * 0.5,
                      }}
                    />
                  ))}
                </div>
              )}

              <div className="text-center relative z-10">
                <motion.div
                  initial={{ scale: 0, rotate: -180 }}
                  animate={{ scale: 1, rotate: 0 }}
                  transition={{ type: 'spring', delay: 0.2 }}
                  className="text-7xl mb-4"
                >
                  {wonPrize.icon}
                </motion.div>

                <h3 className="text-2xl font-display font-bold text-white mb-2">
                  Congratulations!
                </h3>
                <p className="text-lg font-semibold text-primary-400 mb-1">{wonPrize.name}</p>
                <p className="text-dark-300 text-sm mb-6">{wonPrize.description}</p>

                {wonPrize.type === 'tires' && (
                  <div className="bg-dark-800/50 rounded-xl p-4 mb-6">
                    <div className="text-3xl font-bold text-yellow-400">
                      +{wonPrize.value} Tires
                    </div>
                  </div>
                )}

                {wonPrize.type === 'discount' && (
                  <div className="bg-dark-800/50 rounded-xl p-4 mb-6">
                    <div className="text-3xl font-bold text-green-400">{wonPrize.value}% OFF</div>
                    <div className="text-xs text-dark-400 mt-1">On your next booking</div>
                  </div>
                )}

                <button
                  onClick={handleClaimPrize}
                  className="w-full py-4 rounded-2xl bg-gradient-to-r from-primary-500 to-secondary-500 text-white font-bold text-lg shadow-glow-primary hover:shadow-glow-secondary transition-all"
                >
                  Claim Prize
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
