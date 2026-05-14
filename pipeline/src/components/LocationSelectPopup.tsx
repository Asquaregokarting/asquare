import { useState } from 'react'
import { motion } from 'framer-motion'
import { MapPin, ChevronRight, Bell } from 'lucide-react'
import { useBooking } from '../contexts/BookingContext'
import NotifyModal from './NotifyModal'
import type { Location } from '../types'
import { getLocationBySlug } from '../lib/locations'

interface LocationSelectPopupProps {
    onSelect: () => void
}

export default function LocationSelectPopup({ onSelect }: LocationSelectPopupProps) {
    const { locations, loadingLocations, setLocation } = useBooking()
    const [notifyLocation, setNotifyLocation] = useState<Location | null>(null)

    const isComingSoon = (loc: Location) => {
        if (loc.comingSoon) return true;
        const branch = getLocationBySlug(loc.name);
        return branch ? !branch.enabled : false;
    }

    const handleSelectLocation = (location: Location) => {
        if (isComingSoon(location)) {
            setNotifyLocation(location)
            return
        }
        setLocation(location.id)
        onSelect()
    }

    return (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
            {/* Backdrop */}
            <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                className="absolute inset-0 bg-dark-950/95 backdrop-blur-lg"
            />

            {/* Modal */}
            <motion.div
                initial={{ scale: 0.9, opacity: 0, y: 20 }}
                animate={{ scale: 1, opacity: 1, y: 0 }}
                className="relative bg-gradient-to-br from-dark-900 to-dark-800 border border-white/10 rounded-3xl p-6 w-full max-w-md lg:max-w-lg shadow-2xl"
            >
                {/* Header */}
                <div className="text-center mb-6">
                    <div className="w-20 h-20 bg-primary-500/20 rounded-full flex items-center justify-center mx-auto mb-4 relative">
                        <MapPin className="w-10 h-10 text-primary-400" />
                        <motion.div
                            animate={{ scale: [1, 1.3, 1], opacity: [0.5, 0, 0.5] }}
                            transition={{ repeat: Infinity, duration: 2 }}
                            className="absolute inset-0 rounded-full border-2 border-primary-500/50"
                        />
                    </div>
                    <h2 className="text-2xl font-display font-bold text-white mb-2">
                        Choose Your Location
                    </h2>
                    <p className="text-dark-400 text-sm">
                        Select your nearest A Square destination
                    </p>
                </div>

                {/* Locations List */}
                <div className="space-y-3">
                    {loadingLocations ? (
                        <div className="py-8 text-center">
                            <motion.div
                                animate={{ rotate: 360 }}
                                transition={{ repeat: Infinity, duration: 1, ease: 'linear' }}
                                className="w-8 h-8 border-2 border-primary-500 border-t-transparent rounded-full mx-auto mb-3"
                            />
                            <p className="text-dark-400 text-sm">Loading locations...</p>
                        </div>
                    ) : locations.length === 0 ? (
                        <div className="py-8 text-center">
                            <p className="text-dark-400">No locations available</p>
                        </div>
                    ) : (
                        locations.map((location, index) => (
                            <motion.button
                                key={location.id}
                                initial={{ opacity: 0, x: -20 }}
                                animate={{ opacity: 1, x: 0 }}
                                transition={{ delay: index * 0.1 }}
                                onClick={() => handleSelectLocation(location)}
                                className="w-full bg-dark-800/50 hover:bg-primary-500/10 border border-white/5 hover:border-primary-500/30 rounded-2xl p-4 flex items-center gap-4 transition-all group active:scale-[0.98]"
                            >
                                {/* Location Icon */}
                                <div className={`w-12 h-12 rounded-xl flex items-center justify-center transition-colors ${
                                    isComingSoon(location)
                                        ? 'bg-orange-500/10 group-hover:bg-orange-500/20'
                                        : 'bg-primary-500/10 group-hover:bg-primary-500/20'
                                }`}>
                                    {isComingSoon(location) ? (
                                        <Bell className="w-6 h-6 text-orange-400" />
                                    ) : (
                                        <MapPin className="w-6 h-6 text-primary-400" />
                                    )}
                                </div>

                                {/* Location Info */}
                                <div className="flex-1 text-left">
                                    <div className="flex items-center gap-2">
                                        <h3 className={`font-bold text-lg transition-colors ${
                                            isComingSoon(location)
                                                ? 'text-white group-hover:text-orange-300'
                                                : 'text-white group-hover:text-primary-300'
                                        }`}>
                                            {location.name}
                                        </h3>
                                        {isComingSoon(location) && (
                                            <span className="bg-orange-500/20 text-orange-400 text-[10px] font-bold px-2 py-0.5 rounded-full uppercase tracking-wide">
                                                Coming Soon
                                            </span>
                                        )}
                                    </div>
                                    {isComingSoon(location) ? (
                                        <p className="text-orange-400/60 text-sm">Tap to get notified</p>
                                    ) : location.address && (
                                        <p className="text-dark-400 text-sm">{location.address}</p>
                                    )}
                                </div>

                                {/* Arrow */}
                                <div className={`w-8 h-8 rounded-full flex items-center justify-center transition-colors ${
                                    isComingSoon(location)
                                        ? 'bg-dark-700 group-hover:bg-orange-500'
                                        : 'bg-dark-700 group-hover:bg-primary-500'
                                }`}>
                                    <ChevronRight className="w-4 h-4 text-dark-400 group-hover:text-white transition-colors" />
                                </div>
                            </motion.button>
                        ))
                    )}
                </div>

                {/* Racing Decoration */}
                <div className="mt-6 flex gap-1 justify-center opacity-30 overflow-hidden">
                    {[...Array(20)].map((_, i) => (
                        <div key={i} className={`w-3 h-2 ${i % 2 === 0 ? 'bg-white' : 'bg-transparent'}`} />
                    ))}
                </div>
            </motion.div>

            {/* Notify Modal — reuses the same modal as Helicopter Bookings */}
            <NotifyModal
                locationId={notifyLocation?.id ?? ''}
                locationName={notifyLocation?.name ?? ''}
                isOpen={!!notifyLocation}
                onClose={() => setNotifyLocation(null)}
            />
        </div>
    )
}
