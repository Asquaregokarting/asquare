import type { UpdateData, DocumentData } from 'firebase/firestore'
import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  orderBy,
  query,
  runTransaction,
  setDoc,
  updateDoc,
  where,
  writeBatch,
  type QueryConstraint,
} from 'firebase/firestore'
import { getDownloadURL, getStorage, ref, uploadBytes } from 'firebase/storage'
import { initializeFirestore } from '../lib/firebase'
import { getFirestoreSessionUser } from './firestore-session'
import { nowIso, toOptionalString, stripUndefined } from './firestore-utils'
import type {
  KartfluencerRecord,
  KartfluencerReel,
  KartfluencerNotification,
  KartfluencerStatus,
  KartfluencerTier,
  KartfluencerViewTier,
  KartfluencerStats,
  KartfluencerImportBatch,
  KartfluencerWalletTransaction,
  KartfluencerWithdrawal,
  KartfluencerBookingHistory,
  KartfluencerProfileData,
} from './types'

// ─── Follower Tier Constants (Eligibility) ──────────────────────

export const KARTFLUENCER_TIERS: Array<{
  tier: KartfluencerTier
  label: string
  minFollowers: number
  maxFollowers: number
  reward: string
}> = [
  { tier: 'not_eligible', label: 'Not Eligible', minFollowers: 0, maxFollowers: 9999, reward: '—' },
  {
    tier: 'access_10k',
    label: '10K–25K',
    minFollowers: 10000,
    maxFollowers: 24999,
    reward: '2 Access Passes',
  },
  {
    tier: 'access_25k',
    label: '25K–50K',
    minFollowers: 25000,
    maxFollowers: 49999,
    reward: 'All Access Pass',
  },
  {
    tier: 'bronze',
    label: 'Bronze (50K–70K)',
    minFollowers: 50000,
    maxFollowers: 69999,
    reward: 'Access Pass + Priority',
  },
  {
    tier: 'silver',
    label: 'Silver (70K–90K)',
    minFollowers: 70000,
    maxFollowers: 89999,
    reward: 'VIP Access',
  },
  {
    tier: 'gold',
    label: 'Gold (90K–100K)',
    minFollowers: 90000,
    maxFollowers: 99999,
    reward: 'VIP Access + Merch',
  },
  {
    tier: 'elite',
    label: 'Elite (100K+)',
    minFollowers: 100000,
    maxFollowers: Infinity,
    reward: 'Full VIP Package',
  },
]

export const getTierForFollowers = (count: number): KartfluencerTier => {
  for (const t of KARTFLUENCER_TIERS) {
    if (count >= t.minFollowers && count <= t.maxFollowers) return t.tier
  }
  return 'not_eligible'
}

export const getTierFromRange = (range: string): KartfluencerTier => {
  const map: Record<string, KartfluencerTier> = {
    '10k-25k': 'access_10k',
    '25k-50k': 'access_25k',
    '50k-70k': 'bronze',
    '70k-90k': 'silver',
    '90k-100k': 'gold',
    '100k+': 'elite',
  }
  return map[range.toLowerCase()] ?? 'not_eligible'
}

// ─── View Payment Tier Constants ────────────────────────────────

export const VIEW_PAYMENT_TIERS: Array<{
  tier: KartfluencerViewTier
  label: string
  minViews: number
  maxViews: number
  payout: number
}> = [
  { tier: 'below_threshold', label: 'Below 50K', minViews: 0, maxViews: 49999, payout: 0 },
  { tier: 'starter', label: 'Starter (50K–100K)', minViews: 50000, maxViews: 99999, payout: 1000 },
  {
    tier: 'bronze_views',
    label: 'Bronze (100K–200K)',
    minViews: 100000,
    maxViews: 199999,
    payout: 2000,
  },
  {
    tier: 'silver_views',
    label: 'Silver (200K–500K)',
    minViews: 200000,
    maxViews: 499999,
    payout: 3500,
  },
  { tier: 'gold_views', label: 'Gold (500K–1M)', minViews: 500000, maxViews: 999999, payout: 5500 },
  { tier: 'viral', label: 'Viral (1M+)', minViews: 1000000, maxViews: Infinity, payout: 10000 },
]

export const getViewTierForCount = (views: number): KartfluencerViewTier => {
  for (const t of VIEW_PAYMENT_TIERS) {
    if (views >= t.minViews && views <= t.maxViews) return t.tier
  }
  return 'below_threshold'
}

export const getViewTierPayout = (tier: KartfluencerViewTier): number =>
  VIEW_PAYMENT_TIERS.find((t) => t.tier === tier)?.payout ?? 0

/** Calculate incremental payout when advancing from one tier to another. */
export const calculateIncrementalPayout = (
  currentTier: KartfluencerViewTier,
  highestPaidTier: KartfluencerViewTier,
): number => {
  const currentPayout = getViewTierPayout(currentTier)
  const paidPayout = getViewTierPayout(highestPaidTier)
  return Math.max(0, currentPayout - paidPayout)
}

// ─── URL Normalization (Reel Deduplication) ─────────────────────

export const normalizeReelUrl = (url: string): string => {
  try {
    const parsed = new URL(url.trim())
    // Remove query params and hash
    const path = parsed.pathname.replace(/\/+$/, '')
    // Normalize www.instagram.com → instagram.com
    const host = parsed.hostname.replace(/^www\./, '')
    return `${host}${path}`.toLowerCase()
  } catch {
    // If URL parsing fails, do basic normalization
    return url.trim().toLowerCase().replace(/\?.*$/, '').replace(/\/+$/, '')
  }
}

// ─── Status Transitions ─────────────────────────────────────────

const VALID_TRANSITIONS: Record<KartfluencerStatus, KartfluencerStatus[]> = {
  detailed: ['visited', 'disqualified'],
  visited: ['reel_submitted', 'disqualified'],
  reel_submitted: ['verified', 'disqualified'],
  verified: ['active', 'disqualified'],
  active: ['disqualified'],
  disqualified: [],
}

const assertStatusTransition = (from: KartfluencerStatus, to: KartfluencerStatus): void => {
  if (!VALID_TRANSITIONS[from]?.includes(to)) {
    throw new Error(`Invalid status transition: ${from} → ${to}`)
  }
}

// ─── Helpers ─────────────────────────────────────────────────────

const getFirestore_ = () => {
  const fs = initializeFirestore()
  if (!fs) throw new Error('Firestore not configured.')
  return fs
}

const influencersCol = () => collection(getFirestore_(), 'kartfluencers')
const influencerRef = (id: string) => doc(getFirestore_(), 'kartfluencers', id)
const reelsCol = (influencerId: string) =>
  collection(getFirestore_(), 'kartfluencers', influencerId, 'reels')
const reelRef = (influencerId: string, reelId: string) =>
  doc(getFirestore_(), 'kartfluencers', influencerId, 'reels', reelId)
const walletDoc = (influencerId: string) =>
  doc(getFirestore_(), 'kartfluencers', influencerId, 'wallet', 'data')
const walletTxCol = (influencerId: string) =>
  collection(getFirestore_(), 'kartfluencers', influencerId, 'wallet_transactions')
const notificationsCol = () => collection(getFirestore_(), 'kartfluencer_notifications')
const notificationRef = (id: string) => doc(getFirestore_(), 'kartfluencer_notifications', id)
const withdrawalsCol = () => collection(getFirestore_(), 'kartfluencer_withdrawals')
const withdrawalRef = (id: string) => doc(getFirestore_(), 'kartfluencer_withdrawals', id)
const importBatchesCol = () => collection(getFirestore_(), 'kartfluencer_imports')

