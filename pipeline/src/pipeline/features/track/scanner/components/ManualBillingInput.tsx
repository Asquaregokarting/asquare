// A² Scanner — ManualBillingInput component

import { FormEvent, useState } from 'react'
import { motion } from 'framer-motion'

interface ManualBillingInputProps {
  onSubmit: (billingId: string) => void
  loading: boolean
}

export const ManualBillingInput = ({ onSubmit, loading }: ManualBillingInputProps) => {
  const [billingId, setBillingId] = useState('')

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault()
    if (billingId.trim()) {
      onSubmit(billingId.trim())
    }
  }

  return (
    <motion.form
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      onSubmit={handleSubmit}
      className="flex flex-col gap-3"
    >
      <input
        type="text"
        value={billingId}
        onChange={(e) => setBillingId(e.target.value)}
        placeholder="Enter Billing ID manually..."
        disabled={loading}
        className="w-full rounded-xl border border-gray-200 bg-white px-4 py-3.5 text-base text-gray-900 placeholder:text-gray-400 focus:border-track-accent/50 focus:outline-none disabled:opacity-50 dark:border-white/10 dark:bg-white/5 dark:text-white dark:placeholder:text-white/30"
      />
      <button
        type="submit"
        disabled={loading || !billingId.trim()}
        className="w-full rounded-xl border border-gray-200 bg-gray-50 px-4 py-3.5 text-sm font-semibold text-gray-700 active:scale-95 disabled:cursor-not-allowed disabled:opacity-50 dark:border-gray-700 dark:bg-track-surface/80 dark:text-white/70"
      >
        Look Up
      </button>
    </motion.form>
  )
}
