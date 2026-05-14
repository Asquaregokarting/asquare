import { useState, useEffect, useRef } from 'react'
import { serverTimestamp } from 'firebase/firestore'
import SEO from '../components/SEO'
import { motion, AnimatePresence } from 'framer-motion'
import {
  User,
  Star,
  CreditCard,
  Bell,
  Shield,
  Award,
  ChevronRight,
  LogOut,
  HelpCircle,
  MessageSquare,
  Share2,
  Gift,
  Edit3,
  Save,
  Phone,
  Mail,
  ChevronLeft,
  Disc,
  ListTodo,
  CheckCircle2,
  Circle,
  AlertCircle,
  Wallet,
  FileText,
  RotateCcw,
} from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'
import { useGames } from '../contexts/GamesContext'
import { bookingService } from '../services/bookingService'
import { auth } from '../lib/firebase'
import { userService } from '../services/userService'
import { logger } from '../lib/logger'
import {
  defaultGamificationConfig,
  getGamificationConfig,
  type DailyTaskActionType,
  type DailyTaskRewardType,
  type GamificationAchievement,
  type GamificationDailyTask,
} from '../lib/gamificationConfig'
import GokartIcon from '../components/GokartIcon'
import VerificationModal from '../components/VerificationModal'
import CustomerTicketCard from '../components/tickets/CustomerTicketCard'
import { walletService } from '../services/walletService'
import { ticketCustomerService } from '../services/ticketCustomerService'
import type { Ticket, User as AppUser } from '../types'

const referralCodeFor = (user: AppUser | null | undefined): string | null => {
  if (!user?.id) return null
  return user.referralCode || `REF${user.id.slice(-6).toUpperCase()}`
}

// Daily-task reset key pinned to Asia/Kolkata so a user changing their
// device timezone can't roll a new "today" forward to re-claim rewards.
const istDateKey = (date: Date = new Date()): string =>
  new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(date)

interface DailyTask {
  id: string
  name: string
  reward: number
  rewardType: DailyTaskRewardType
  actionType: DailyTaskActionType
  completed: boolean
}

const tiers = {
  bronze: { color: 'from-amber-700 to-amber-900', min: 0, max: 499, next: 'silver' },
  silver: { color: 'from-gray-300 to-gray-500', min: 500, max: 999, next: 'gold' },
  gold: { color: 'from-yellow-400 to-yellow-600', min: 1000, max: 1499, next: 'platinum' },
  platinum: { color: 'from-purple-400 to-purple-600', min: 1500, max: 1999, next: 'club member' },
  'club member': { color: 'from-blue-600 to-blue-800', min: 2000, max: Infinity, next: null },
}

const defaultDailyTasks: DailyTask[] = defaultGamificationConfig.dailyTasks.map((task) => ({
  ...task,
  completed: false,
}))

const mergeTaskState = (
  configuredTasks: GamificationDailyTask[],
  storedTasks?: Partial<DailyTask>[],
): DailyTask[] => {
  const completedById = new Map(
    (storedTasks || []).map((task) => [String(task.id), Boolean(task.completed)]),
  )

  return configuredTasks.map((task) => ({
    ...task,
    completed: completedById.get(String(task.id)) || false,
  }))
}

const faqItems = [
  {
    q: 'How do I earn tires?',
    a: 'You earn tires for every booking you make, playing games, and referring friends. 1 tire = ₹10 spent.',
  },
  {
    q: 'Can I cancel or reschedule my booking?',
    a: 'Yes! You can reschedule up to 2 hours before your session. Cancellations are allowed with a small fee 24 hours prior.',
  },
  {
    q: 'What is the minimum age requirement?',
    a: 'For go-karting: Child Kart (8+), Adult Kart (14+), Double Kart (18+ driver). Other activities vary.',
  },
  {
    q: 'How do I redeem my tires?',
    a: 'Go to Wallet > Redeem Tires to exchange your tires for free laps, discounts, or exclusive rewards.',
  },
]