const mapRecord = (id: string, data: Record<string, unknown>): KartfluencerRecord => ({
  id,
  instagramHandle: String(data.instagramHandle ?? ''),
  phoneCountryCode: String(data.phoneCountryCode ?? '+91'),
  phoneNumber: String(data.phoneNumber ?? ''),
  branchId: String(data.branchId ?? ''),
  branchName: String(data.branchName ?? ''),
  visitDate: String(data.visitDate ?? ''),
  followersRange: String(data.followersRange ?? ''),
  followerCount: data.followerCount != null ? Number(data.followerCount) : undefined,
  tier: (data.tier as KartfluencerTier) ?? 'not_eligible',
  status: (data.status as KartfluencerStatus) ?? 'detailed',
  upiId: toOptionalString(data.upiId),
  upiName: toOptionalString(data.upiName),
  walletBalance: data.walletBalance != null ? Number(data.walletBalance) : 0,
  totalEarned: data.totalEarned != null ? Number(data.totalEarned) : 0,
  totalWithdrawn: data.totalWithdrawn != null ? Number(data.totalWithdrawn) : 0,
  qrCode: toOptionalString(data.qrCode),
  disqualifiedReason: toOptionalString(data.disqualifiedReason),
  instagramVerified: Boolean(data.instagramVerified),
  instagramUserId: toOptionalString(data.instagramUserId),
  liveFollowerCount: data.liveFollowerCount != null ? Number(data.liveFollowerCount) : undefined,
  lastFollowerFetchAt: toOptionalString(data.lastFollowerFetchAt),
  instagramBio: toOptionalString(data.instagramBio),
  instagramMediaCount:
    data.instagramMediaCount != null ? Number(data.instagramMediaCount) : undefined,
  profilePictureUrl: toOptionalString(data.profilePictureUrl),
  influencerScore: data.influencerScore != null ? Number(data.influencerScore) : undefined,
  createdAt: String(data.createdAt ?? nowIso()),
  updatedAt: String(data.updatedAt ?? nowIso()),
  createdBy: toOptionalString(data.createdBy),
  updatedBy: toOptionalString(data.updatedBy),
})

const mapReel = (id: string, data: Record<string, unknown>): KartfluencerReel => ({
  id,
  influencerId: String(data.influencerId ?? ''),
  reelLink: String(data.reelLink ?? ''),
  normalizedReelLink: String(data.normalizedReelLink ?? ''),
  instagramMediaId: toOptionalString(data.instagramMediaId),
  status: (data.status as KartfluencerReel['status']) ?? 'pending',
  viewCount: Number(data.viewCount ?? 0),
  lastViewFetchAt: toOptionalString(data.lastViewFetchAt),
  currentViewTier: (data.currentViewTier as KartfluencerViewTier) ?? 'below_threshold',
  highestPaidTier: (data.highestPaidTier as KartfluencerViewTier) ?? 'below_threshold',
  totalEarned: Number(data.totalEarned ?? 0),
  milestoneReady: Boolean(data.milestoneReady),
  reviewedBy: toOptionalString(data.reviewedBy),
  reviewedAt: toOptionalString(data.reviewedAt),
  createdAt: String(data.createdAt ?? nowIso()),
})

const mapNotification = (id: string, data: Record<string, unknown>): KartfluencerNotification => ({
  id,
  title: String(data.title ?? ''),
  message: String(data.message ?? ''),
  type: (data.type as KartfluencerNotification['type']) ?? 'info',
  isActive: Boolean(data.isActive ?? true),
  branchId: toOptionalString(data.branchId),
  createdAt: String(data.createdAt ?? nowIso()),
})

const mapWithdrawal = (id: string, data: Record<string, unknown>): KartfluencerWithdrawal => ({
  id,
  influencerId: String(data.influencerId ?? ''),
  instagramHandle: String(data.instagramHandle ?? ''),
  amount: Number(data.amount ?? 0),
  upiId: String(data.upiId ?? ''),
  upiName: String(data.upiName ?? ''),
  status: (data.status as KartfluencerWithdrawal['status']) ?? 'pending',
  method: (data.method as KartfluencerWithdrawal['method']) ?? undefined,
  paymentProofUrl: toOptionalString(data.paymentProofUrl),
  razorpayPayoutId: toOptionalString(data.razorpayPayoutId),
  rejectionReason: toOptionalString(data.rejectionReason),
  requestedAt: String(data.requestedAt ?? nowIso()),
  processedAt: toOptionalString(data.processedAt),
  processedBy: toOptionalString(data.processedBy),
})

const mapWalletTx = (id: string, data: Record<string, unknown>): KartfluencerWalletTransaction => ({
  id,
  type: (data.type as KartfluencerWalletTransaction['type']) ?? 'adjustment',
  amount: Number(data.amount ?? 0),
  balance: Number(data.balance ?? 0),
  reelId: toOptionalString(data.reelId),
  viewTier: toOptionalString(data.viewTier),
  withdrawalId: toOptionalString(data.withdrawalId),
  description: String(data.description ?? ''),
  createdAt: String(data.createdAt ?? nowIso()),
  createdBy: String(data.createdBy ?? ''),
})

// ─── Influencer CRUD ─────────────────────────────────────────────

export interface CreateKartfluencerPayload {
  instagramHandle: string
  phoneCountryCode?: string
  phoneNumber: string
  branchId: string
  branchName: string
  visitDate: string
  followersRange: string
  followerCount?: number
  tier?: KartfluencerTier
  instagramVerified?: boolean
  instagramUserId?: string
  profilePictureUrl?: string
}

export const createKartfluencer = async (
  token: string,
  payload: CreateKartfluencerPayload,
): Promise<KartfluencerRecord> => {
  const user = await getFirestoreSessionUser(token)

  const handle = payload.instagramHandle.trim().replace(/^@?/, '@')
  if (!handle || handle === '@') throw new Error('Instagram handle is required.')
  if (!payload.phoneNumber.trim()) throw new Error('Phone number is required.')

  // Check for duplicate handle
  const dupQ = query(influencersCol(), where('instagramHandle', '==', handle))
  const dupSnap = await getDocs(dupQ)
  if (!dupSnap.empty) throw new Error(`Influencer ${handle} already exists.`)

  const tier = payload.tier ?? getTierFromRange(payload.followersRange)
  const now = nowIso()
  const qrCode = `KARTFLUENCER:${Date.now()}:${handle}`

  const body: Record<string, unknown> = stripUndefined({
    instagramHandle: handle,
    phoneCountryCode: payload.phoneCountryCode ?? '+91',
    phoneNumber: payload.phoneNumber.trim(),
    branchId: payload.branchId,
    branchName: payload.branchName,
    visitDate: payload.visitDate,
    followersRange: payload.followersRange,
    followerCount: payload.followerCount,
    tier,
    status: 'detailed',
    walletBalance: 0,
    totalEarned: 0,
    totalWithdrawn: 0,
    qrCode,
    instagramVerified: payload.instagramVerified ?? false,
    instagramUserId: payload.instagramUserId,
    createdAt: now,
    updatedAt: now,
    createdBy: user.id,
    updatedBy: user.id,
  })

  const created = await addDoc(influencersCol(), body)

  // Initialize wallet
  await setDoc(walletDoc(created.id), {
    balance: 0,
    totalEarned: 0,
    totalWithdrawn: 0,
    lastUpdatedAt: now,
  })

  return mapRecord(created.id, { ...body, qrCode })
}

