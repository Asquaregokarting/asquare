import { useCallback, useEffect, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  LogOut,
  Film,
  Wallet,
  User,
  Home,
  Eye,
  Bell,
  ExternalLink,
  IndianRupee,
  TrendingUp,
} from 'lucide-react'
import { QRCodeSVG } from 'qrcode.react'
import { kartfluencerApi } from '../api/kartfluencer'
import { VIEW_PAYMENT_TIERS, KARTFLUENCER_TIERS } from '../api/kartfluencer-firestore'
import type {
  KartfluencerRecord,
  KartfluencerReel,
  KartfluencerNotification,
  KartfluencerWalletTransaction,
} from '../api/types'
import KartfluencerLandingPage from './KartfluencerLandingPage'
import ProfileCard from '../components/portal/ProfileCard'
import Stepper, { Step } from '../components/portal/Stepper'
import { Card, CardContent, CardHeader, CardTitle } from '../components/portal/card'
import { Button } from '../components/portal/button'
import { Input } from '../components/portal/input'
import { Badge, type BadgeVariant } from '../components/portal/badge'
import { Skeleton } from '../components/portal/skeleton'
import { Separator } from '../components/portal/separator'
import { Avatar, AvatarFallback, AvatarImage } from '../components/portal/avatar'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '../components/portal/dialog'

// ─── Session ────────────────────────────────────────────────────

const SESSION_KEY = 'kartfluencer_session'
interface InfluencerSession {
  influencerId: string
  token: string
  handle: string
}
const getSession = (): InfluencerSession | null => {
  try {
    return JSON.parse(sessionStorage.getItem(SESSION_KEY) ?? 'null')
  } catch {
    return null
  }
}
const saveSession = (s: InfluencerSession) => sessionStorage.setItem(SESSION_KEY, JSON.stringify(s))
const clearSession = () => sessionStorage.removeItem(SESSION_KEY)

type PortalTab = 'dashboard' | 'reels' | 'wallet' | 'notifications' | 'profile'

// ─── Main Component ─────────────────────────────────────────────

const KartfluencerPortalPage = () => {
  const [session, setSessionState] = useState<InfluencerSession | null>(getSession)
  const [activeTab, setActiveTab] = useState<PortalTab>('dashboard')

  const login = (s: InfluencerSession) => {
    saveSession(s)
    setSessionState(s)
  }
  const logout = () => {
    clearSession()
    setSessionState(null)
  }

  const handleRegister = (record: KartfluencerRecord) => {
    const tk = `mock-portal-${Date.now()}`
    login({ influencerId: record.id, token: tk, handle: record.instagramHandle })
  }

  // ─── Landing Page (not logged in) ─────────────────────────────

  if (!session) {
    return <KartfluencerLandingPage onRegister={handleRegister} />
  }

  // ─── Logged-In Portal ─────────────────────────────────────────

  return (
    <div className="min-h-screen bg-portal-panel text-white flex flex-col">
      <header className="sticky top-0 z-20 bg-portal-panel/90 backdrop-blur-xl border-b border-white/[0.06] px-4 py-3">
        <div className="max-w-lg mx-auto flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <img src="/asquare-logo.webp" alt="A Square" className="h-8 w-8 object-contain" />
            <span className="text-sm font-bold tracking-tight">{session.handle}</span>
          </div>
          <button
            type="button"
            onClick={logout}
            className="text-white/30 hover:text-white/60 transition-colors cursor-pointer"
            aria-label="Log out"
          >
            <LogOut size={18} />
          </button>
        </div>
      </header>
      <main className="flex-1 px-4 py-5 max-w-lg mx-auto w-full">
        <AnimatePresence mode="wait">
          <motion.div
            key={activeTab}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.15 }}
          >
            {activeTab === 'dashboard' && (
              <PortalDashboard session={session} onNavigate={setActiveTab} />
            )}
            {activeTab === 'reels' && <PortalReels session={session} />}
            {activeTab === 'wallet' && <PortalWallet session={session} />}
            {activeTab === 'notifications' && <PortalNotifications session={session} />}
            {activeTab === 'profile' && <PortalProfile session={session} />}
          </motion.div>
        </AnimatePresence>
      </main>
      <nav className="sticky bottom-0 z-20 bg-portal-panel/95 backdrop-blur-xl border-t border-white/[0.06] px-2 py-2">
        <div className="max-w-lg mx-auto flex justify-around">
          {(
            [
              ['dashboard', 'Home', Home],
              ['reels', 'Reels', Film],
              ['wallet', 'Wallet', Wallet],
              ['notifications', 'Updates', Bell],
              ['profile', 'Profile', User],
            ] as const
          ).map(([id, label, Icon]) => (
            <button
              key={id}
              type="button"
              onClick={() => setActiveTab(id)}
              className={`flex flex-col items-center gap-0.5 py-1 px-3 rounded-xl transition-all cursor-pointer ${activeTab === id ? 'text-instagram scale-105' : 'text-white/25 hover:text-white/45'}`}
            >
              <Icon size={19} />
              <span className="text-[9px] font-medium">{label}</span>
            </button>
          ))}
        </div>
      </nav>
    </div>
  )
}

