// A² Scanner — SerialSelector: shows select-all/deselect controls

interface SerialSelectorProps {
  total: number
  validCount: number
  selectedCount: number
  onSelectAll: () => void
  onDeselectAll: () => void
}

export const SerialSelector = ({
  total,
  validCount,
  selectedCount,
  onSelectAll,
  onDeselectAll,
}: SerialSelectorProps) => {
  const allSelected = selectedCount === validCount && validCount > 0

  return (
    <div className="flex items-center justify-between rounded-xl border border-gray-200 bg-gray-50 px-4 py-2.5 dark:border-white/10 dark:bg-white/5">
      <p className="text-sm text-gray-600 dark:text-white/60">
        <span className="font-semibold text-gray-900 dark:text-white">{selectedCount}</span> of{' '}
        <span className="font-semibold text-gray-900 dark:text-white">{total}</span> selected
        {' — '}
        <span className="text-signal-green-bright">{validCount} valid</span>
      </p>
      {validCount > 0 && (
        <button
          type="button"
          onClick={allSelected ? onDeselectAll : onSelectAll}
          className="text-xs font-medium text-track-accent-soft hover:text-track-accent"
        >
          {allSelected ? 'Deselect All' : 'Select All Valid'}
        </button>
      )}
    </div>
  )
}