export const getKartfluencer = async (token: string, id: string): Promise<KartfluencerRecord> => {
  await getFirestoreSessionUser(token)
  const snap = await getDoc(influencerRef(id))
  if (!snap.exists()) throw new Error('Influencer not found.')
  return mapRecord(snap.id, snap.data() as UpdateData<DocumentData>)
}

export interface ListKartfluencersFilter {
  status?: KartfluencerStatus
  tier?: KartfluencerTier
  branchId?: string
}

export const listKartfluencers = async (
  token: string,
  filter?: ListKartfluencersFilter,
): Promise<KartfluencerRecord[]> => {
  await getFirestoreSessionUser(token)

  const constraints: QueryConstraint[] = []
  if (filter?.status) constraints.push(where('status', '==', filter.status))
  if (filter?.tier) constraints.push(where('tier', '==', filter.tier))
  if (filter?.branchId) constraints.push(where('branchId', '==', filter.branchId))
  constraints.push(orderBy('createdAt', 'desc'))

  const q = query(influencersCol(), ...constraints)
  const snap = await getDocs(q)
  return snap.docs.map((d) => mapRecord(d.id, d.data() as UpdateData<DocumentData>))
}

export interface UpdateKartfluencerPayload {
  instagramHandle?: string
  phoneCountryCode?: string
  phoneNumber?: string
  branchId?: string
  branchName?: string
  visitDate?: string
  followersRange?: string
  followerCount?: number
  tier?: KartfluencerTier
  upiId?: string
  upiName?: string
  instagramVerified?: boolean
  instagramUserId?: string
}

export const updateKartfluencer = async (
  token: string,
  id: string,
  payload: UpdateKartfluencerPayload,
): Promise<void> => {
  const user = await getFirestoreSessionUser(token)
  const body: Record<string, unknown> = stripUndefined({
    ...payload,
    updatedAt: nowIso(),
    updatedBy: user.id,
  })

  if (payload.instagramHandle) {
    body.instagramHandle = payload.instagramHandle.trim().replace(/^@?/, '@')
  }

  await updateDoc(influencerRef(id), body as UpdateData<DocumentData>)
}

export const deleteKartfluencer = async (token: string, id: string): Promise<void> => {
  await getFirestoreSessionUser(token)
  await deleteDoc(influencerRef(id))
}

export const updateKartfluencerStatus = async (
  token: string,
  id: string,
  newStatus: KartfluencerStatus,
  reason?: string,
): Promise<void> => {
  const user = await getFirestoreSessionUser(token)
  const snap = await getDoc(influencerRef(id))
  if (!snap.exists()) throw new Error('Influencer not found.')

  const current = snap.data() as UpdateData<DocumentData>
  const currentStatus = current.status as KartfluencerStatus
  assertStatusTransition(currentStatus, newStatus)

  const body: Record<string, unknown> = {
    status: newStatus,
    updatedAt: nowIso(),
    updatedBy: user.id,
  }

  if (newStatus === 'disqualified' && reason) {
    body.disqualifiedReason = reason
  }

  await updateDoc(influencerRef(id), stripUndefined(body) as UpdateData<DocumentData>)
}

// ─── QR Visit Verification ──────────────────────────────────────

export const markVisitedByQR = async (
  token: string,
  qrData: string,
): Promise<{ influencerId: string; handle: string }> => {
  const user = await getFirestoreSessionUser(token)

  // Parse QR: KARTFLUENCER:{timestamp}:{handle}
  if (!qrData.startsWith('KARTFLUENCER:')) {
    throw new Error('Invalid Kartfluencer QR code.')
  }

  // Find influencer by qrCode field
  const q = query(influencersCol(), where('qrCode', '==', qrData))
  const snap = await getDocs(q)
  if (snap.empty) throw new Error('Influencer not found for this QR code.')

  const infDoc = snap.docs[0]
  const data = infDoc.data() as UpdateData<DocumentData>
  const currentStatus = data.status as KartfluencerStatus

  if (currentStatus !== 'detailed') {
    throw new Error(`Cannot mark as visited — influencer is already "${currentStatus}".`)
  }

  await updateDoc(influencerRef(infDoc.id), {
    status: 'visited',
    visitDate: nowIso().split('T')[0],
    updatedAt: nowIso(),
    updatedBy: user.id,
  })

  return { influencerId: infDoc.id, handle: String(data.instagramHandle) }
}

// ─── Reels (with duplicate detection) ───────────────────────────

export const addKartfluencerReel = async (
  token: string,
  influencerId: string,
  reelLink: string,
): Promise<KartfluencerReel> => {
  const user = await getFirestoreSessionUser(token)

  const link = reelLink.trim()
  if (!link) throw new Error('Reel link is required.')

  const normalized = normalizeReelUrl(link)

  // Strict duplicate detection across ALL influencers
  const allInfluencers = await getDocs(query(influencersCol()))
  for (const inf of allInfluencers.docs) {
    const dupQ = query(reelsCol(inf.id), where('normalizedReelLink', '==', normalized))
    const dupSnap = await getDocs(dupQ)
    if (!dupSnap.empty) {
      const existingInf = inf.data() as UpdateData<DocumentData>
      throw new Error(
        `This reel has already been submitted by ${String(existingInf.instagramHandle ?? 'another influencer')}. Duplicate reels are not allowed.`,
      )
    }
  }

  const now = nowIso()
  const body = {
    influencerId,
    reelLink: link,
    normalizedReelLink: normalized,
    status: 'pending',
    viewCount: 0,
    currentViewTier: 'below_threshold',
    highestPaidTier: 'below_threshold',
    totalEarned: 0,
    milestoneReady: false,
    createdAt: now,
  }

  const created = await addDoc(reelsCol(influencerId), body)

  // Auto-update influencer status to reel_submitted if currently visited
  const snap = await getDoc(influencerRef(influencerId))
  if (snap.exists()) {
    const data = snap.data() as UpdateData<DocumentData>
    if (data.status === 'visited') {
      await updateDoc(influencerRef(influencerId), {
        status: 'reel_submitted',
        updatedAt: now,
        updatedBy: user.id,
      })
    }
  }

  return mapReel(created.id, { ...body, influencerId })
}

export const listKartfluencerReels = async (
  token: string,
  influencerId?: string,
): Promise<KartfluencerReel[]> => {
  await getFirestoreSessionUser(token)

  if (influencerId) {
    const q = query(reelsCol(influencerId), orderBy('createdAt', 'desc'))
    const snap = await getDocs(q)
    return snap.docs.map((d) => mapReel(d.id, d.data() as UpdateData<DocumentData>))
  }

  // List all reels across all influencers (for admin review view)
  const allInfluencers = await getDocs(query(influencersCol()))
  const allReels: KartfluencerReel[] = []
  for (const inf of allInfluencers.docs) {
    const q = query(reelsCol(inf.id), orderBy('createdAt', 'desc'))
    const snap = await getDocs(q)
    allReels.push(
      ...snap.docs.map((d) =>
        mapReel(d.id, { ...d.data(), influencerId: inf.id } as UpdateData<DocumentData>),
      ),
    )
  }
  return allReels.sort((a, b) => b.createdAt.localeCompare(a.createdAt))
}

