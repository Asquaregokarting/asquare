import { ModulePageLayout } from '../../components/layout/ModulePageLayout'
import { useAuth } from '../../features/auth/auth-context'
import { isPrivilegedRole } from '../../api/firestore-session'
import CouponOutreachInboxView from './coupon-outreach/CouponOutreachInboxView'
import CouponOutreachBatchView from './coupon-outreach/CouponOutreachBatchView'
import CouponOutreachHistoryView from './coupon-outreach/CouponOutreachHistoryView'

export type CouponOutreachView = 'inbox' | 'batch' | 'history'

const titleMap: Record<CouponOutreachView, string> = {
  inbox: 'My ₹150 Coupon Calls',
  batch: "Today's Batch",
  history: 'Batch History',
}

const subtitleMap: Record<CouponOutreachView, string> = {
  inbox:
    'Your daily list of customers who are sitting on unused ₹150 coupons. Call, log the outcome, move on.',
  batch:
    'Distribution across active telecallers, manual run trigger, and config for the daily 10:30 AM IST job.',
  history: 'Past 60 daily outreach batches.',
}

const CouponOutreachModule = ({ view }: { view: CouponOutreachView }) => {
  const { session } = useAuth()
  const role = session?.user.role
  const isAdmin = role ? isPrivilegedRole(role) : false

  const subnav = [
    { label: 'My Calls', to: '/coupon-outreach/inbox' },
    ...(isAdmin
      ? [
          { label: "Today's Batch", to: '/coupon-outreach/batch' },
          { label: 'History', to: '/coupon-outreach/history' },
        ]
      : []),
  ]

  return (
    <ModulePageLayout
      moduleTab="CouponOutreach"
      title={titleMap[view]}
      subtitle={subtitleMap[view]}
      breadcrumbs={['Pipeline', 'Coupon Outreach', titleMap[view]]}
      subnav={subnav}
    >
      {view === 'inbox' && <CouponOutreachInboxView />}
      {view === 'batch' && <CouponOutreachBatchView />}
      {view === 'history' && <CouponOutreachHistoryView />}
    </ModulePageLayout>
  )
}

export default CouponOutreachModule
