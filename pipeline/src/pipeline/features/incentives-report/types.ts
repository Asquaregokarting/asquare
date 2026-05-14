export interface CashierMonthlyRow {
  branchId: string
  branchName: string
  cashierId: string
  cashierName: string
  qualifyingTxns: number
  totalItemAmount: number
  byNonPerforming: number
  byGokartLaps: number
  byBoth: number
  totalIncentive: number
}

export interface TelecallerMonthlyRow {
  telecallerId: string
  telecallerName: string
  hasPlan: boolean
  bookingCount: number
  bookedAmount: number
  targetAmount: number
  achievementPercent: number
  incentivePercentUsed: number
  incentiveEarned: number
}

export interface BranchSummaryRow {
  branchId: string
  branchName: string
  cashierIncentive: number
  telecallerIncentive: number
  total: number
}

export interface MonthlyReportPayload {
  monthKey: string
  monthLabel: string
  branchLabel: string
  generatedAt: string
  generatedByName: string
  cashiers: CashierMonthlyRow[]
  telecallers: TelecallerMonthlyRow[]
  branchSummary: BranchSummaryRow[]
}