export const updateKartfluencerReel = async (
  token: string,
  influencerId: string,
  reelId: string,
  status: 'verified' | 'rejected',
): Promise<void> => {
  const user = await getFirestoreSessionUser(token)
  await updateDoc(reelRef(influencerId, reelId), {
    status,
    reviewedBy: user.id,
    reviewedAt: nowIso(),
  })
}

export const deleteKartfluencerReel = async (
  token: string,
  influencerId: string,
  reelId: string,
): Promise<void> => {
  await getFirestoreSessionUser(token)
  await deleteDoc(reelRef(influencerId, reelId))
}

/** Update view count for a reel and check for milestone advancement. */
export const updateReelViews = async (
  token: string,
  influencerId: string,
  reelId: string,
  viewCount: number,
): Promise<{ milestoneReady: boolean; pendingAmount: number }> => {
  await getFirestoreSessionUser(token)

  const snap = await getDoc(reelRef(influencerId, reelId))
  if (!snap.exists()) throw new Error('Reel not found.')

  const data = snap.data() as UpdateData<DocumentData>
  const highestPaid = (data.highestPaidTier as KartfluencerViewTier) ?? 'below_threshold'
  const newTier = getViewTierForCount(viewCount)
  const pendingAmount = calculateIncrementalPayout(newTier, highestPaid)
  const milestoneReady = pendingAmount > 0

  await updateDoc(reelRef(influencerId, reelId), {
    viewCount,
    currentViewTier: newTier,
    lastViewFetchAt: nowIso(),
    milestoneReady,
  })

  return { milestoneReady, pendingAmount }
}

/** Admin approves a milestone payout — credits the wallet. */
export const approveMilestonePayout = async (
  token: string,
  influencerId: string,
  reelId: string,
): Promise<{ amount: number; newBalance: number }> => {
  const user = await getFirestoreSessionUser(token)
  const fs = getFirestore_()

  const reelSnap = await getDoc(reelRef(influencerId, reelId))
  if (!reelSnap.exists()) throw new Error('Reel not found.')

  const reelData = reelSnap.data() as UpdateData<DocumentData>
  const currentTier = (reelData.currentViewTier as KartfluencerViewTier) ?? 'below_threshold'
  const highestPaid = (reelData.highestPaidTier as KartfluencerViewTier) ?? 'below_threshold'
  const amount = calculateIncrementalPayout(currentTier, highestPaid)

  if (amount <= 0) throw new Error('No pending milestone payout for this reel.')

  // Atomic wallet credit
  const walletRef = walletDoc(influencerId)
  const infRef = influencerRef(influencerId)
  const now = nowIso()

  let newBalance = 0

  await runTransaction(fs, async (tx) => {
    const walletSnap = await tx.get(walletRef)
    const currentBalance = walletSnap.exists() ? Number(walletSnap.data().balance ?? 0) : 0
    const currentEarned = walletSnap.exists() ? Number(walletSnap.data().totalEarned ?? 0) : 0
    newBalance = currentBalance + amount

    // Update wallet
    tx.set(walletRef, {
      balance: newBalance,
      totalEarned: currentEarned + amount,
      totalWithdrawn: walletSnap.exists() ? Number(walletSnap.data().totalWithdrawn ?? 0) : 0,
      lastUpdatedAt: now,
    })

    // Log transaction
    const txRef = doc(walletTxCol(influencerId))
    tx.set(txRef, {
      type: 'milestone_credit',
      amount,
      balance: newBalance,
      reelId,
      viewTier: currentTier,
      description: `Milestone payout: reel reached ${VIEW_PAYMENT_TIERS.find((t) => t.tier === currentTier)?.label ?? currentTier}`,
      createdAt: now,
      createdBy: user.id,
    })

    // Update reel
    tx.update(reelRef(influencerId, reelId), {
      highestPaidTier: currentTier,
      totalEarned: Number(reelData.totalEarned ?? 0) + amount,
      milestoneReady: false,
    })

    // Update influencer totals
    const infSnap = await tx.get(infRef)
    const infData = infSnap.data() as UpdateData<DocumentData>
    tx.update(infRef, {
      walletBalance: newBalance,
      totalEarned: Number(infData.totalEarned ?? 0) + amount,
      updatedAt: now,
      updatedBy: user.id,
    })
  })

  return { amount, newBalance }
}

// ─── Wallet ──────────────────────────────────────────────────────

export const getWalletBalance = async (
  token: string,
  influencerId: string,
): Promise<{ balance: number; totalEarned: number; totalWithdrawn: number }> => {
  await getFirestoreSessionUser(token)
  const snap = await getDoc(walletDoc(influencerId))
  if (!snap.exists()) return { balance: 0, totalEarned: 0, totalWithdrawn: 0 }
  const data = snap.data()
  return {
    balance: Number(data.balance ?? 0),
    totalEarned: Number(data.totalEarned ?? 0),
    totalWithdrawn: Number(data.totalWithdrawn ?? 0),
  }
}

export const getWalletHistory = async (
  token: string,
  influencerId: string,
): Promise<KartfluencerWalletTransaction[]> => {
  await getFirestoreSessionUser(token)
  const q = query(walletTxCol(influencerId), orderBy('createdAt', 'desc'))
  const snap = await getDocs(q)
  return snap.docs.map((d) => mapWalletTx(d.id, d.data() as UpdateData<DocumentData>))
}

// ─── Withdrawals ─────────────────────────────────────────────────

export const requestWithdrawal = async (
  token: string,
  influencerId: string,
  amount: number,
  upiId: string,
  upiName: string,
): Promise<KartfluencerWithdrawal> => {
  await getFirestoreSessionUser(token)

  if (amount <= 0) throw new Error('Withdrawal amount must be positive.')
  if (!upiId.trim()) throw new Error('UPI ID is required.')

  const fs = getFirestore_()
  const trimmedUpiId = upiId.trim()
  const trimmedUpiName = upiName.trim()

  // Atomically: read wallet (with running pendingWithdrawalAmount), verify
  // available balance, increment pendingWithdrawalAmount, and create the
  // withdrawal doc — all inside a single Firestore transaction.
  //
  // Without this, two concurrent requests (two browser tabs / fast double-
  // submit) could both pass the same balance check and create two pending
  // withdrawals that, between them, exceeded the wallet balance. The
  // transaction's read+write on the wallet doc forces Firestore's optimistic
  // concurrency to serialize them; the second attempt re-reads the updated
  // pendingWithdrawalAmount and rejects if it's now over-budget.
  //
  // processWithdrawal / rejectWithdrawal must mirror this by decrementing
  // pendingWithdrawalAmount when the withdrawal terminates.
  return await runTransaction(fs, async (txn) => {
    const walletSnap = await txn.get(walletDoc(influencerId))
    const balance = walletSnap.exists() ? Number(walletSnap.data().balance ?? 0) : 0
    const pendingTotal = walletSnap.exists()
      ? Number(walletSnap.data().pendingWithdrawalAmount ?? 0)
      : 0
    const available = balance - pendingTotal
    if (amount > available) {
      throw new Error(
        `Insufficient available balance. Available: ₹${available}` +
          (pendingTotal > 0 ? ` (₹${pendingTotal} pending)` : ''),
      )
    }

    const infSnap = await txn.get(influencerRef(influencerId))
    if (!infSnap.exists()) throw new Error('Influencer not found.')
    const infData = infSnap.data() as UpdateData<DocumentData>

    txn.set(
      walletDoc(influencerId),
      {
        pendingWithdrawalAmount: pendingTotal + amount,
        lastUpdatedAt: nowIso(),
      },
      { merge: true },
    )

    const now = nowIso()
    const body = {
      influencerId,
      instagramHandle: String(infData.instagramHandle ?? ''),
      amount,
      upiId: trimmedUpiId,
      upiName: trimmedUpiName,
      status: 'pending',
      requestedAt: now,
    }

    const newRef = doc(withdrawalsCol())
    txn.set(newRef, body)
    return mapWithdrawal(newRef.id, body as UpdateData<DocumentData>)
  })
}

