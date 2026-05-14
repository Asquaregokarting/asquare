import React, { useRef, useState } from 'react'
import { motion } from 'framer-motion'
import { Download, Award } from 'lucide-react'
import type { Booking } from '../types'
import { fmtDateIST } from '../lib/date-format'
import stardustBg from '../assets/stardust.png'
import signatureImg from '../assets/signature.svg'
import { logger } from '../lib/logger'

interface FlightCertificateProps {
  booking: Booking
  passengerName: string
}

/**
 * Sanitize a name for safe use as a filename across platforms.
 * Removes / replaces characters invalid in filenames, collapses
 * consecutive non-alphanumeric chars to single dashes, and trims.
 */
function sanitizeFilename(name: string): string {
  const safe = name
    .replace(/[/\\<>:*?"| ]+/g, '-') // replace invalid chars & spaces with dash
    .replace(/-{2,}/g, '-') // collapse consecutive dashes
    .replace(/^-+|-+$/g, '') // trim leading/trailing dashes
  return safe || 'Guest'
}

/**
 * Safely format a booking date. Returns a readable string
 * or a fallback if the date is missing / invalid.
 */
function formatSessionDate(sessionDate: unknown): string {
  if (!sessionDate) return 'Date TBD'
  try {
    const date =
      sessionDate instanceof Date ? sessionDate : new Date(sessionDate as string | number)
    if (isNaN(date.getTime())) return 'Date TBD'
    return fmtDateIST(date)
  } catch {
    return 'Date TBD'
  }
}

export const FlightCertificate: React.FC<FlightCertificateProps> = ({ booking, passengerName }) => {
  const certRef = useRef<HTMLDivElement>(null)
  const [isDownloading, setIsDownloading] = useState(false)

  const handleDownload = async () => {
    if (!certRef.current) return
    setIsDownloading(true)
    try {
      // Lazy-load html2canvas (~900 KB minified) only when the user actually
      // taps download. Previously this was a top-level import bundled into
      // the main customer chunk for every page that touches FlightCertificate.
      const { default: html2canvas } = await import('html2canvas')
      const canvas = await html2canvas(certRef.current, {
        scale: 2,
        backgroundColor: null,
        useCORS: true,
      })
      const url = canvas.toDataURL('image/png')
      const link = document.createElement('a')
      link.href = url
      link.download = `Certificate-${sanitizeFilename(passengerName)}.png`
      link.click()
    } catch (err) {
      logger.error('flight_certificate.download_failed', err)
    } finally {
      setIsDownloading(false)
    }
  }

  const dateStr = formatSessionDate(booking.sessionDate)

  return (
    <div className="flex flex-col items-center gap-6 w-full max-w-2xl lg:max-w-3xl mx-auto p-4 md:p-6 lg:p-8">
      {/* Certificate Container */}
      <motion.div
        initial={{ scale: 0.9, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={{ duration: 0.8, type: 'spring' }}
        className="relative w-full aspect-[1.414/1] bg-dark-900 rounded-xl overflow-hidden shadow-2xl border-4 border-double border-yellow-600/40 p-1"
      >
        <div
          ref={certRef}
          className="w-full h-full relative flex flex-col items-center justify-center text-center p-8 md:p-12 lg:p-16 bg-black border border-yellow-500/20"
        >
          {/* Background Texture — local asset */}
          <div
            className="absolute inset-0 opacity-20 pointer-events-none"
            style={{ backgroundImage: `url(${stardustBg})` }}
          />
          <div className="absolute inset-0 bg-gradient-to-br from-yellow-900/10 via-black to-yellow-900/10 pointer-events-none" />

          {/* Border Frame */}
          <div className="absolute inset-4 border border-yellow-500/30 pointer-events-none" />
          <div className="absolute inset-5 border border-yellow-500/10 pointer-events-none" />

          {/* Content */}
          <div className="relative z-10 space-y-4 md:space-y-6">
            <Award className="w-12 h-12 md:w-16 md:h-16 lg:w-20 lg:h-20 text-yellow-500 mx-auto opacity-80" />

            <div className="space-y-2">
              <h4 className="text-yellow-500 uppercase tracking-[0.3em] text-[10px] md:text-sm font-bold">
                Official Document
              </h4>
              <h1 className="text-3xl md:text-5xl lg:text-6xl font-serif text-white text-transparent bg-clip-text bg-gradient-to-r from-yellow-200 via-yellow-400 to-yellow-200">
                Certificate of Ascent
              </h1>
            </div>

            <p className="text-neutral-400 text-xs md:text-sm max-w-md mx-auto leading-relaxed">
              This certifies that
            </p>

            <div className="py-2 border-b border-white/10 w-full max-w-md mx-auto">
              <h2 className="text-2xl md:text-4xl lg:text-5xl font-cursive text-white italic">
                {passengerName || 'Valued Guest'}
              </h2>
            </div>

            <p className="text-neutral-400 text-xs md:text-sm max-w-md mx-auto leading-relaxed pt-2">
              Successfully completed a high-altitude helicopter flight over the city skyline.
            </p>

            <div className="flex justify-between items-end w-full max-w-md mx-auto pt-8 border-t border-white/5 mt-8">
              <div className="text-left">
                <p className="text-[10px] text-neutral-500 uppercase tracking-wider">Date</p>
                <p className="text-white font-serif">{dateStr}</p>
              </div>
              <div className="text-right">
                {/* Signature — local asset */}
                <img
                  src={signatureImg}
                  alt=""
                  className="h-8 md:h-12 w-24 md:w-32 object-contain ml-auto opacity-50 filter invert"
                />
                <p className="text-[10px] text-neutral-500 uppercase tracking-wider mt-1">
                  Chief Pilot
                </p>
              </div>
            </div>
          </div>
        </div>
      </motion.div>

      {/* Actions */}
      <div className="flex gap-4">
        <button
          onClick={handleDownload}
          disabled={isDownloading}
          className="flex items-center gap-2 bg-yellow-500 text-black px-6 py-3 rounded-xl font-bold hover:bg-yellow-400 transition-colors shadow-[0_0_20px_rgba(234,179,8,0.2)]"
        >
          {isDownloading ? (
            <div className="w-5 h-5 border-2 border-black/30 border-t-black rounded-full animate-spin" />
          ) : (
            <Download size={20} />
          )}
          <span>Download Certificate</span>
        </button>
      </div>
    </div>
  )
}
