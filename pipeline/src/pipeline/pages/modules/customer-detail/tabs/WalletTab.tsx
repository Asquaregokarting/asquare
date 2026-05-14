import { customerWalletApi } from '../../../../api/customer-detail/customer-balance-history'
import { BalanceHistoryTab } from './BalanceHistoryTab'

const fmtCurrency = (n: number) => `INR ${Math.round(n || 0).toLocaleString('en-IN')}`

export const WalletTab = ({ customerId }: { customerId: string }) => (
  <BalanceHistoryTab
    customerId={customerId}
    fetcher={customerWalletApi.listTransactions}
    kind="wallet"
    formatAmount={fmtCurrency}
    balanceLabel="Wallet balance"
  />
)