export const listWithdrawals = async (
  token: string,
  statusFilter?: KartfluencerWithdrawal['status'],
): Promise<KartfluencerWithdrawal[]> => {
  await getFirestoreSessionUser(token)
  const constraints: QueryConstraint[] = []
  if (statusFilter) constraints.push(where('status', '==', statusFilter))
  constraints.push(orderBy('requestedAt', 'desc'))
  const q = query(withdrawalsCol(), ...constraints)
  const snap = await getDocs(q)
  return snap.docs.map((d) => mapWithdrawal(d.id, d.data() as UpdateData<DocumentData>))
}

export const processWithdrawal = async (
  token: string,
  withdrawalId: string,
  method: 'manual_upi' | 'razorpay',
  paymentProofUrl?: string,
): Promise<void> => {
  const user = await getFirestoreSessionUser(token)
  const fs = getFirestore_()

  const wSnap = await getDoc(withdrawalRef(withdrawalId))
  if (!wSnap.exists()) throw new Error('Withdrawal not found.')
  const wData = wSnap.data() as UpdateData<DocumentData>

  if (wData.status !== 'pending' && wData.status !== 'processing') {
    throw new Error(`Cannot process withdrawal in "${wData.status}" status.`)
  }

  const influencerId = String(wData.influencerId)
  const amount = Number(wData.amount)
  const now = nowIso()

  await runTransaction(fs, async (tx) => {
    const wRef = walletDoc(influencerId)
    const walletSnap = await tx.get(wRef)
    const currentBalance = walletSnap.exists() ? Number(walletSnap.data().balance ?? 0) : 0
    const currentPendingTotal = walletSnap.exists()
      ? Number(walletSnap.data().pendingWithdrawalAmount ?? 0)
      : 0

    if (amount > currentBalance) throw new Error('Insufficient wallet balance.')

    const newBalance = currentBalance - amount
    // Mirror requestWithdrawal: decrement the running pending total now that
    // this withdrawal is leaving the pending pool. Math.max guards against
    // legacy pending withdrawals that were created before pendingWithdrawal
    // tracking existed.
    const newPendingTotal = Math.max(0, currentPendingTotal - amount)

    // Debit wallet
    tx.update(wRef, {
      balance: newBalance,
      pendingWithdrawalAmount: newPendingTotal,
      totalWithdrawn:
        (walletSnap.exists() ? Number(walletSnap.data().totalWithdrawn ?? 0) : 0) + amount,
      lastUpdatedAt: now,
    })

    // Log transaction
    const txDocRef = doc(walletTxCol(influencerId))
    tx.set(txDocRef, {
      type: 'withdrawal',
      amount: -amount,
      balance: newBalance,
      withdrawalId,
      description: `Withdrawal processed via ${method === 'manual_upi' ? 'Manual UPI' : 'Razorpay'}`,
      createdAt: now,
      createdBy: user.id,
    })

    // Update withdrawal status
    tx.update(
      withdrawalRef(withdrawalId),
      stripUndefined({
        status: 'completed',
        method,
        paymentProofUrl: paymentProofUrl ?? null,
        processedAt: now,
        processedBy: user.id,
      }) as UpdateData<DocumentData>,
    )

    // Update influencer record
    tx.update(influencerRef(influencerId), {
      walletBalance: newBalance,
      totalWithdrawn:
        Number((await tx.get(influencerRef(influencerId))).data()?.totalWithdrawn ?? 0) + amount,
      updatedAt: now,
    })
  })
}

export const rejectWithdrawal = async (
  token: string,
  withdrawalId: string,
  reason: string,
): Promise<void> => {
  const user = await getFirestoreSessionUser(token)
  const fs = getFirestore_()

  // Read the withdrawal first to know which influencer's pending total to
  // free, then atomically: flip the withdrawal to 'rejected' AND decrement
  // pendingWithdrawalAmount on the wallet doc. Without the wallet update,
  // a rejected withdrawal would still occupy the pending pool forever and
  // permanently reduce the influencer's available balance.
  const withdrawalSnap = await getDoc(withdrawalRef(withdrawalId))
  if (!withdrawalSnap.exists()) throw new Error('Withdrawal not found.')
  const wData = withdrawalSnap.data() as UpdateData<DocumentData>
  if (wData.status !== 'pending' && wData.status !== 'processing') {
    throw new Error(`Cannot reject withdrawal in "${wData.status}" status.`)
  }
  const influencerId = String(wData.influencerId)
  const amount = Number(wData.amount)

  await runTransaction(fs, async (tx) => {
    const walletSnap = await tx.get(walletDoc(influencerId))
    const currentPendingTotal = walletSnap.exists()
      ? Number(walletSnap.data().pendingWithdrawalAmount ?? 0)
      : 0
    const newPendingTotal = Math.max(0, currentPendingTotal - amount)

    tx.update(withdrawalRef(withdrawalId), {
      status: 'rejected',
      rejectionReason: reason,
      processedAt: nowIso(),
      processedBy: user.id,
    })
    tx.set(
      walletDoc(influencerId),
      { pendingWithdrawalAmount: newPendingTotal, lastUpdatedAt: nowIso() },
      { merge: true },
    )
  })
}

// ─── Notifications ───────────────────────────────────────────────

export const createKartfluencerNotification = async (
  token: string,
  payload: {
    title: string
    message: string
    type: KartfluencerNotification['type']
    branchId?: string
  },
): Promise<KartfluencerNotification> => {
  await getFirestoreSessionUser(token)
  const body = {
    title: payload.title.trim(),
    message: payload.message.trim(),
    type: payload.type,
    isActive: true,
    branchId: payload.branchId ?? null,
    createdAt: nowIso(),
  }
  const created = await addDoc(notificationsCol(), body)
  return mapNotification(created.id, body as UpdateData<DocumentData>)
}

export const listKartfluencerNotifications = async (
  token: string,
): Promise<KartfluencerNotification[]> => {
  await getFirestoreSessionUser(token)
  const q = query(notificationsCol(), orderBy('createdAt', 'desc'))
  const snap = await getDocs(q)
  return snap.docs.map((d) => mapNotification(d.id, d.data() as UpdateData<DocumentData>))
}

export const toggleKartfluencerNotification = async (
  token: string,
  id: string,
  isActive: boolean,
): Promise<void> => {
  await getFirestoreSessionUser(token)
  await updateDoc(notificationRef(id), { isActive })
}

export const deleteKartfluencerNotification = async (token: string, id: string): Promise<void> => {
  await getFirestoreSessionUser(token)
  await deleteDoc(notificationRef(id))
}

// ─── Import ──────────────────────────────────────────────────────

