import { useEffect, useMemo } from 'react'
import { motion } from 'framer-motion'
import { resolveLocation } from '../../../../../lib/locations'
import { SCANNER_LOCATIONS, ScannerLocation } from '../types/scanner.types'
import { useLocations } from '../../../../hooks/useLocations'

interface LocationSelectProps {
  selectedLocation: ScannerLocation | null
  onSelect: (location: ScannerLocation) => void
}

export const LocationSelect = ({ selectedLocation, onSelect }: LocationSelectProps) => {
  const { isRoleLocked, allowedSlugs } = useLocations()

  // Filter scanner locations to only those the user has access to
  const visibleLocations = useMemo(() => {
    if (!isRoleLocked) return SCANNER_LOCATIONS
    return SCANNER_LOCATIONS.filter((name) => {
      const loc = resolveLocation(name)
      return loc && allowedSlugs.includes(loc.slug)
    })
  }, [isRoleLocked, allowedSlugs])

  // Auto-select for restricted roles with exactly one location
  useEffect(() => {
    if (isRoleLocked && visibleLocations.length === 1 && selectedLocation !== visibleLocations[0]) {
      onSelect(visibleLocations[0])
    }
  }, [isRoleLocked, visibleLocations, selectedLocation, onSelect])

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      className="flex min-h-[45vh] flex-col justify-center gap-6"
    >
      <div className="text-center">
        <p className="text-xs font-semibold uppercase tracking-[0.28em] text-track-accent-soft/70">
          Track Scanner
        </p>
        <h2 className="mt-3 text-3xl font-semibold text-gray-900 dark:text-white">
          Select Location
        </h2>
        <p className="mt-2 text-sm text-gray-500 dark:text-white/50">
          {isRoleLocked
            ? 'Your location is assigned by your role.'
            : 'Choose the operating location before starting or joining the day\u2019s shift.'}
        </p>
      </div>

      <div className="grid gap-3">
        {visibleLocations.map((location) => {
          const active = selectedLocation === location
          return (
            <button
              key={location}
              type="button"
              onClick={() => onSelect(location)}
              className={`rounded-2xl border px-5 py-4 text-left transition-all ${
                active
                  ? 'border-track-accent/60 bg-track-accent/12 shadow-lg shadow-track-accent/15'
                  : 'border-gray-200 bg-gray-50 hover:border-track-accent/35 hover:bg-gray-100 dark:border-white/10 dark:bg-track-surface/80 dark:hover:bg-white/10'
              }`}
            >
              <div className="flex items-center justify-between gap-4">
                <div>
                  <p className="text-lg font-semibold text-gray-900 dark:text-white">{location}</p>
                  <p className="mt-1 text-xs text-gray-500 dark:text-white/45">
                    {isRoleLocked
                      ? 'Your assigned location'
                      : 'Location-specific shifts and scan history are managed independently.'}
                  </p>
                </div>
                <span
                  className={`text-sm font-medium ${active ? 'text-track-accent-soft' : 'text-gray-400 dark:text-white/40'}`}
                >
                  {active ? 'Selected' : 'Choose'}
                </span>
              </div>
            </button>
          )
        })}
      </div>
    </motion.div>
  )
}