export default function Profile() {
  const navigate = useNavigate()
  const { user, logout, updateUserProfile, loading } = useAuth()
  const { tires, addTires } = useGames()

  const [activeSection, setActiveSection] = useState<string | null>(null)
  const [dailyTasks, setDailyTasks] = useState<DailyTask[]>(defaultDailyTasks)
  const [achievements, setAchievements] = useState<GamificationAchievement[]>(
    defaultGamificationConfig.achievements,
  )
  const [isEditing, setIsEditing] = useState(false)
  const [editForm, setEditForm] = useState({
    displayName: user?.displayName || '',
    phone: user?.phone || '',
    email: user?.email || '',
    referredBy: user?.referredBy || '',
  })
  const [bookingCount, setBookingCount] = useState(0)
  const [myTickets, setMyTickets] = useState<Ticket[]>([])
  const [isVerificationModalOpen, setIsVerificationModalOpen] = useState(false)
  const [statusMsg, setStatusMsg] = useState<{
    text: string
    type: 'success' | 'error' | 'warn'
  } | null>(null)
  // Track the dismiss timer + in-flight task IDs across renders. Both need
  // ref-based identity: timer must be cleared on unmount or re-show, and the
  // task-in-flight set is the synchronous double-click guard since
  // setDailyTasks is async (state update lands AFTER the wallet credit).
  const statusTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const inFlightTaskIdsRef = useRef<Set<string>>(new Set())

  const showStatus = (text: string, type: 'success' | 'error' | 'warn' = 'success') => {
    if (statusTimerRef.current) clearTimeout(statusTimerRef.current)
    setStatusMsg({ text, type })
    statusTimerRef.current = setTimeout(() => {
      setStatusMsg(null)
      statusTimerRef.current = null
    }, 4000)
  }

  useEffect(() => {
    return () => {
      if (statusTimerRef.current) clearTimeout(statusTimerRef.current)
    }
  }, [])

  const hasReferralApplied = Boolean(user?.referredBy)

  // Notification settings (UI state only for now)
  const [notifications, setNotifications] = useState({
    pushEnabled: true,
    emailEnabled: true,
    smsEnabled: false,
    promotional: true,
    bookingReminders: true,
    gameAlerts: true,
  })

  // Sync state with user context
  useEffect(() => {
    if (user) {
      setEditForm((prev) => ({
        ...prev,
        displayName: user.displayName || '',
        phone: user.phone || '',
        email: user.email || '',
        referredBy: user.referredBy || prev.referredBy,
      }))
    }
  }, [user])

  // Subscribe to the user's tickets so the "My tickets" section is live.
  useEffect(() => {
    if (!user?.id) {
      setMyTickets([])
      return
    }
    const unsub = ticketCustomerService.subscribeToMyTickets(
      user.id,
      (rows) => setMyTickets(rows),
      (err) => logger.error('profile.tickets.subscribe_failed', err, { userId: user.id }),
    )
    return () => unsub()
  }, [user?.id])

  // Derive tier from current tire count, not the (often stale) `user.tier`
  // field. Otherwise a user with 1200 tires whose stored tier is still
  // 'bronze' (max 499) renders progress = 240% and a negative
  // "tires until next" string.
  const derivedTierKey =
    (Object.keys(tiers) as Array<keyof typeof tiers>).find(
      (k) => tires >= tiers[k].min && tires <= tiers[k].max,
    ) || ((user?.tier || 'bronze').toLowerCase() as keyof typeof tiers)
  const tierKey: keyof typeof tiers = derivedTierKey in tiers ? derivedTierKey : 'bronze'
  const tierInfo = tiers[tierKey] || tiers.bronze
  const progress_to_next = tierInfo.next
    ? Math.min(100, Math.max(0, ((tires - tierInfo.min) / (tierInfo.max - tierInfo.min + 1)) * 100))
    : 100

  // Fetch profile + gamification config
  useEffect(() => {
    // If loading, wait
    if (loading) return

    // If not logged in, prompt for verification
    if (!user) {
      if (!isVerificationModalOpen) {
        setIsVerificationModalOpen(true)
      }
      return
    }

    // If user is logged in, close modal if open
    if (user && isVerificationModalOpen) {
      setIsVerificationModalOpen(false)
    }

    if (!user?.id) return

    const fetchData = async () => {
      try {
        const [count, gamificationConfig] = await Promise.all([
          bookingService.getBookingCount(user.phone || ''),
          getGamificationConfig(),
        ])

        setBookingCount(count)
        setAchievements(gamificationConfig.achievements)

        const configuredTasks = gamificationConfig.dailyTasks
        const defaultTasksForDay = configuredTasks.map((task) => ({ ...task, completed: false }))

        const data = await userService.getUserDoc(user.id)

        if (data) {
          // Same-day check pinned to Asia/Kolkata so device-tz changes can't
          // roll the day forward and trigger an early reset.
          const today = istDateKey()
          const tasksUpdatedAt = data.tasksUpdatedAt as { toDate?: () => Date } | undefined
          const lastTaskUpdate = tasksUpdatedAt?.toDate?.() || null

          if (!lastTaskUpdate || istDateKey(lastTaskUpdate) !== today) {
            setDailyTasks(defaultTasksForDay)
            // Stamp tasksUpdatedAt — without it the same-day check above
            // never matches, so the reset would fire on every page load,
            // wiping any task progress made earlier today.
            await userService.mergeUserDoc(user.id, {
              tasks: defaultTasksForDay,
              tasksUpdatedAt: serverTimestamp(),
            })
          } else {
            const mergedTasks = mergeTaskState(
              configuredTasks,
              Array.isArray(data.tasks) ? (data.tasks as Partial<DailyTask>[]) : undefined,
            )
            setDailyTasks(mergedTasks)

            if (!Array.isArray(data.tasks)) {
              await userService.mergeUserDoc(user.id, {
                tasks: mergedTasks,
                tasksUpdatedAt: serverTimestamp(),
              })
            }
          }

          if (!data.referralCode) {
            const newCode = `REF${user.id.slice(-6).toUpperCase()}`
            await userService.mergeUserDoc(user.id, { referralCode: newCode })
          }

          if (data.referredBy) {
            setEditForm((prev) => ({ ...prev, referredBy: data.referredBy as string }))
          }
        } else {
          await userService.ensureUserDoc(user.id, {
            tasks: defaultTasksForDay,
            tasksUpdatedAt: serverTimestamp(),
            referralCode: `REF${user.id.slice(-6).toUpperCase()}`,
          })

          setDailyTasks(defaultTasksForDay)
        }
      } catch (err) {
        logger.error('profile.fetch_failed', err, { userId: user.id })
      }
    }

    fetchData()
    // Narrowed to user?.id so the effect doesn't re-fire for unrelated
    // AuthContext mutations (cross-doc enrichment, isVerified flip, etc.)
    // which used to clobber an in-flight task completion.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id, loading, isVerificationModalOpen])

  const handleLogout = async () => {
    try {
      await logout()
      window.location.replace('/activities')
    } catch (err) {
      logger.error('profile.logout_failed', err)
      localStorage.removeItem('mock_user')
      window.location.replace('/activities')
    }
  }

  const handleSaveProfile = async () => {
    try {
      // Validate referral BEFORE any write so a self-referral or invalid
      // code never makes it into Firestore. Previous flow committed first,
      // then validated, then showed a "you cannot refer yourself" warning
      // even though the data was already saved.
      const trimmedReferral = editForm.referredBy.trim().toUpperCase()
      const isNewReferral = trimmedReferral && !user?.referredBy
      let referralToCommit: string | undefined

      if (isNewReferral) {
        const myCode = referralCodeFor(user)
        // Case-insensitive compare — user could otherwise type "refabc123"
        // and bypass the self-referral check on their own uppercased code.
        if (myCode && trimmedReferral === myCode) {
          showStatus('You cannot refer yourself!', 'warn')
          return
        }

        const referrer = await userService.findUserByReferralCode(trimmedReferral)
        if (!referrer) {
          showStatus('Invalid referral code.', 'error')
          return
        }
        if (user?.id && referrer.id === user.id) {
          showStatus('You cannot refer yourself!', 'warn')
          return
        }

        referralToCommit = trimmedReferral
      }

      await updateUserProfile({
        displayName: editForm.displayName,
        email: editForm.email,
        referredBy: referralToCommit,
      })

      setIsEditing(false)
      showStatus('Profile updated successfully')
    } catch (error) {
      logger.error('profile.save_failed', error)
      showStatus('Failed to update profile. Please try again.', 'error')
    }
  }

  const completeTask = async (task: DailyTask) => {
    if (task.completed) return
    // Synchronous double-click guard. The `task.completed` check above only
    // sees React state, which doesn't update until setDailyTasks runs AFTER
    // the wallet credit await — long enough for a second click to slip in.
    if (inFlightTaskIdsRef.current.has(task.id)) return
    inFlightTaskIdsRef.current.add(task.id)

    try {
      // Day-pinned key dedupes credit across retries (multi-tab, page
      // reload between award and persist, BF-003-style task reset spam).
      // Server-side: walletService stores the audit-log doc at a
      // deterministic ID and short-circuits second writes.
      const dayKey = istDateKey()
      const idempotencyKey = `daily-task-${task.id}-${dayKey}`

      if (task.rewardType === 'wallet') {
        if (!user?.id) {
          showStatus('Please login again to claim wallet cash.', 'error')
          return
        }

        const credited = await walletService.addBalance(
          user.id,
          task.reward,
          `Daily task reward: ${task.name}`,
          idempotencyKey,
        )

        if (!credited) {
          showStatus('Failed to credit wallet cash. Please try again.', 'error')
          return
        }
      } else {
        // streakBonus=false: streak bonus is for gameplay, not configured
        // task rewards — without this opt-out the user silently received up
        // to 2× the reward shown in the UI.
        const credited = await addTires(task.reward, false, {
          description: `Daily task reward: ${task.name}`,
          idempotencyKey,
        })
        if (!credited) {
          showStatus('Failed to credit tires. Please try again.', 'error')
          return
        }
      }

      const updatedTasks = dailyTasks.map((currentTask) =>
        currentTask.id === task.id ? { ...currentTask, completed: true } : currentTask,
      )
      setDailyTasks(updatedTasks)

      if (user?.id) {
        const ok = await userService.mergeUserDoc(user.id, {
          tasks: updatedTasks,
          tasksUpdatedAt: serverTimestamp(),
        })
        if (!ok) logger.warn('profile.task_save_failed', { taskId: task.id })
      }

      showStatus(
        task.rewardType === 'wallet'
          ? `Earned ₹${task.reward} Wallet Cash!`
          : `Earned ${task.reward} Tires!`,
      )
    } finally {
      inFlightTaskIdsRef.current.delete(task.id)
    }
  }

  const handleShare = async () => {
    const referralCode = referralCodeFor(user)
    if (!referralCode) {
      showStatus('Sign in to share your referral code.', 'warn')
      return
    }
    const shareText = `🏎️ Join me at A Square Go-Karting! Use my referral code ${referralCode} to get 500 Tires instantly! 🏁 https://app.asquaregokarting.com/?ref=${referralCode}`

    try {
      if (navigator.share) {
        await navigator.share({
          title: 'Join A Square Go-Karting',
          text: shareText,
          url: window.location.origin,
        })
      } else {
        await navigator.clipboard.writeText(shareText)
        showStatus('Referral link copied to clipboard!')
      }

      // Known limitation: navigator.share resolves on share-sheet dismiss
      // even when the user didn't actually share, so this credit is on
      // "intent to share", not confirmed share. The deterministic-key
      // idempotency in completeTask caps abuse at one credit per IST day,
      // and the long-term fix is to award this task only when ANOTHER user
      // joins via this referralCode (server-side trigger).
      const shareTask = dailyTasks.find((task) => task.actionType === 'share' && !task.completed)
      if (shareTask) {
        await completeTask(shareTask)
      }
    } catch (err) {
      logger.error('profile.share_failed', err)
    }
  }

  const handleTaskAction = async (task: DailyTask) => {
    if (task.completed) return

    if (task.actionType === 'share') {
      await handleShare()
      return
    }

    await completeTask(task)
  }

  const renderSectionContent = () => {
    switch (activeSection) {
      case 'Personal Details':
        return (
          <div className="space-y-4">
            {isEditing ? (
              <>
                <div>
                  <label className="text-dark-400 text-xs mb-1 block">Full Name</label>
                  <input
                    type="text"
                    aria-label="Full Name"
                    value={editForm.displayName}
                    onChange={(e) => setEditForm({ ...editForm, displayName: e.target.value })}
                    className="w-full px-4 py-3 bg-dark-800 border border-white/10 rounded-xl text-white"
                  />
                </div>
                <div>
                  <label className="text-dark-400 text-xs mb-1 block">Phone</label>
                  <input
                    type="tel"
                    aria-label="Phone Number"
                    value={editForm.phone}
                    disabled
                    className="w-full px-4 py-3 bg-dark-700 border border-white/5 rounded-xl text-dark-400"
                  />
                  <p className="text-dark-500 text-xs mt-1">Phone number cannot be changed</p>
                </div>
                <div>
                  <label className="text-dark-400 text-xs mb-1 block">Referred By (Optional)</label>
                  <input
                    type="text"
                    placeholder="Enter Referral Code"
                    value={editForm.referredBy}
                    onChange={(e) => setEditForm({ ...editForm, referredBy: e.target.value })}
                    disabled={hasReferralApplied}
                    className={`w-full px-4 py-3 rounded-xl text-white ${
                      hasReferralApplied
                        ? 'bg-dark-700 text-dark-400 border-white/5'
                        : 'bg-dark-800 border-white/10 border'
                    }`}
                  />
                  {hasReferralApplied && (
                    <p className="text-green-500 text-xs mt-1">Referral applied</p>
                  )}
                </div>
                <div>
                  <label className="text-dark-400 text-xs mb-1 block">Email</label>
                  <input
                    type="email"
                    aria-label="Email Address"
                    value={editForm.email}
                    onChange={(e) => setEditForm({ ...editForm, email: e.target.value })}
                    className="w-full px-4 py-3 bg-dark-800 border border-white/10 rounded-xl text-white"
                  />
                </div>
                <button
                  onClick={handleSaveProfile}
                  className="btn-primary w-full flex items-center justify-center gap-2"
                >
                  <Save className="w-4 h-4" /> Save Changes
                </button>
              </>
            ) : (
              <>
                <div className="flex items-center gap-4 p-4 bg-dark-800 rounded-xl">
                  <User className="w-5 h-5 text-primary-400" />
                  <div className="flex-1">
                    <p className="text-dark-400 text-xs">Name</p>
                    <p className="text-white">{user?.displayName || 'Not set'}</p>
                  </div>
                </div>
                <div className="flex items-center gap-4 p-4 bg-dark-800 rounded-xl">
                  <Phone className="w-5 h-5 text-primary-400" />
                  <div className="flex-1">
                    <p className="text-dark-400 text-xs">Phone</p>
                    <div className="flex items-center gap-2">
                      <p className="text-white">{user?.phone || 'Not set'}</p>
                      {user?.isVerified ? (
                        <span className="text-green-500 bg-green-500/10 px-2 py-0.5 rounded text-[10px] font-bold flex items-center gap-1">
                          <CheckCircle2 className="w-3 h-3" /> Verified
                        </span>
                      ) : (
                        <button
                          onClick={() => setIsVerificationModalOpen(true)}
                          className="text-red-400 bg-red-400/10 px-2 py-0.5 rounded text-[10px] font-bold hover:bg-red-400/20 flex items-center gap-1"
                        >
                          <AlertCircle className="w-3 h-3" /> Verify Now
                        </button>
                      )}
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-4 p-4 bg-dark-800 rounded-xl">
                  <Gift className="w-5 h-5 text-primary-400" />
                  <div className="flex-1">
                    <p className="text-dark-400 text-xs">Referred By</p>
                    <p className="text-white">
                      {user?.referredBy || editForm.referredBy || 'None'}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-4 p-4 bg-dark-800 rounded-xl">
                  <Mail className="w-5 h-5 text-primary-400" />
                  <div className="flex-1">
                    <p className="text-dark-400 text-xs">Email</p>
                    <p className="text-white">{user?.email || 'Not set'}</p>
                  </div>
                </div>
                <button
                  onClick={() => setIsEditing(true)}
                  className="btn-ghost w-full flex items-center justify-center gap-2"
                >
                  <Edit3 className="w-4 h-4" /> Edit Details
                </button>
              </>
            )}
          </div>
        )
      case 'Payment Methods':
        return (
          <div className="space-y-4">
            <p className="text-dark-400 text-sm">Saved payment methods for faster checkout</p>
            <div className="p-4 bg-dark-800 rounded-xl border border-dashed border-white/20 text-center">
              <CreditCard className="w-8 h-8 text-dark-500 mx-auto mb-2" />
              <p className="text-dark-400 text-sm">No payment methods saved</p>
              <button className="btn-primary mt-4">Add Payment Method</button>
            </div>
          </div>
        )
      case 'Notifications':
        return (
          <div className="space-y-4">
            <p className="text-dark-400 text-sm mb-4">Manage your notification preferences</p>
            {[
              {
                key: 'pushEnabled',
                label: 'Push Notifications',
                desc: 'Receive alerts on your device',
              },
              { key: 'emailEnabled', label: 'Email Notifications', desc: 'Updates via email' },
              { key: 'smsEnabled', label: 'SMS Notifications', desc: 'Text message alerts' },
              {
                key: 'bookingReminders',
                label: 'Booking Reminders',
                desc: 'Reminders before your session',
              },
              {
                key: 'promotional',
                label: 'Offers & Promotions',
                desc: 'Deals and special offers',
              },
              { key: 'gameAlerts', label: 'Game Alerts', desc: 'New games and rewards' },
            ].map((item) => (
              <div
                key={item.key}
                className="flex items-center justify-between p-4 bg-dark-800 rounded-xl"
              >
                <div>
                  <p className="text-white font-medium">{item.label}</p>
                  <p className="text-dark-500 text-xs">{item.desc}</p>
                </div>
                <button
                  onClick={() =>
                    setNotifications({
                      ...notifications,
                      [item.key as keyof typeof notifications]:
                        !notifications[item.key as keyof typeof notifications],
                    })
                  }
                  className={`w-12 h-6 rounded-full transition-colors ${notifications[item.key as keyof typeof notifications] ? 'bg-primary-500' : 'bg-dark-600'}`}
                >
                  <motion.div
                    className="w-5 h-5 bg-white rounded-full"
                    animate={{ x: notifications[item.key as keyof typeof notifications] ? 26 : 2 }}
                    transition={{ type: 'spring', stiffness: 500, damping: 30 }}
                  />
                </button>
              </div>
            ))}
          </div>
        )
      case 'Privacy & Security':
        return (
          <div className="space-y-4">
            <p className="text-dark-400 text-sm">Manage your account security</p>
            <button
              onClick={() => navigate('/privacy')}
              className="w-full p-4 bg-dark-800 rounded-xl flex items-center gap-4 group"
            >
              <Shield className="w-6 h-6 text-primary-400" />
              <div className="text-left flex-1">
                <p className="text-white font-medium group-hover:text-primary-400 transition-colors">
                  Privacy Policy
                </p>
                <p className="text-dark-400 text-xs">Read how we protect your data</p>
              </div>
              <ChevronRight className="w-5 h-5 text-dark-500" />
            </button>
            <button
              onClick={() => navigate('/terms')}
              className="w-full p-4 bg-dark-800 rounded-xl flex items-center gap-4 group"
            >
              <FileText className="w-6 h-6 text-primary-400" />
              <div className="text-left flex-1">
                <p className="text-white font-medium group-hover:text-primary-400 transition-colors">
                  Terms & Conditions
                </p>
                <p className="text-dark-400 text-xs">Our terms of service and governing law</p>
              </div>
              <ChevronRight className="w-5 h-5 text-dark-500" />
            </button>
            <button
              onClick={() => navigate('/refund-policy')}
              className="w-full p-4 bg-dark-800 rounded-xl flex items-center gap-4 group"
            >
              <RotateCcw className="w-6 h-6 text-primary-400" />
              <div className="text-left flex-1">
                <p className="text-white font-medium group-hover:text-primary-400 transition-colors">
                  Return & Refund Policy
                </p>
                <p className="text-dark-400 text-xs">Cancellation timeframes and refund details</p>
              </div>
              <ChevronRight className="w-5 h-5 text-dark-500" />
            </button>
            <button className="w-full p-4 bg-dark-800 rounded-xl text-left text-red-400 mt-8">
              <p className="font-medium">Delete Account</p>
              <p className="text-red-400/60 text-xs">Permanently delete your account</p>
            </button>
          </div>
        )
      case 'Support':
        return (
          <div className="space-y-4">
            <p className="text-dark-400 text-sm">Need help? We're here for you!</p>
            <button className="w-full p-4 bg-primary-500/10 border border-primary-500/30 rounded-xl flex items-center gap-4">
              <MessageSquare className="w-6 h-6 text-primary-400" />
              <div className="text-left flex-1">
                <p className="text-white font-medium">Live Chat</p>
                <p className="text-dark-400 text-xs">Chat with our support team</p>
              </div>
              <ChevronRight className="w-5 h-5 text-dark-500" />
            </button>
            <button className="w-full p-4 bg-dark-800 rounded-xl flex items-center gap-4">
              <Phone className="w-6 h-6 text-primary-400" />
              <div className="text-left flex-1">
                <p className="text-white font-medium">Call Us</p>
                <p className="text-dark-400 text-xs">+91 98765 43210</p>
              </div>
            </button>
            <button className="w-full p-4 bg-dark-800 rounded-xl flex items-center gap-4">
              <Mail className="w-6 h-6 text-primary-400" />
              <div className="text-left flex-1">
                <p className="text-white font-medium">Email</p>
                <p className="text-dark-400 text-xs">support@asquare.com</p>
              </div>
            </button>
          </div>
        )
      case 'FAQ':
        return (
          <div className="space-y-3">
            {faqItems.map((item, i) => (
              <details key={i} className="bg-dark-800 rounded-xl overflow-hidden group">
                <summary className="p-4 text-white font-medium cursor-pointer list-none flex items-center justify-between">
                  {item.q}
                  <ChevronRight className="w-4 h-4 text-dark-500 group-open:rotate-90 transition-transform" />
                </summary>
                <div className="px-4 pb-4 text-dark-400 text-sm">{item.a}</div>
              </details>
            ))}
          </div>
        )
      default:
        return null
    }
  }

  if (!user && !isVerificationModalOpen) {
    // Should result in redirect or modal opening
    return null
  }

  return (
    <div className="pt-0 px-4 md:px-6 lg:px-8 safe-bottom lg:max-w-6xl xl:max-w-7xl lg:mx-auto">
      {/* Status Message Banner */}
      <SEO
        title="Profile"
        description="Manage your profile, daily tasks, and achievements at A Square GoKarting."
        path="/profile"
        noindex
      />
      <AnimatePresence>
        {statusMsg && (
          <motion.div
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            role="status"
            className={`mb-4 p-3 rounded-xl text-sm font-medium text-center ${
              statusMsg.type === 'success'
                ? 'bg-green-500/15 text-green-400 border border-green-500/20'
                : statusMsg.type === 'warn'
                  ? 'bg-yellow-500/15 text-yellow-400 border border-yellow-500/20'
                  : 'bg-red-500/15 text-red-400 border border-red-500/20'
            }`}
          >
            {statusMsg.text}
          </motion.div>
        )}
      </AnimatePresence>

      {/* Mobile section detail panel (slides in from right) */}
      <AnimatePresence>
        {activeSection && (
          <motion.div
            initial={{ opacity: 0, x: 100 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: 100 }}
            className="fixed inset-0 bg-dark-900 z-50 overflow-y-auto lg:hidden"
          >
            <div className="p-4">
              <button
                onClick={() => {
                  setActiveSection(null)
                  setIsEditing(false)
                }}
                className="flex items-center gap-2 text-white mb-6"
              >
                <ChevronLeft className="w-5 h-5" />
                <span className="font-medium">{activeSection}</span>
              </button>
              {renderSectionContent()}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Dashboard Layout */}
      <div className="lg:grid lg:grid-cols-[360px_1fr] xl:grid-cols-[400px_1fr] lg:gap-8">
        {/* ===== LEFT COLUMN (sticky on desktop) ===== */}
        <div className="lg:sticky lg:top-4 lg:self-start space-y-6">
          <div className="card mb-6 lg:mb-0 lg:p-6">
            <div className="flex items-center gap-4">
              <div className="relative">
                <div className="w-14 h-14 lg:w-20 lg:h-20 rounded-full bg-gradient-to-br from-primary-500 to-secondary-500 flex items-center justify-center text-2xl lg:text-3xl font-bold text-white">
                  {user?.displayName?.charAt(0) || 'U'}
                </div>
                <div
                  className={`absolute -bottom-1 -right-1 w-7 h-7 rounded-full bg-gradient-to-br ${tierInfo.color} flex items-center justify-center`}
                >
                  <Star className="w-4 h-4 text-white fill-current" />
                </div>
              </div>
              <div className="flex-1">
                <h2 className="text-lg md:text-xl font-bold text-white">
                  {user?.displayName || 'User'}
                </h2>
                <p className="text-dark-400 text-sm">{user?.email || user?.phone}</p>
                <div className="flex items-center gap-2 mt-1">
                  <span
                    className={`px-2 py-0.5 rounded-full text-xs font-medium capitalize bg-gradient-to-r ${tierInfo.color} text-white`}
                  >
                    {tierKey}
                  </span>
                  <span className="text-dark-500 text-xs">Member since Jan 2026</span>
                </div>
              </div>
            </div>

            <div className="mt-4 pt-4 border-t border-dark-700">
              <div className="flex items-center justify-between mb-2">
                <span className="text-dark-400 text-sm">Tires Earned</span>
                <span className="text-yellow-400 font-bold flex items-center gap-1">
                  <Disc className="w-4 h-4" />
                  {tires.toLocaleString()}
                </span>
              </div>
              {tierInfo.next && (
                <>
                  <div className="h-2 bg-dark-700 rounded-full overflow-hidden">
                    <motion.div
                      className={`h-full bg-gradient-to-r ${tierInfo.color}`}
                      initial={{ width: 0 }}
                      animate={{ width: `${progress_to_next}%` }}
                      transition={{ duration: 0.8, ease: 'easeOut' }}
                    />
                  </div>
                  <p className="text-dark-500 text-xs mt-1">
                    {tierInfo.max - tires + 1} Tires until {tierInfo.next}
                  </p>
                </>
              )}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3 mb-6 lg:mb-0">
            <div className="card text-center py-2.5">
              <div className="text-lg font-bold text-primary-400">{bookingCount}</div>
              <div className="text-dark-500 text-[10px]">Bookings</div>
            </div>
            <div className="card text-center py-2.5">
              <div className="text-lg font-bold text-green-400">3</div>
              <div className="text-dark-500 text-[10px]">Referrals</div>
            </div>
          </div>
        </div>
        {/* end left column */}

        {/* ===== RIGHT COLUMN ===== */}
        <div className="space-y-6">
          {/* Desktop section detail panel (inline) */}
          {activeSection && (
            <div className="hidden lg:block">
              <div className="card lg:p-6">
                <button
                  onClick={() => {
                    setActiveSection(null)
                    setIsEditing(false)
                  }}
                  className="flex items-center gap-2 text-white mb-6"
                >
                  <ChevronLeft className="w-5 h-5" />
                  <span className="font-medium">{activeSection}</span>
                </button>
                {renderSectionContent()}
              </div>
            </div>
          )}

          <div className="card mb-6 lg:mb-0">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-semibold text-white flex items-center gap-2">
                <ListTodo className="w-5 h-5 text-primary-400" />
                Daily Tasks
              </h3>
              <span className="text-primary-400 text-xs font-bold">
                {dailyTasks.filter((t) => t.completed).length}/{dailyTasks.length} Done
              </span>
            </div>
            <div className="space-y-3 lg:grid lg:grid-cols-2 lg:gap-3 lg:space-y-0">
              {dailyTasks.map((task) => (
                <div
                  key={task.id}
                  className={`flex items-center justify-between p-3 rounded-xl border transition-colors ${task.completed ? 'bg-primary-500/5 border-primary-500/20' : 'bg-dark-800 border-white/5'}`}
                >
                  <div className="flex items-center gap-3">
                    {task.completed ? (
                      <div className="w-5 h-5 rounded-full bg-primary-500 flex items-center justify-center">
                        <CheckCircle2 className="w-3.5 h-3.5 text-white" />
                      </div>
                    ) : (
                      <Circle className="w-5 h-5 text-dark-500" />
                    )}
                    <div>
                      <p
                        className={`text-sm font-medium ${task.completed ? 'text-primary-200' : 'text-white'}`}
                      >
                        {task.name}
                      </p>
                      <div className="flex items-center gap-1 mt-0.5">
                        {task.rewardType === 'wallet' ? (
                          <Wallet className="w-3 h-3 text-green-400" />
                        ) : (
                          <Disc className="w-3 h-3 text-secondary-400" />
                        )}
                        <span
                          className={`text-[10px] font-bold ${task.rewardType === 'wallet' ? 'text-green-400' : 'text-secondary-400'}`}
                        >
                          {task.rewardType === 'wallet'
                            ? `+₹${task.reward} Wallet Cash`
                            : `+${task.reward} Tires`}
                        </span>
                      </div>
                    </div>
                  </div>
                  {!task.completed ? (
                    <button
                      onClick={() => handleTaskAction(task)}
                      className="text-[10px] font-bold uppercase tracking-wider text-primary-400 px-3 py-1.5 bg-primary-500/10 rounded-lg hover:bg-primary-500/20"
                    >
                      {task.actionType === 'share' ? 'Share' : 'Go'}
                    </button>
                  ) : null}
                </div>
              ))}
            </div>
          </div>

          <div className="card mb-6">
            <div className="flex items-center justify-between mb-3">
              <h3 className="font-semibold text-white flex items-center gap-2">
                <Award className="w-5 h-5 text-yellow-400" /> Achievements
              </h3>
              <span className="text-dark-400 text-sm">
                {achievements.filter((a) => a.unlocked).length}/{achievements.length}
              </span>
            </div>
            <div className="flex gap-3 overflow-x-auto no-scrollbar lg:grid lg:grid-cols-4 xl:grid-cols-5 lg:overflow-visible">
              {achievements.map((ach) => (
                <div
                  key={ach.id}
                  className={`flex-shrink-0 w-16 lg:w-auto text-center ${!ach.unlocked && 'opacity-40'}`}
                >
                  <div
                    className={`w-12 h-12 mx-auto rounded-xl flex items-center justify-center text-2xl ${ach.unlocked ? 'bg-gradient-to-br from-yellow-500/20 to-orange-500/20' : 'bg-dark-700'}`}
                  >
                    {ach.unlocked ? (
                      ach.icon === 'ASQUARE_LOGO' ? (
                        <GokartIcon size="md" className="!rounded-xl" />
                      ) : (
                        ach.icon
                      )
                    ) : (
                      '🔒'
                    )}
                  </div>
                  <div className="text-[10px] text-dark-400 mt-1">{ach.name}</div>
                </div>
              ))}
            </div>
          </div>

          <div className="card bg-gradient-to-r from-primary-500/20 to-secondary-500/20 border-primary-500/30 mb-6">
            <div className="flex items-center gap-4">
              <div className="w-12 h-12 rounded-xl bg-primary-500/30 flex items-center justify-center">
                <Gift className="w-6 h-6 text-primary-400" />
              </div>
              <div className="flex-1">
                <h3 className="font-semibold text-white">Refer & Earn</h3>
                <p className="text-dark-400 text-sm">Both get 500 tires!</p>
              </div>
              <div className="text-right">
                <div className="bg-dark-800 px-3 py-1 rounded-lg font-mono text-primary-400 text-sm">
                  {referralCodeFor(user) || '—'}
                </div>
                <button
                  onClick={handleShare}
                  className="text-primary-400 text-xs mt-1 flex items-center gap-1 ml-auto"
                >
                  <Share2 className="w-3 h-3" /> Share
                </button>
              </div>
            </div>
          </div>

          <div className="card mb-6">
            <div className="flex items-center justify-between mb-3">
              <h3 className="font-semibold text-white flex items-center gap-2">
                <MessageSquare className="w-5 h-5 text-primary-400" />
                My tickets
              </h3>
              <button
                type="button"
                onClick={() => navigate('/help')}
                className="text-xs font-medium text-primary-400 hover:text-primary-300"
              >
                View all
              </button>
            </div>
            {!user ? (
              <p className="text-white/50 text-sm py-4 text-center">Sign in to see your tickets.</p>
            ) : myTickets.length === 0 ? (
              <div className="text-center py-6">
                <p className="text-white/60 text-sm">No tickets yet.</p>
                <button
                  type="button"
                  onClick={() => navigate('/help')}
                  className="mt-2 text-xs font-medium text-primary-400 hover:text-primary-300"
                >
                  Need help? Raise a ticket →
                </button>
              </div>
            ) : (
              <div className="space-y-2">
                {myTickets.slice(0, 5).map((t) => (
                  <CustomerTicketCard key={t.id} ticket={t} />
                ))}
              </div>
            )}
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-2 md:gap-3">
            {[
              { icon: User, label: 'Personal Details' },
              { icon: CreditCard, label: 'Payment Methods' },
              { icon: Bell, label: 'Notifications' },
              { icon: Shield, label: 'Privacy & Security' },
              { icon: MessageSquare, label: 'Support' },
              { icon: HelpCircle, label: 'FAQ' },
            ].map((item, i) => (
              <button
                key={i}
                onClick={() => setActiveSection(item.label)}
                className="w-full flex items-center gap-3 p-4 lg:p-5 bg-dark-800 rounded-xl hover:bg-dark-700 transition-colors"
              >
                <item.icon className="w-5 h-5 md:w-6 md:h-6 text-primary-400" />
                <span className="flex-1 text-left text-white">{item.label}</span>
                <ChevronRight className="w-4 h-4 text-dark-500" />
              </button>
            ))}

            <button
              onClick={handleLogout}
              className="w-full flex items-center gap-3 p-4 lg:p-5 bg-dark-800 rounded-xl hover:bg-red-500/10 transition-colors text-red-400"
            >
              <LogOut className="w-5 h-5" />
              <span className="flex-1 text-left">Logout</span>
            </button>
          </div>

          <p className="text-center lg:text-left text-dark-600 text-xs mt-6">
            A Square Go-Karting v1.0.0
          </p>
        </div>
        {/* end right column */}
      </div>
      {/* end dashboard grid */}

      <VerificationModal
        isOpen={isVerificationModalOpen}
        onClose={() => {
          setIsVerificationModalOpen(false)
          setTimeout(() => {
            if (!auth.currentUser) navigate('/activities')
          }, 100)
        }}
      />
    </div>
  )
}