export interface ImportKartfluencerRow {
  instagramHandle: string
  phoneCountryCode?: string
  phoneNumber: string
  branchId: string
  branchName: string
  visitDate: string
  followersRange: string
  status?: KartfluencerStatus
  upiId?: string
  upiName?: string
  reelLink?: string
  disqualifiedReason?: string
  createdAt?: string
}

export const importKartfluencerBatch = async (
  token: string,
  rows: ImportKartfluencerRow[],
  fileName: string,
): Promise<KartfluencerImportBatch> => {
  const user = await getFirestoreSessionUser(token)
  const now = nowIso()
  const errors: Array<{ row: number; message: string }> = []
  let successCount = 0
  const CHUNK_SIZE = 500

  for (let i = 0; i < rows.length; i += CHUNK_SIZE) {
    const chunk = rows.slice(i, i + CHUNK_SIZE)
    const batch = writeBatch(getFirestore_())

    for (let j = 0; j < chunk.length; j++) {
      const row = chunk[j]
      const rowIndex = i + j + 1

      try {
        const handle = row.instagramHandle.trim().replace(/^@?/, '@')
        if (!handle || handle === '@') {
          errors.push({ row: rowIndex, message: 'Missing Instagram handle' })
          continue
        }

        const tier = getTierFromRange(row.followersRange)
        const qrCode = `KARTFLUENCER:${Date.now() + rowIndex}:${handle}`
        const docRef = doc(influencersCol())
        batch.set(
          docRef,
          stripUndefined({
            instagramHandle: handle,
            phoneCountryCode: row.phoneCountryCode ?? '+91',
            phoneNumber: row.phoneNumber?.trim() ?? '',
            branchId: row.branchId,
            branchName: row.branchName,
            visitDate: row.visitDate ?? '',
            followersRange: row.followersRange ?? '',
            tier,
            status: row.status ?? 'detailed',
            walletBalance: 0,
            totalEarned: 0,
            totalWithdrawn: 0,
            qrCode,
            upiId: row.upiId?.trim() || null,
            upiName: row.upiName?.trim() || null,
            disqualifiedReason: row.disqualifiedReason?.trim() || null,
            instagramVerified: false,
            createdAt: row.createdAt ?? now,
            updatedAt: now,
            createdBy: user.id,
            updatedBy: user.id,
          }),
        )

        // If row has a reel link, create a reel subcollection doc
        if (row.reelLink?.trim()) {
          const normalized = normalizeReelUrl(row.reelLink)
          const reelDocRef = doc(collection(getFirestore_(), 'kartfluencers', docRef.id, 'reels'))
          batch.set(reelDocRef, {
            influencerId: docRef.id,
            reelLink: row.reelLink.trim(),
            normalizedReelLink: normalized,
            status: row.status === 'verified' || row.status === 'active' ? 'verified' : 'pending',
            viewCount: 0,
            currentViewTier: 'below_threshold',
            highestPaidTier: 'below_threshold',
            totalEarned: 0,
            milestoneReady: false,
            createdAt: row.createdAt ?? now,
          })
        }

        successCount++
      } catch (err) {
        errors.push({
          row: rowIndex,
          message: err instanceof Error ? err.message : 'Unknown error',
        })
      }
    }

    await batch.commit()
  }

  const batchRecord = {
    fileName,
    totalRows: rows.length,
    successCount,
    errorCount: errors.length,
    errors,
    importedBy: user.id,
    importedByName: user.name,
    createdAt: now,
  }

  const created = await addDoc(importBatchesCol(), batchRecord)
  return { id: created.id, ...batchRecord }
}

// ─── Stats ───────────────────────────────────────────────────────

export const getKartfluencerStats = async (
  token: string,
  branchId?: string,
): Promise<KartfluencerStats> => {
  await getFirestoreSessionUser(token)

  const constraints: QueryConstraint[] = []
  if (branchId) constraints.push(where('branchId', '==', branchId))

  const q = query(influencersCol(), ...constraints)
  const snap = await getDocs(q)

  const stats: KartfluencerStats = {
    total: 0,
    byStatus: {
      detailed: 0,
      visited: 0,
      reel_submitted: 0,
      verified: 0,
      active: 0,
      disqualified: 0,
    },
    byTier: {
      not_eligible: 0,
      access_10k: 0,
      access_25k: 0,
      bronze: 0,
      silver: 0,
      gold: 0,
      elite: 0,
    },
    pendingReels: 0,
    milestoneReadyReels: 0,
    totalPaidOut: 0,
    totalViews: 0,
    pendingWithdrawals: 0,
  }

  // Reel counts + view totals come from denormalized `reelStats` fields
  // on the influencer doc, maintained by the
  // `onReelWriteSyncKartfluencerStats` Cloud Function trigger. This makes
  // stats O(1) round-trips regardless of how many reels exist, replacing
  // the previous per-influencer reels subcollection fanout.
  //
  // If an influencer pre-dates the trigger and has no `reelStats` field,
  // its counters contribute 0 here — run the `backfillKartfluencerReelStats`
  // callable once after deploy to populate historical records.
  for (const d of snap.docs) {
    const data = d.data() as UpdateData<DocumentData>
    stats.total++
    const status = data.status as KartfluencerStatus
    const tier = data.tier as KartfluencerTier
    if (status in stats.byStatus) stats.byStatus[status]++
    if (tier in stats.byTier) stats.byTier[tier]++
    stats.totalPaidOut += Number(data.totalEarned ?? 0)

    const reelStats = (data.reelStats ?? {}) as {
      pendingCount?: number
      milestoneReadyCount?: number
      totalViews?: number
    }
    stats.pendingReels += Number(reelStats.pendingCount ?? 0)
    stats.milestoneReadyReels += Number(reelStats.milestoneReadyCount ?? 0)
    stats.totalViews += Number(reelStats.totalViews ?? 0)
  }

  // Count pending withdrawals
  const wQ = query(withdrawalsCol(), where('status', '==', 'pending'))
  const wSnap = await getDocs(wQ)
  stats.pendingWithdrawals = wSnap.size

  return stats
}

// ─── Payment Screenshot Upload ──────────────────────────────────

export const uploadPaymentScreenshot = async (
  token: string,
  influencerId: string,
  file: File,
): Promise<string> => {
  await getFirestoreSessionUser(token)

  const allowedTypes = ['image/jpeg', 'image/png', 'image/webp']
  if (!allowedTypes.includes(file.type)) {
    throw new Error('Only JPG, PNG, or WEBP images are allowed.')
  }

  const ext = file.name.split('.').pop() ?? 'jpg'
  const path = `kartfluencer/payments/${influencerId}_${Date.now()}.${ext}`
  const storage = getStorage()
  const storageRef = ref(storage, path)
  await uploadBytes(storageRef, file)
  return await getDownloadURL(storageRef)
}

// ─── Instagram Live Follower Fetch ──────────────────────────────

const IG_CONFIG_DOC = 'settings/kartfluencer_config'

const getIgConfig = async (): Promise<{
  token: string
  accountId: string
  version: string
} | null> => {
  try {
    const snap = await getDoc(doc(getFirestore_(), IG_CONFIG_DOC))
    if (!snap.exists()) return null
    const data = snap.data() as UpdateData<DocumentData>
    return {
      token: String(data.igAccessToken ?? ''),
      accountId: String(data.igBusinessAccountId ?? '17841404539448845'),
      version: String(data.igGraphApiVersion ?? 'v18.0'),
    }
  } catch {
    return null
  }
}

