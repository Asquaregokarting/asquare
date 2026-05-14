import { customerTiresApi } from '../../../../api/customer-detail/customer-balance-history'
import { BalanceHistoryTab } from './BalanceHistoryTab'

const fmtTires = (n: number) => `${Math.round(n || 0)} pts`

interface Props {
  customerId: string
  /** Authoritative tire balance from the parent users/{uid}.tires field. */
  tiresBalance: number
}

export const TiresTab = ({ customerId, tiresBalance }: Props) => (
  <BalanceHistoryTab
    customerId={customerId}
    fetcher={customerTiresApi.listTransactions}
    kind="tires"
    formatAmount={fmtTires}
    balanceLabel="Tire points"
    balanceOverride={tiresBalance}
  />
)
