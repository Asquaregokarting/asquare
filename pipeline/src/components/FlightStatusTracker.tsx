
import React from 'react'
import { motion } from 'framer-motion'
import { CheckCircle2, Clock, Award } from 'lucide-react'
import HelicopterIcon from './icons/HelicopterIcon'
import type { Booking } from '../types'

interface FlightStatusTrackerProps {
    booking: Booking
}

export const FlightStatusTracker: React.FC<FlightStatusTrackerProps> = ({ booking }) => {
    // Determine current status index
    // 0: Check-In (Always done if viewing this)
    // 1: Boarding (If checkInStatus === 'boarded' or time is close)
    // 2: In Flight (If time > sessionDate)
    // 3: Landed (If time > sessionDate + duration)

    const now = new Date()
    const sessionDate = new Date(booking.sessionDate)
    // const duration = 15; // Assumption: 15 mins slot? Or 7-10 mins. Let's say 20 mins to be safe for "Landed"

    let currentStep = 0
    if (booking.checkInStatus === 'boarded') currentStep = 1

    // Time based overrides
    const minutesSinceStart = (now.getTime() - sessionDate.getTime()) / 60000

    if (minutesSinceStart > 0) currentStep = Math.max(currentStep, 2)
    if (minutesSinceStart > 15) currentStep = 3

    const steps = [
        { id: 'checkin', label: 'Check-In', icon: CheckCircle2 },
        { id: 'boarding', label: 'Boarding', icon: HelicopterIcon },
        { id: 'inflight', label: 'In Flight', icon: Clock },
        { id: 'landed', label: 'Landed', icon: Award },
    ]

    return (
        <div className="w-full py-8">
            <div className="relative flex justify-between items-center max-w-sm mx-auto">
                {/* Connecting Line */}
                <div className="absolute top-5 left-0 right-0 h-0.5 bg-white/10 -z-10">
                    <motion.div
                        className="h-full bg-yellow-500"
                        initial={{ width: '0%' }}
                        animate={{ width: `${(currentStep / (steps.length - 1)) * 100}%` }}
                        transition={{ duration: 1, delay: 0.5 }}
                    />
                </div>

                {steps.map((step, idx) => {
                    const isActive = idx <= currentStep
                    const isCurrent = idx === currentStep

                    return (
                        <div key={step.id} className="flex flex-col items-center gap-2">
                            <motion.div
                                initial={{ scale: 0.8, opacity: 0 }}
                                animate={{ scale: 1, opacity: 1 }}
                                transition={{ delay: idx * 0.2 }}
                                className={`w-10 h-10 rounded-full flex items-center justify-center border-2 transition-colors duration-500
                                    ${isActive
                                        ? 'bg-yellow-500 border-yellow-500 text-black shadow-[0_0_15px_rgba(234,179,8,0.4)]'
                                        : 'bg-black border-white/20 text-white/20'
                                    }
                                    ${isCurrent ? 'animate-pulse' : ''}
                                `}
                            >
                                <step.icon size={18} />
                            </motion.div>
                            <span className={`text-[10px] font-bold uppercase tracking-wider transition-colors duration-300 ${isActive ? 'text-yellow-500' : 'text-white/20'}`}>
                                {step.label}
                            </span>
                        </div>
                    )
                })}
            </div>

            {/* Status Text */}
            <motion.div
                key={currentStep}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                className="text-center mt-8 space-y-1"
            >
                <h3 className="text-xl font-light text-white">
                    {currentStep === 0 && "Ready for Boarding"}
                    {currentStep === 1 && "Prepare for Takeoff"}
                    {currentStep === 2 && "Enjoy the View"}
                    {currentStep === 3 && "Welcome Back, Captain"}
                </h3>
                <p className="text-xs text-neutral-500">
                    {currentStep === 0 && "Please proceed to the helipad area."}
                    {currentStep === 1 && "Follow crew instructions for safety."}
                    {currentStep === 2 && "You are cruising at 1000ft."}
                    {currentStep === 3 && "We hope you enjoyed your flight."}
                </p>
            </motion.div>
        </div>
    )
}