export const fetchLiveFollowerCount = async (
  token: string,
  influencerId: string,
): Promise<{ followers: number; mediaCount: number; bio: string } | null> => {
  await getFirestoreSessionUser(token)

  const inf = await getDoc(influencerRef(influencerId))
  if (!inf.exists()) throw new Error('Influencer not found.')
  const handle = String(inf.data().instagramHandle ?? '').replace(/^@/, '')
  if (!handle) throw new Error('No Instagram handle.')

  const igConfig = await getIgConfig()
  if (!igConfig || !igConfig.token) return null

  try {
    const url = `https://graph.facebook.com/${igConfig.version}/${igConfig.accountId}?fields=business_discovery.username(${handle}){followers_count,media_count,biography}&access_token=${igConfig.token}`
    const res = await fetch(url)
    if (!res.ok) return null
    const json = await res.json()
    const bd = json?.business_discovery
    if (!bd) return null

    const followers = Number(bd.followers_count ?? 0)
    const mediaCount = Number(bd.media_count ?? 0)
    const bio = String(bd.biography ?? '')

    // Update the influencer record
    await updateDoc(influencerRef(influencerId), {
      liveFollowerCount: followers,
      instagramMediaCount: mediaCount,
      instagramBio: bio,
      lastFollowerFetchAt: nowIso(),
      followerCount: followers,
    })

    return { followers, mediaCount, bio }
  } catch {
    return null
  }
}

// ─── Booking History Cross-Reference ────────────────────────────

export const getInfluencerBookingHistory = async (
  token: string,
  phone: string,
): Promise<{
  bookings: KartfluencerBookingHistory[]
  summary: KartfluencerProfileData['bookingSummary']
}> => {
  await getFirestoreSessionUser(token)

  const normalizedPhone = phone.replace(/\D/g, '').slice(-10)
  if (!normalizedPhone || normalizedPhone.length < 10)
    return { bookings: [], summary: { totalVisits: 0, totalSpent: 0 } }

  // Query bookings collection in asquare-app-db by indexed userPhone field
  // instead of scanning the entire collection. The helper tries the common
  // stored phone formats (10-digit, +91…, 91…) and unions the results.
  const { asquareBookingsApi } = await import('./asquare-bookings')
  const matched = await asquareBookingsApi.listBookingsByUserPhone(normalizedPhone)

  const bookings: KartfluencerBookingHistory[] = matched.map((b) => ({
    bookingId: b.id,
    sessionDate:
      b.sessionDate instanceof Date ? b.sessionDate.toISOString() : String(b.sessionDate),
    locationId: b.locationId ?? '',
    activities: b.items?.map((item) => item.activity?.name ?? 'Unknown') ?? [],
    finalAmount: b.finalAmount ?? 0,
    bookingStatus: b.bookingStatus ?? '',
    paymentStatus: b.paymentStatus ?? '',
  }))

  bookings.sort((a, b) => b.sessionDate.localeCompare(a.sessionDate))

  const summary: KartfluencerProfileData['bookingSummary'] = {
    totalVisits: bookings.length,
    totalSpent: bookings.reduce((sum, b) => sum + b.finalAmount, 0),
    firstVisitDate: bookings.length > 0 ? bookings[bookings.length - 1].sessionDate : undefined,
    lastVisitDate: bookings.length > 0 ? bookings[0].sessionDate : undefined,
  }

  return { bookings, summary }
}

// ─── Influencer Score ───────────────────────────────────────────

export const computeInfluencerScore = (
  record: KartfluencerRecord,
  reels: KartfluencerReel[],
  totalVisits: number,
): number => {
  if (record.status === 'disqualified') return 0

  // Follower score (20%) — normalize to 0-100 based on 10K-500K range
  const followers = record.liveFollowerCount ?? record.followerCount ?? 0
  const followerScore = Math.min(Math.max((followers - 10000) / 490000, 0), 1) * 100

  // Engagement ratio (30%) — total views vs follower count
  const totalViews = reels.reduce((sum, r) => sum + r.viewCount, 0)
  const engagementRatio = followers > 0 ? totalViews / followers : 0
  const engagementScore = Math.min(engagementRatio * 20, 100) // 5x views = perfect score

  // Reel count (15%) — more reels = more engagement
  const reelScore = Math.min(reels.length * 25, 100) // 4 reels = perfect

  // Visit frequency (15%) — based on actual bookings
  const visitScore = Math.min(totalVisits * 33, 100) // 3 visits = perfect

  // Reliability (20%) — active status, has verified reels
  const verifiedReels = reels.filter((r) => r.status === 'verified').length
  const reliabilityScore =
    40 + // not disqualified (already returned 0 above)
    (record.status === 'active' || record.status === 'verified' ? 30 : 0) +
    (verifiedReels > 0 ? 30 : 0)

  const score = Math.round(
    followerScore * 0.2 +
      engagementScore * 0.3 +
      reelScore * 0.15 +
      visitScore * 0.15 +
      reliabilityScore * 0.2,
  )

  return Math.max(0, Math.min(100, score))
}

// ─── Full Profile Data ──────────────────────────────────────────

export const getInfluencerProfileData = async (
  token: string,
  influencerId: string,
): Promise<KartfluencerProfileData> => {
  await getFirestoreSessionUser(token)

  const [record, reels, wallet, walletHistory] = await Promise.all([
    getKartfluencer(token, influencerId),
    listKartfluencerReels(token, influencerId),
    getWalletBalance(token, influencerId),
    getWalletHistory(token, influencerId),
  ])

  const { bookings: bookingHistory, summary: bookingSummary } = await getInfluencerBookingHistory(
    token,
    record.phoneNumber,
  )

  // Compute and save influencer score
  const score = computeInfluencerScore(record, reels, bookingSummary.totalVisits)
  if (record.influencerScore !== score) {
    await updateDoc(influencerRef(influencerId), { influencerScore: score })
    record.influencerScore = score
  }

  return { record, reels, wallet, walletHistory, bookingHistory, bookingSummary }
}

// ─── Public Portal Functions (no auth required) ─────────────────

/**
 * Check if an Instagram handle already exists in the kartfluencers collection.
 * Used by the public registration portal — no pipeline auth needed.
 */
export const checkHandleExists = async (handle: string): Promise<KartfluencerRecord | null> => {
  const h = handle.trim().replace(/^@?/, '@')
  if (!h || h === '@') return null

  const q = query(influencersCol(), where('instagramHandle', '==', h))
  const snap = await getDocs(q)
  if (snap.empty) return null
  const d = snap.docs[0]
  return mapRecord(d.id, d.data() as UpdateData<DocumentData>)
}

/**
 * Verify an Instagram handle exists on real Instagram via the Graph API.
 * Returns follower count, media count, and bio if the handle is found.
 */
export const verifyInstagramHandle = async (
  handle: string,
): Promise<{
  exists: boolean
  followers?: number
  mediaCount?: number
  bio?: string
  profilePictureUrl?: string
}> => {
  const h = handle.trim().replace(/^@/, '')
  if (!h) return { exists: false }

  const igConfig = await getIgConfig()
  if (!igConfig || !igConfig.token) {
    // No IG config — can't verify, assume exists to allow registration
    return { exists: true }
  }

  try {
    const url = `https://graph.facebook.com/${igConfig.version}/${igConfig.accountId}?fields=business_discovery.username(${h}){followers_count,media_count,biography,profile_picture_url}&access_token=${igConfig.token}`
    const res = await fetch(url)
    if (!res.ok) return { exists: false }
    const json = await res.json()
    const bd = json?.business_discovery
    if (!bd) return { exists: false }

    return {
      exists: true,
      followers: Number(bd.followers_count ?? 0),
      mediaCount: Number(bd.media_count ?? 0),
      bio: String(bd.biography ?? ''),
      profilePictureUrl: String(bd.profile_picture_url ?? ''),
    }
  } catch {
    return { exists: false }
  }
}