// ─── Portal Tab Components ──────────────────────────────────────

const JOURNEY_STEPS = ['detailed', 'visited', 'reel_submitted', 'verified', 'active'] as const
const JOURNEY_LABELS = ['Registered', 'Visited', 'Reel Sent', 'Verified', 'Active'] as const

const PortalDashboard = ({
  session,
  onNavigate,
}: {
  session: InfluencerSession
  onNavigate: (tab: PortalTab) => void
}) => {
  const [p, setP] = useState<KartfluencerRecord | null>(null)
  const [ld, setLd] = useState(true)
  useEffect(() => {
    kartfluencerApi
      .getPublic(session.influencerId)
      .then(setP)
      .catch(() => {})
      .finally(() => setLd(false))
  }, [session])

  if (ld) return <DashboardSkeleton />
  if (!p) return <Err text="Could not load profile." />

  const idx = JOURNEY_STEPS.indexOf(p.status as (typeof JOURNEY_STEPS)[number])
  const stepperStep = idx >= 0 ? Math.min(idx + 1, JOURNEY_STEPS.length) : 1

  const nextStepCard = () => {
    switch (p.status) {
      case 'detailed':
        return (
          <Card className="border-instagram/20">
            <CardContent className="p-5 space-y-4">
              <div className="flex items-center gap-2">
                <span className="w-2 h-2 rounded-full bg-instagram animate-pulse" />
                <p className="text-xs font-bold text-instagram uppercase tracking-wider">
                  Next Step
                </p>
              </div>
              <h3 className="text-base font-black">
                Visit {p.branchName || 'Your Nearest Branch'}
              </h3>
              <p className="text-xs text-portal-muted leading-relaxed">
                Head to the branch and show your QR code at the track. Our TrackMarshall will scan
                it to verify your visit.
              </p>
              {p.qrCode && (
                <div className="flex justify-center bg-white rounded-xl p-4">
                  <QRCodeSVG value={p.qrCode} size={140} level="M" />
                </div>
              )}
              <p className="text-[10px] text-portal-muted/50 text-center">
                Show this QR code to the TrackMarshall at the track
              </p>
            </CardContent>
          </Card>
        )
      case 'visited':
        return (
          <Card className="border-emerald-500/20">
            <CardContent className="p-5 space-y-4">
              <div className="flex items-center gap-2">
                <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
                <p className="text-xs font-bold text-emerald-400 uppercase tracking-wider">
                  Next Step
                </p>
              </div>
              <h3 className="text-base font-black">Create Your Reel</h3>
              <p className="text-xs text-portal-muted leading-relaxed">
                You've visited! Now create an Instagram reel about your GoKarting experience and
                submit the link.
              </p>
              <Button className="w-full" onClick={() => onNavigate('reels')}>
                Go to Reels
              </Button>
            </CardContent>
          </Card>
        )
      case 'reel_submitted':
        return (
          <Card className="border-amber-500/20">
            <CardContent className="p-5 space-y-3">
              <div className="flex items-center gap-2">
                <span className="w-2 h-2 rounded-full bg-amber-500 animate-pulse" />
                <p className="text-xs font-bold text-amber-400 uppercase tracking-wider">
                  Under Review
                </p>
              </div>
              <h3 className="text-base font-black">Reel Submitted</h3>
              <p className="text-xs text-portal-muted leading-relaxed">
                Your reel is being reviewed by our team. We'll verify it within 24-48 hours and
                update your status.
              </p>
            </CardContent>
          </Card>
        )
      case 'verified':
        return (
          <Card className="border-emerald-500/20">
            <CardContent className="p-5 space-y-4">
              <div className="flex items-center gap-2">
                <span className="w-2 h-2 rounded-full bg-emerald-500" />
                <p className="text-xs font-bold text-emerald-400 uppercase tracking-wider">
                  Earning Active
                </p>
              </div>
              <h3 className="text-base font-black">You're Earning!</h3>
              <p className="text-xs text-portal-muted leading-relaxed">
                Your reel is verified and earning. Views are tracked and updated by our team
                periodically.
              </p>
              <Button variant="success" className="w-full" onClick={() => onNavigate('wallet')}>
                View Wallet
              </Button>
            </CardContent>
          </Card>
        )
      case 'active':
        return (
          <Card className="border-instagram/20">
            <CardContent className="p-5 space-y-4">
              <div className="flex items-center gap-2">
                <span className="w-2 h-2 rounded-full bg-instagram" />
                <p className="text-xs font-bold text-instagram uppercase tracking-wider">Active</p>
              </div>
              <h3 className="text-base font-black">Keep Creating</h3>
              <p className="text-xs text-portal-muted leading-relaxed">
                Submit more reels to earn more. Each reel earns based on view milestones.
              </p>
              <Button className="w-full" onClick={() => onNavigate('reels')}>
                Submit New Reel
              </Button>
            </CardContent>
          </Card>
        )
      default:
        return null
    }
  }

  return (
    <div className="space-y-5">
      {/* Header with profile pic */}
      <div className="flex items-center gap-3">
        <Avatar className="h-12 w-12 border-2 border-instagram/30">
          {p.profilePictureUrl ? (
            <AvatarImage src={p.profilePictureUrl} alt={p.instagramHandle} />
          ) : (
            <AvatarFallback>
              <User size={20} />
            </AvatarFallback>
          )}
        </Avatar>
        <div>
          <h1 className="text-lg font-black uppercase">Welcome back!</h1>
          <p className="text-sm text-portal-muted">
            {p.instagramHandle} · {p.branchName}
          </p>
        </div>
      </div>

      {/* Wallet hero */}
      <Card className="bg-instagram/10 border-instagram/20">
        <CardContent className="p-5">
          <div className="flex justify-between items-center mb-2">
            <span className="text-[10px] text-portal-muted uppercase tracking-wider font-bold">
              Wallet
            </span>
            <Wallet size={14} className="text-instagram/60" />
          </div>
          <p className="text-3xl font-black">₹{(p.walletBalance ?? 0).toLocaleString()}</p>
          <div className="flex gap-4 mt-1.5 text-[11px] text-portal-muted">
            <span>Earned: ₹{(p.totalEarned ?? 0).toLocaleString()}</span>
            <span>Withdrawn: ₹{(p.totalWithdrawn ?? 0).toLocaleString()}</span>
          </div>
        </CardContent>
      </Card>

      {/* Animated journey stepper (read-only) */}
      <div>
        <p className="text-[10px] text-portal-muted uppercase tracking-wider font-bold mb-2 px-1">
          Journey
        </p>
        <Stepper initialStep={stepperStep} hideFooter disableStepIndicators>
          {JOURNEY_LABELS.map((label, i) => (
            <Step key={label}>
              <div className="py-3">
                <p className="text-[10px] font-bold uppercase tracking-wider text-instagram">
                  Step {i + 1}
                </p>
                <h4 className="text-sm font-black mt-1">{label}</h4>
                <p className="text-[10px] text-portal-muted/60 mt-1">
                  {i <= idx ? 'Completed' : 'Pending — keep going!'}
                </p>
              </div>
            </Step>
          ))}
        </Stepper>
        <p className="text-[9px] text-portal-muted/40 mt-2 text-center">
          Your eligibility as an influencer will be reviewed and decided by our admin team.
        </p>
      </div>

      {/* Next step card */}
      {nextStepCard()}

      {/* Disqualified */}
      {p.status === 'disqualified' && (
        <Card className="bg-red-500/10 border-red-500/20">
          <CardContent className="p-4">
            <p className="text-sm font-bold text-red-400">Disqualified</p>
            {p.disqualifiedReason && (
              <p className="text-xs text-red-300/60 mt-1">{p.disqualifiedReason}</p>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  )
}

const reelStatusVariant = (status: KartfluencerReel['status']): BadgeVariant => {
  if (status === 'verified') return 'success'
  if (status === 'rejected') return 'destructive'
  return 'warning'
}

const PortalReels = ({ session }: { session: InfluencerSession }) => {
  const [reels, setReels] = useState<KartfluencerReel[]>([])
  const [ld, setLd] = useState(true)
  const [lk, setLk] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')

  const load = useCallback(async () => {
    try {
      setReels(await kartfluencerApi.listReelsPublic(session.influencerId))
    } catch {
      // swallow — empty list shown below
    } finally {
      setLd(false)
    }
  }, [session])
  useEffect(() => {
    void load()
  }, [load])

  const submit = async () => {
    if (!lk.trim()) return
    setErr('')
    setBusy(true)
    try {
      await kartfluencerApi.addReelPublic(session.influencerId, lk)
      setLk('')
      void load()
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Failed')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-5">
      <h2 className="text-lg font-black uppercase">My Reels</h2>

      <Card>
        <CardHeader>
          <CardTitle className="text-[10px] uppercase tracking-wider text-portal-muted">
            Submit Reel
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {err && <p className="text-xs text-instagram">{err}</p>}
          <Input
            type="url"
            value={lk}
            onChange={(e) => setLk(e.target.value)}
            placeholder="Paste Instagram reel link..."
          />
          <Button className="w-full" onClick={submit} disabled={busy || !lk.trim()}>
            {busy ? 'Submitting...' : 'Submit Reel'}
          </Button>
        </CardContent>
      </Card>

      {ld ? (
        <ListSkeleton />
      ) : reels.length === 0 ? (
        <Card>
          <CardContent className="py-10 text-center text-sm text-portal-muted/50">
            <Film size={28} className="mx-auto mb-2 opacity-30" />
            <p>No reels yet</p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {reels.map((r) => (
            <Card key={r.id}>
              <CardContent className="p-4">
                <div className="flex justify-between items-start mb-3 gap-2">
                  <a
                    href={r.reelLink}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-xs text-primary-500 hover:underline truncate flex items-center gap-1 min-w-0"
                  >
                    <ExternalLink size={10} className="flex-shrink-0" />
                    <span className="truncate">
                      {r.reelLink.replace(/^https?:\/\/(www\.)?/, '')}
                    </span>
                  </a>
                  <Badge variant={reelStatusVariant(r.status)}>{r.status}</Badge>
                </div>
                <div className="grid grid-cols-3 gap-2">
                  <Stat label="Views" value={r.viewCount.toLocaleString()} icon={Eye} />
                  <Stat
                    label="Tier"
                    value={(
                      VIEW_PAYMENT_TIERS.find((t) => t.tier === r.currentViewTier)?.label ?? ''
                    )
                      .split('(')[0]
                      .trim()}
                    icon={TrendingUp}
                  />
                  <Stat
                    label="Earned"
                    value={`₹${r.totalEarned.toLocaleString()}`}
                    icon={IndianRupee}
                  />
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  )
}

const PortalWallet = ({ session }: { session: InfluencerSession }) => {
  const [bal, setBal] = useState<{
    balance: number
    totalEarned: number
    totalWithdrawn: number
  } | null>(null)
  const [hist, setHist] = useState<KartfluencerWalletTransaction[]>([])
  const [ld, setLd] = useState(true)
  const [showDialog, setShowDialog] = useState(false)
  const [upi, setUpi] = useState('')
  const [un, setUn] = useState('')
  const [amt, setAmt] = useState('')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')

  useEffect(() => {
    Promise.all([
      kartfluencerApi.getWalletBalancePublic(session.influencerId),
      kartfluencerApi.getWalletHistoryPublic(session.influencerId),
    ])
      .then(([b, h]) => {
        setBal(b)
        setHist(h)
      })
      .catch(() => {})
      .finally(() => setLd(false))
  }, [session])

  const withdraw = async () => {
    const a = parseFloat(amt)
    if (!a || a <= 0) {
      setMsg('Enter valid amount')
      return
    }
    if (!upi.trim()) {
      setMsg('Enter UPI ID')
      return
    }
    setMsg('')
    setBusy(true)
    try {
      await kartfluencerApi.requestWithdrawalPublic(session.influencerId, a, upi, un)
      setShowDialog(false)
      setAmt('')
      setMsg('Withdrawal submitted!')
      setBal(await kartfluencerApi.getWalletBalancePublic(session.influencerId))
    } catch (e) {
      setMsg(e instanceof Error ? e.message : 'Failed')
    } finally {
      setBusy(false)
    }
  }

  if (ld) return <ListSkeleton />

  return (
    <div className="space-y-5">
      <h2 className="text-lg font-black uppercase">Wallet</h2>

      <Card className="bg-instagram/10 border-instagram/20">
        <CardContent className="p-5">
          <span className="text-[10px] text-portal-muted uppercase tracking-wider font-bold">
            Balance
          </span>
          <p className="text-4xl font-black mt-1">₹{(bal?.balance ?? 0).toLocaleString()}</p>
          <div className="flex gap-4 mt-1.5 text-[11px] text-portal-muted">
            <span>Earned: ₹{(bal?.totalEarned ?? 0).toLocaleString()}</span>
            <span>Withdrawn: ₹{(bal?.totalWithdrawn ?? 0).toLocaleString()}</span>
          </div>
          {(bal?.balance ?? 0) > 0 && (
            <Button
              variant="secondary"
              className="mt-3 w-full"
              onClick={() => {
                setMsg('')
                setShowDialog(true)
              }}
            >
              Request Withdrawal
            </Button>
          )}
        </CardContent>
      </Card>

      {msg && (
        <p
          className={`text-xs px-3 py-2 rounded-lg ${
            msg.includes('submitted')
              ? 'bg-emerald-500/10 text-emerald-400'
              : 'bg-instagram/10 text-instagram'
          }`}
        >
          {msg}
        </p>
      )}

      <Dialog open={showDialog} onOpenChange={setShowDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Request Withdrawal</DialogTitle>
            <DialogDescription>Funds are sent to your UPI ID after approval.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <Input
              type="number"
              value={amt}
              onChange={(e) => setAmt(e.target.value)}
              placeholder="Amount (₹)"
            />
            <Input
              type="text"
              value={upi}
              onChange={(e) => setUpi(e.target.value)}
              placeholder="UPI ID"
            />
            <Input
              type="text"
              value={un}
              onChange={(e) => setUn(e.target.value)}
              placeholder="Name on UPI"
            />
          </div>
          <DialogFooter>
            <Button variant="secondary" onClick={() => setShowDialog(false)}>
              Cancel
            </Button>
            <Button variant="success" onClick={withdraw} disabled={busy}>
              {busy ? 'Submitting...' : 'Submit'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <div>
        <p className="text-[10px] text-portal-muted uppercase tracking-wider font-bold mb-3">
          Transactions
        </p>
        {hist.length === 0 ? (
          <Card>
            <CardContent className="py-6 text-center text-sm text-portal-muted/40">
              No transactions
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-2">
            {hist.map((tx) => (
              <Card key={tx.id}>
                <CardContent className="flex justify-between items-center px-4 py-3">
                  <div>
                    <p className="text-xs text-white/70">{tx.description}</p>
                    <p className="text-[10px] text-portal-muted/40 mt-0.5">
                      {new Date(tx.createdAt).toLocaleDateString('en-IN', {
                        day: 'numeric',
                        month: 'short',
                        year: 'numeric',
                      })}
                    </p>
                  </div>
                  <span
                    className={`text-sm font-black ${tx.amount >= 0 ? 'text-emerald-400' : 'text-instagram'}`}
                  >
                    {tx.amount >= 0 ? '+' : ''}₹{Math.abs(tx.amount).toLocaleString()}
                  </span>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

const PortalNotifications = ({ session }: { session: InfluencerSession }) => {
  const [items, setItems] = useState<KartfluencerNotification[]>([])
  const [ld, setLd] = useState(true)
  useEffect(() => {
    kartfluencerApi
      .listNotificationsPublic()
      .then((d) => setItems(d.filter((n) => n.isActive)))
      .catch(() => {})
      .finally(() => setLd(false))
  }, [session])
  const c: Record<string, string> = {
    offer: 'border-secondary-500/15 bg-secondary-500/5',
    alert: 'border-instagram/15 bg-instagram/5',
    info: 'border-primary-500/15 bg-primary-500/5',
  }
  return (
    <div className="space-y-5">
      <h2 className="text-lg font-black uppercase">Updates</h2>
      {ld ? (
        <ListSkeleton />
      ) : items.length === 0 ? (
        <div className="py-10 text-center text-sm text-portal-muted/30">
          <Bell size={28} className="mx-auto mb-2 opacity-20" />
          <p>No updates</p>
        </div>
      ) : (
        <div className="space-y-3">
          {items.map((n) => (
            <div
              key={n.id}
              className={`rounded-lg border p-4 ${c[n.type] ?? 'border-white/[0.04] bg-white/[0.02]'}`}
            >
              <div className="flex gap-2 mb-1">
                <span className="text-[9px] font-bold uppercase tracking-wider text-portal-muted/50">
                  {n.type}
                </span>
                <span className="text-[9px] text-portal-muted/30">
                  {new Date(n.createdAt).toLocaleDateString('en-IN', {
                    day: 'numeric',
                    month: 'short',
                  })}
                </span>
              </div>
              <h4 className="text-sm font-bold">{n.title}</h4>
              <p className="text-xs text-portal-muted mt-1">{n.message}</p>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

const humanStatus = (s: string): string =>
  s.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())

const PortalProfile = ({ session }: { session: InfluencerSession }) => {
  const [p, setP] = useState<KartfluencerRecord | null>(null)
  const [ld, setLd] = useState(true)
  useEffect(() => {
    kartfluencerApi
      .getPublic(session.influencerId)
      .then(setP)
      .catch(() => {})
      .finally(() => setLd(false))
  }, [session])

  if (ld) return <ListSkeleton />
  if (!p) return <Err text="Could not load profile." />

  const tierLabel = KARTFLUENCER_TIERS.find((t) => t.tier === p.tier)?.label ?? p.tier
  // instagramHandle is stored with a leading "@" prefix; strip for places that re-add it
  const handleNoAt = p.instagramHandle.replace(/^@/, '')

  const details: ReadonlyArray<readonly [string, string]> = [
    ['Instagram', p.instagramHandle],
    ['Phone', `${p.phoneCountryCode} ${p.phoneNumber}`],
    ['Branch', p.branchName],
    ['Followers', p.followersRange],
    ['Tier', tierLabel],
    ['Status', humanStatus(p.status)],
    [
      'Joined',
      new Date(p.createdAt).toLocaleDateString('en-IN', {
        day: 'numeric',
        month: 'long',
        year: 'numeric',
      }),
    ],
  ]

  return (
    <div className="space-y-5">
      <h2 className="text-lg font-black uppercase">Profile</h2>

      {/* Holographic profile card hero */}
      <ProfileCard
        name={p.instagramHandle}
        title={tierLabel}
        handle={handleNoAt}
        status={humanStatus(p.status)}
        contactText="Open Instagram"
        avatarUrl={p.profilePictureUrl || '/asquare-logo.webp'}
        miniAvatarUrl={p.profilePictureUrl || '/asquare-logo.webp'}
        showUserInfo
        enableTilt
        enableMobileTilt={false}
        behindGlowEnabled
        behindGlowColor="rgba(225, 6, 0, 0.45)"
        innerGradient="linear-gradient(145deg,#1E1E2A 0%,#15151E 100%)"
        onContactClick={() =>
          window.open(`https://instagram.com/${handleNoAt}`, '_blank', 'noopener,noreferrer')
        }
      />

      {p.qrCode && (
        <Card className="bg-white border-white/10">
          <CardContent className="p-5 flex flex-col items-center">
            <QRCodeSVG value={p.qrCode} size={170} level="M" />
            <p className="mt-2 text-xs text-gray-500">Show at the track</p>
            <p className="text-sm font-bold text-gray-800 mt-1">{p.instagramHandle}</p>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-[10px] uppercase tracking-wider text-portal-muted">
            Details
          </CardTitle>
        </CardHeader>
        <CardContent className="pt-0">
          <div className="space-y-0">
            {details.map(([l, v], i) => (
              <div key={l}>
                <div className="flex justify-between py-2.5">
                  <span className="text-xs text-portal-muted/70">{l}</span>
                  <span className="text-xs font-bold text-right">{v}</span>
                </div>
                {i < details.length - 1 && <Separator />}
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-[10px] uppercase tracking-wider text-portal-muted">
            Earning Tiers
          </CardTitle>
        </CardHeader>
        <CardContent className="pt-0">
          <div className="space-y-2">
            {VIEW_PAYMENT_TIERS.map((t) => (
              <div key={t.tier} className="flex justify-between text-xs">
                <span className="text-portal-muted/70">{t.label}</span>
                <span className="font-bold">
                  {t.payout > 0 ? `₹${t.payout.toLocaleString()}` : 'Access Pass'}
                </span>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  )
}

// ─── Shared ─────────────────────────────────────────────────────

const Stat = ({ label, value, icon: I }: { label: string; value: string; icon: typeof Eye }) => (
  <div className="rounded-lg bg-white/[0.03] border border-white/[0.04] px-2 py-2 text-center">
    <I size={10} className="mx-auto mb-1 text-portal-muted/40" />
    <p className="text-[10px] font-bold">{value}</p>
    <p className="text-[8px] text-portal-muted/50">{label}</p>
  </div>
)

const ListSkeleton = () => (
  <div className="space-y-4 py-6">
    {[1, 2, 3].map((i) => (
      <Skeleton key={i} className="h-20" />
    ))}
  </div>
)

const DashboardSkeleton = () => (
  <div className="space-y-5 py-2">
    <div className="flex items-center gap-3">
      <Skeleton className="h-12 w-12 rounded-full" />
      <div className="space-y-2 flex-1">
        <Skeleton className="h-4 w-32" />
        <Skeleton className="h-3 w-44" />
      </div>
    </div>
    <Skeleton className="h-28" />
    <Skeleton className="h-32" />
    <Skeleton className="h-40" />
  </div>
)

const Err = ({ text }: { text: string }) => (
  <div className="py-10 text-center text-sm text-instagram">{text}</div>
)

export default KartfluencerPortalPage
