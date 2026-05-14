import { useState, useMemo, useRef, useEffect } from 'react'
import { motion, useAnimation } from 'framer-motion'
import type { SpinPrize } from '../types'

interface SpinWheelProps {
  prizes: SpinPrize[]
  onSpinComplete: (prize: SpinPrize) => void
  disabled?: boolean
}

export default function SpinWheel({ prizes, onSpinComplete, disabled = false }: SpinWheelProps) {
  const [isSpinning, setIsSpinning] = useState(false)
  const controls = useAnimation()
  const [currentRotation, setCurrentRotation] = useState(0)

  const segmentAngle = 360 / prizes.length

  // Generate SVG paths for each segment
  const segments = useMemo(() => {
    return prizes.map((prize, i) => {
      const startAngle = i * segmentAngle
      const endAngle = (i + 1) * segmentAngle

      // Convert polar to cartesian
      const x1 = 50 + 50 * Math.cos((Math.PI * (startAngle - 90)) / 180)
      const y1 = 50 + 50 * Math.sin((Math.PI * (startAngle - 90)) / 180)
      const x2 = 50 + 50 * Math.cos((Math.PI * (endAngle - 90)) / 180)
      const y2 = 50 + 50 * Math.sin((Math.PI * (endAngle - 90)) / 180)

      // Path: Move to center, Line to first point, Arc to second point, Close
      const largeArcFlag = segmentAngle > 180 ? 1 : 0
      const pathData = `M 50 50 L ${x1} ${y1} A 50 50 0 ${largeArcFlag} 1 ${x2} ${y2} Z`

      // Text rotation
      const textAngle = startAngle + segmentAngle / 2

      return {
        pathData,
        textAngle,
        ...prize,
      }
    })
  }, [prizes, segmentAngle])

  const handleSpin = async () => {
    if (isSpinning || disabled) return

    setIsSpinning(true)

    // Calculate random final rotation (5-10 full spins + random position)
    const extraSpins = 5 + Math.floor(Math.random() * 5)
    const randomAngle = Math.random() * 360
    const newRotation = currentRotation + extraSpins * 360 + randomAngle

    // Animate
    await controls.start({
      rotate: newRotation,
      transition: {
        duration: 5,
        ease: [0.25, 0.1, 0.25, 1],
      },
    })

    setCurrentRotation(newRotation)

    // Determine winner
    // (360 - rotation % 360) gives the angle at the top pointer (12 o'clock)
    const finalNormalizedAngle = (360 - (newRotation % 360)) % 360
    const winningIndex = Math.floor(finalNormalizedAngle / segmentAngle) % prizes.length
    const winningPrize = prizes[winningIndex]

    setIsSpinning(false)
    onSpinComplete(winningPrize)
  }

  return (
    <div className="relative w-full max-w-sm md:max-w-md lg:max-w-lg mx-auto">
      {/* Wheel Container */}
      <div className="relative aspect-square">
        {/* Pointer/Arrow at top */}
        <div className="absolute top-0 left-1/2 -translate-x-1/2 -translate-y-4 z-30">
          <motion.div
            animate={isSpinning ? { y: [0, 5, 0] } : {}}
            transition={{ repeat: Infinity, duration: 0.2 }}
            className="w-0 h-0 border-l-[15px] border-l-transparent border-r-[15px] border-r-transparent border-t-[25px] border-t-primary-500 drop-shadow-glow-primary"
          />
        </div>

        {/* The Spinning Wheel (SVG based) */}
        <motion.div
          className="w-full h-full rounded-full shadow-2xl relative z-10"
          animate={controls}
          initial={{ rotate: 0 }}
        >
          <svg viewBox="0 0 100 100" className="w-full h-full overflow-visible">
            {/* Outer Glow */}
            <defs>
              <filter id="glow" x="-20%" y="-20%" width="140%" height="140%">
                <feGaussianBlur stdDeviation="2" result="blur" />
                <feComposite in="SourceGraphic" in2="blur" operator="over" />
              </filter>
            </defs>

            {/* Segments */}
            {segments.map((seg, i) => (
              <g key={seg.id}>
                <path
                  d={seg.pathData}
                  fill={i % 2 === 0 ? 'var(--dark-900)' : 'var(--dark-700)'}
                  stroke="var(--dark-500)"
                  strokeWidth="0.5"
                  className="transition-colors duration-300"
                />
                {/* Label and Icon Group */}
                <g transform={`rotate(${seg.textAngle}, 50, 50)`}>
                  <text
                    x="50"
                    y="20"
                    textAnchor="middle"
                    className="wheel-text"
                    transform="rotate(-90, 50, 20)"
                  >
                    <tspan dy="-1">{seg.icon}</tspan>
                    <tspan x="50" dy="4">
                      {seg.name}
                    </tspan>
                  </text>
                </g>
              </g>
            ))}

            {/* Outer Ring Decoration */}
            <circle
              cx="50"
              cy="50"
              r="49"
              fill="none"
              stroke="#ef4444"
              strokeWidth="1"
              strokeOpacity="0.3"
            />
            <circle
              cx="50"
              cy="50"
              r="48"
              fill="none"
              stroke="#ef4444"
              strokeWidth="0.5"
              strokeOpacity="0.1"
            />
          </svg>

          {/* Center Decoration / Image */}
          <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-24 h-24 md:w-28 md:h-28 lg:w-32 lg:h-32 rounded-full bg-dark-900 border-4 border-primary-500 shadow-glow-primary z-20 flex items-center justify-center overflow-hidden">
            <img
              src="/gokart.webp"
              alt="Go Kart"
              className={`w-16 h-16 object-contain transition-transform duration-300 ${isSpinning ? 'scale-110' : 'scale-100'}`}
            />
          </div>
        </motion.div>

        {/* Light decorations around the wheel */}
        {[...Array(12)].map((_, i) => (
          <WheelLight key={i} index={i} />
        ))}
      </div>

      {/* Spin Button */}
      <motion.button
        onClick={handleSpin}
        disabled={disabled || isSpinning}
        className={`mt-10 w-full py-4 lg:py-5 rounded-2xl font-display font-bold text-lg lg:text-xl transition-all ${
          disabled || isSpinning
            ? 'bg-dark-700 text-dark-500 cursor-not-allowed'
            : 'bg-gradient-to-r from-primary-500 to-secondary-500 text-white shadow-glow-primary hover:shadow-glow-secondary'
        }`}
        whileTap={!disabled && !isSpinning ? { scale: 0.95 } : {}}
      >
        {isSpinning ? (
          <span className="flex items-center justify-center gap-2">
            <motion.div
              className="w-5 h-5 border-3 border-white border-t-transparent rounded-full"
              animate={{ rotate: 360 }}
              transition={{ duration: 1, repeat: Infinity, ease: 'linear' }}
            />
            Spinning...
          </span>
        ) : disabled ? (
          'No Spins Available'
        ) : (
          'SPIN THE WHEEL'
        )}
      </motion.button>
    </div>
  )
}

function WheelLight({ index }: { index: number }) {
  const lightRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (lightRef.current) {
      const top = `${50 + 52 * Math.sin((index * 30 * Math.PI) / 180)}%`
      const left = `${50 + 52 * Math.cos((index * 30 * Math.PI) / 180)}%`
      lightRef.current.style.setProperty('--light-top', top)
      lightRef.current.style.setProperty('--light-left', left)
    }
  }, [index])

  return <div ref={lightRef} className="wheel-light" />
}