/**
 * Get a kartfluencer by ID — public portal version (no auth).
 */
export const getKartfluencerPublic = async (id: string): Promise<KartfluencerRecord> => {
  const snap = await getDoc(influencerRef(id))
  if (!snap.exists()) throw new Error('Influencer not found.')
  return mapRecord(snap.id, snap.data() as UpdateData<DocumentData>)
}

/**
 * List reels for an influencer — public portal version (no auth).
 */
export const listReelsPublic = async (influencerId: string): Promise<KartfluencerReel[]> => {
  const q = query(reelsCol(influencerId), orderBy('createdAt', 'desc'))
  const snap = await getDocs(q)
  return snap.docs.map((d) => mapReel(d.id, d.data() as UpdateData<DocumentData>))
}

/**
 * Submit a reel from the public portal (no auth).
 */
export const addReelPublic = async (
  influencerId: string,
  reelLink: string,
): Promise<KartfluencerReel> => {
  const link = reelLink.trim()
  if (!link) throw new Error('Reel link is required.')

  const normalized = normalizeReelUrl(link)

  // Strict duplicate detection across ALL influencers
  const allInfluencers = await getDocs(query(influencersCol()))
  for (const inf of allInfluencers.docs) {
    const reelSnap = await getDocs(query(reelsCol(inf.id)))
    for (const r of reelSnap.docs) {
      const existing = normalizeReelUrl(String(r.data().reelLink ?? ''))
      if (existing === normalized) {
        throw new Error('This reel has already been submitted.')
      }
    }
  }

  const now = nowIso()
  const body: Record<string, unknown> = {
    reelLink: link,
    normalizedReelLink: normalized,
    status: 'pending',
    viewCount: 0,
    earnedAmount: 0,
    milestonesPaid: [],
    createdAt: now,
    updatedAt: now,
    createdBy: 'self-registration',
    updatedBy: 'self-registration',
  }

  const created = await addDoc(reelsCol(influencerId), body)

  // Auto-transition influencer to reel_submitted if visited
  const infSnap = await getDoc(influencerRef(influencerId))
  if (infSnap.exists() && infSnap.data().status === 'visited') {
    await updateDoc(influencerRef(influencerId), { status: 'reel_submitted', updatedAt: now })
  }

  return mapReel(created.id, body)
}

/**
 * Get wallet balance — public portal version (no auth).
 */
export const getWalletBalancePublic = async (
  influencerId: string,
): Promise<{ balance: number; totalEarned: number; totalWithdrawn: number }> => {
  const snap = await getDoc(walletDoc(influencerId))
  if (!snap.exists()) return { balance: 0, totalEarned: 0, totalWithdrawn: 0 }
  const data = snap.data()
  return {
    balance: Number(data.balance ?? 0),
    totalEarned: Number(data.totalEarned ?? 0),
    totalWithdrawn: Number(data.totalWithdrawn ?? 0),
  }
}

/**
 * Get wallet history — public portal version (no auth).
 */
export const getWalletHistoryPublic = async (
  influencerId: string,
): Promise<KartfluencerWalletTransaction[]> => {
  const q = query(walletTxCol(influencerId), orderBy('createdAt', 'desc'))
  const snap = await getDocs(q)
  return snap.docs.map((d) => mapWalletTx(d.id, d.data() as UpdateData<DocumentData>))
}

/**
 * List notifications — public portal version (no auth).
 */
export const listNotificationsPublic = async (): Promise<KartfluencerNotification[]> => {
  const q = query(notificationsCol(), orderBy('createdAt', 'desc'))
  const snap = await getDocs(q)
  return snap.docs.map((d) => mapNotification(d.id, d.data() as UpdateData<DocumentData>))
}

/**
 * Request withdrawal — public portal version (no auth).
 */
export const requestWithdrawalPublic = async (
  influencerId: string,
  amount: number,
  upiId: string,
  upiName: string,
): Promise<KartfluencerWithdrawal> => {
  if (amount <= 0) throw new Error('Withdrawal amount must be positive.')
  if (!upiId.trim()) throw new Error('UPI ID is required.')

  const walletSnap = await getDoc(walletDoc(influencerId))
  const balance = walletSnap.exists() ? Number(walletSnap.data().balance ?? 0) : 0
  if (amount > balance) throw new Error(`Insufficient balance. Available: ₹${balance}`)

  const infSnap = await getDoc(influencerRef(influencerId))
  if (!infSnap.exists()) throw new Error('Influencer not found.')
  const infData = infSnap.data() as UpdateData<DocumentData>

  const now = nowIso()
  const body = {
    influencerId,
    instagramHandle: String(infData.instagramHandle ?? ''),
    amount,
    upiId: upiId.trim(),
    upiName: upiName.trim(),
    status: 'pending',
    requestedAt: now,
  }

  const created = await addDoc(withdrawalsCol(), body)
  return mapWithdrawal(created.id, body as UpdateData<DocumentData>)
}

/**
 * Create a new kartfluencer from the public portal (self-registration).
 * Skips pipeline auth — sets createdBy/updatedBy to "self-registration".
 */
export const createKartfluencerPublic = async (
  payload: CreateKartfluencerPayload,
): Promise<KartfluencerRecord> => {
  const handle = payload.instagramHandle.trim().replace(/^@?/, '@')
  if (!handle || handle === '@') throw new Error('Instagram handle is required.')
  if (!payload.phoneNumber.trim()) throw new Error('Phone number is required.')

  // Check for duplicate handle
  const dupQ = query(influencersCol(), where('instagramHandle', '==', handle))
  const dupSnap = await getDocs(dupQ)
  if (!dupSnap.empty) throw new Error(`Influencer ${handle} already exists.`)

  const tier = payload.tier ?? getTierFromRange(payload.followersRange)
  const now = nowIso()
  const qrCode = `KARTFLUENCER:${Date.now()}:${handle}`

  const body: Record<string, unknown> = stripUndefined({
    instagramHandle: handle,
    phoneCountryCode: payload.phoneCountryCode ?? '+91',
    phoneNumber: payload.phoneNumber.trim(),
    branchId: payload.branchId,
    branchName: payload.branchName,
    visitDate: payload.visitDate,
    followersRange: payload.followersRange,
    followerCount: payload.followerCount,
    tier,
    status: 'detailed',
    walletBalance: 0,
    totalEarned: 0,
    totalWithdrawn: 0,
    qrCode,
    instagramVerified: payload.instagramVerified ?? false,
    instagramUserId: payload.instagramUserId,
    profilePictureUrl: payload.profilePictureUrl,
    createdAt: now,
    updatedAt: now,
    createdBy: 'self-registration',
    updatedBy: 'self-registration',
  })

  const created = await addDoc(influencersCol(), body)

  // Initialize wallet
  await setDoc(walletDoc(created.id), {
    balance: 0,
    totalEarned: 0,
    totalWithdrawn: 0,
    lastUpdatedAt: now,
  })

  return mapRecord(created.id, { ...body, qrCode })
}
