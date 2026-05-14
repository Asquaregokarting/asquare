import { motion, AnimatePresence } from 'framer-motion'
import { WifiOff } from 'lucide-react'
import { useOnlineStatus } from '../hooks/useOnlineStatus'

export default function OfflineToast() {
    const { isOnline } = useOnlineStatus()

    return (
        <AnimatePresence>
            {!isOnline && (
                <motion.div
                    initial={{ y: -100, opacity: 0 }}
                    animate={{ y: 0, opacity: 1 }}
                    exit={{ y: -100, opacity: 0 }}
                    className="fixed top-0 left-0 right-0 z-[100] bg-red-500 text-white py-3 px-4 flex items-center justify-center gap-2 text-sm font-bold shadow-lg"
                >
                    <WifiOff className="w-4 h-4" />
                    No internet connection
                </motion.div>
            )}
        </AnimatePresence>
    )
}
