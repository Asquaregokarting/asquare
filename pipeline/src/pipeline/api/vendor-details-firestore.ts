import {
  collection,
  doc,
  getDoc,
  getDocs,
  orderBy,
  query,
  setDoc,
  updateDoc,
} from 'firebase/firestore'
import { initializeFirestore } from '../lib/firebase'
import { ensureFirebaseAuthForStorage } from '../lib/firebase-auth'
import { getFirestoreSessionUser, isPrivilegedRole } from './firestore-session'
import { nowIso } from './firestore-utils'
import { resolveLocation } from '../../lib/locations'
import { VendorDetailsPayload, VendorDetailsRecord } from './types'

const VENDOR_DETAILS_COLLECTION = 'vendorDetails'
const MOBILE_PATTERN = /^(?:\+91)?[6-9]\d{9}$/
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/
const IFSC_PATTERN = /^[A-Z]{4}0[A-Z0-9]{6}$/
const BANK_ACCOUNT_PATTERN = /^\d{9,18}$/

const toRequiredString = (value: unknown, fieldLabel: string): string => {
  const text = String(value ?? '').trim()
  if (!text) {
    throw new Error(`${fieldLabel} is required.`)
  }
  return text
}

const toNumberField = (
  value: unknown,
  fieldLabel: string,
  options?: { min?: number; max?: number },
): number => {
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) {
    throw new Error(`${fieldLabel} must be a valid number.`)
  }
  if (options?.min !== undefined && parsed < options.min) {
    throw new Error(`${fieldLabel} must be at least ${options.min}.`)
  }
  if (options?.max !== undefined && parsed > options.max) {
    throw new Error(`${fieldLabel} must be at most ${options.max}.`)
  }
  return parsed
}

const normalizeMobile = (value: unknown): string => {
  const raw = toRequiredString(value, 'Mobile Number')
  const digits = raw.replace(/\D+/g, '')
  const normalized = digits.length === 12 && digits.startsWith('91') ? digits.slice(2) : digits
  if (!MOBILE_PATTERN.test(normalized)) {
    throw new Error('Mobile Number must be a valid 10-digit Indian mobile number.')
  }
  return normalized
}

const normalizeEmail = (value: unknown): string => {
  const email = toRequiredString(value, 'Email').toLowerCase()
  if (!EMAIL_PATTERN.test(email)) {
    throw new Error('Email must be a valid email address.')
  }
  return email
}

const normalizeIfsc = (value: unknown): string => {
  const ifsc = toRequiredString(value, 'IFSC Code').toUpperCase()
  if (!IFSC_PATTERN.test(ifsc)) {
    throw new Error('IFSC Code format is invalid.')
  }
  return ifsc
}

const normalizeBankAccount = (value: unknown): string => {
  const account = toRequiredString(value, 'Bank Account Number').replace(/\s+/g, '')
  if (!BANK_ACCOUNT_PATTERN.test(account)) {
    throw new Error('Bank Account Number must contain 9 to 18 digits.')
  }
  return account
}

const normalizePayload = (payload: VendorDetailsPayload): VendorDetailsPayload => ({
  particular: toRequiredString(payload.particular, 'Particular'),
  vendorName: toRequiredString(payload.vendorName, 'Name of the Vendor'),
  mobileNumber: normalizeMobile(payload.mobileNumber),
  email: normalizeEmail(payload.email),
  preferredActivity: toRequiredString(payload.preferredActivity, 'Preferred Activity'),
  priceInclusiveGst: toNumberField(payload.priceInclusiveGst, 'Price Inclusive GST', { min: 0 }),
  revenueShare: toNumberField(payload.revenueShare, 'Revenue Share', { min: 0, max: 100 }),
  address: toRequiredString(payload.address, 'Address'),
  bankAccountNumber: normalizeBankAccount(payload.bankAccountNumber),
  bankName: toRequiredString(payload.bankName, 'Bank Name'),
  ifscCode: normalizeIfsc(payload.ifscCode),
  branch: toRequiredString(payload.branch, 'Branch'),
})

const mapVendorRecord = (
  userId: string,
  data: Record<string, unknown> | undefined,
): VendorDetailsRecord => {
  if (!data) {
    throw new Error('Vendor details not found.')
  }

  return {
    userId,
    userName: toRequiredString(data.userName, 'User Name'),
    userEmail: normalizeEmail(data.userEmail),
    particular: toRequiredString(data.particular, 'Particular'),
    vendorName: toRequiredString(data.vendorName, 'Name of the Vendor'),
    mobileNumber: normalizeMobile(data.mobileNumber),
    email: normalizeEmail(data.email),
    preferredActivity: toRequiredString(data.preferredActivity, 'Preferred Activity'),
    priceInclusiveGst: toNumberField(data.priceInclusiveGst, 'Price Inclusive GST', { min: 0 }),
    revenueShare: toNumberField(data.revenueShare, 'Revenue Share', { min: 0, max: 100 }),
    address: toRequiredString(data.address, 'Address'),
    bankAccountNumber: normalizeBankAccount(data.bankAccountNumber),
    bankName: toRequiredString(data.bankName, 'Bank Name'),
    ifscCode: normalizeIfsc(data.ifscCode),
    branch: toRequiredString(data.branch, 'Branch'),
    branchId: data.branchId ? String(data.branchId) : undefined,
    vendorType: data.vendorType === 'SubLease' ? 'SubLease' : 'ThirdParty',
    gstNumber: data.gstNumber ? String(data.gstNumber) : undefined,
    submittedAt: toRequiredString(data.submittedAt, 'Submitted At'),
    updatedAt: toRequiredString(data.updatedAt, 'Updated At'),
    status: 'Submitted',
  }
}

const getVendorDoc = (userId: string) => {
  const firestore = initializeFirestore()
  if (!firestore) {
    return null
  }
  return doc(firestore, VENDOR_DETAILS_COLLECTION, userId)
}

export const isFirestoreVendorDetailsActive = (): boolean => Boolean(getVendorDoc('__probe__'))

export const getFirestoreMyVendorDetails = async (token: string): Promise<VendorDetailsRecord> => {
  const sessionUser = await getFirestoreSessionUser(token)
  const vendorRef = getVendorDoc(sessionUser.id)
  if (!vendorRef) {
    throw new Error('Vendor details store is not configured.')
  }

  const snapshot = await getDoc(vendorRef)
  if (!snapshot.exists()) {
    throw new Error('Vendor details not submitted yet.')
  }

  return mapVendorRecord(sessionUser.id, snapshot.data() as Record<string, unknown> | undefined)
}

export const getFirestoreVendorDetailsByUserId = async (
  token: string,
  userId: string,
): Promise<VendorDetailsRecord> => {
  const targetUserId = userId.trim()
  if (!targetUserId) {
    throw new Error('User id is required.')
  }

  const sessionUser = await getFirestoreSessionUser(token)
  if (sessionUser.id !== targetUserId && !isPrivilegedRole(sessionUser.role)) {
    throw new Error('You are not allowed to access this vendor profile.')
  }

  const vendorRef = getVendorDoc(targetUserId)
  if (!vendorRef) {
    throw new Error('Vendor details store is not configured.')
  }

  const snapshot = await getDoc(vendorRef)
  if (!snapshot.exists()) {
    throw new Error('Vendor details not found.')
  }

  return mapVendorRecord(targetUserId, snapshot.data() as Record<string, unknown> | undefined)
}

export const submitFirestoreVendorDetails = async (
  token: string,
  payload: VendorDetailsPayload,
): Promise<VendorDetailsRecord> => {
  const sessionUser = await getFirestoreSessionUser(token)
  if (sessionUser.role !== 'ThirdParty') {
    throw new Error('Only Third Party users can submit vendor details.')
  }

  const vendorRef = getVendorDoc(sessionUser.id)
  if (!vendorRef) {
    throw new Error('Vendor details store is not configured.')
  }

  const existing = await getDoc(vendorRef)
  if (existing.exists()) {
    throw new Error('Vendor details already submitted. Contact Owner/Admin to request updates.')
  }

  const normalized = normalizePayload(payload)
  // Resolve the freeform `branch` (e.g. "Vizag", "Visakhapatnam Branch") to
  // the canonical `branchId` so AccountingModule and other branch-scoped
  // reads work without an admin follow-up. resolveLocation accepts slug,
  // branchId, display name, or short name — all case-insensitive.
  const resolvedBranchId = resolveLocation(normalized.branch)?.branchId
  const timestamp = nowIso()
  const record: VendorDetailsRecord = {
    userId: sessionUser.id,
    userName: sessionUser.name,
    userEmail: normalizeEmail(sessionUser.email),
    ...normalized,
    branchId: resolvedBranchId,
    submittedAt: timestamp,
    updatedAt: timestamp,
    status: 'Submitted',
  }

  await ensureFirebaseAuthForStorage()
  await setDoc(vendorRef, record)
  return record
}

export const listFirestoreVendorDetails = async (token: string): Promise<VendorDetailsRecord[]> => {
  const sessionUser = await getFirestoreSessionUser(token)
  if (!isPrivilegedRole(sessionUser.role)) {
    throw new Error('Only Owner/Admin can view vendor forms.')
  }

  const firestore = initializeFirestore()
  if (!firestore) {
    throw new Error('Vendor details store is not configured.')
  }

  const snapshot = await getDocs(
    query(collection(firestore, VENDOR_DETAILS_COLLECTION), orderBy('submittedAt', 'desc')),
  )
  return snapshot.docs.map((entry) =>
    mapVendorRecord(entry.id, entry.data() as Record<string, unknown>),
  )
}

export const updateFirestoreVendorDetails = async (
  token: string,
  userId: string,
  updates: Partial<VendorDetailsPayload>,
): Promise<VendorDetailsRecord> => {
  const sessionUser = await getFirestoreSessionUser(token)
  if (!isPrivilegedRole(sessionUser.role)) {
    throw new Error('Only Owner/Admin can edit vendor details.')
  }

  const vendorRef = getVendorDoc(userId)
  if (!vendorRef) throw new Error('Vendor details store is not configured.')

  const existing = await getDoc(vendorRef)
  if (!existing.exists()) throw new Error('Vendor details not found.')

  // Validate only the fields being updated
  const patch: { [key: string]: string | number | boolean | undefined } = { updatedAt: nowIso() }
  if (updates.vendorName !== undefined)
    patch.vendorName = toRequiredString(updates.vendorName, 'Vendor Name')
  if (updates.mobileNumber !== undefined) patch.mobileNumber = normalizeMobile(updates.mobileNumber)
  if (updates.email !== undefined) patch.email = normalizeEmail(updates.email)
  if (updates.particular !== undefined)
    patch.particular = toRequiredString(updates.particular, 'Particular')
  if (updates.preferredActivity !== undefined)
    patch.preferredActivity = toRequiredString(updates.preferredActivity, 'Preferred Activity')
  if (updates.priceInclusiveGst !== undefined)
    patch.priceInclusiveGst = toNumberField(updates.priceInclusiveGst, 'Price Inclusive GST', {
      min: 0,
    })
  if (updates.revenueShare !== undefined)
    patch.revenueShare = toNumberField(updates.revenueShare, 'Revenue Share', { min: 0, max: 100 })
  if (updates.address !== undefined) patch.address = toRequiredString(updates.address, 'Address')
  if (updates.bankAccountNumber !== undefined)
    patch.bankAccountNumber = normalizeBankAccount(updates.bankAccountNumber)
  if (updates.bankName !== undefined)
    patch.bankName = toRequiredString(updates.bankName, 'Bank Name')
  if (updates.ifscCode !== undefined) patch.ifscCode = normalizeIfsc(updates.ifscCode)
  if (updates.branch !== undefined) {
    patch.branch = toRequiredString(updates.branch, 'Branch')
    // When the freeform branch changes, re-derive branchId so the two
    // fields can never disagree. An explicit `updates.branchId` below
    // overrides this (admin override path).
    const resolved = resolveLocation(patch.branch as string)?.branchId
    if (resolved) patch.branchId = resolved
  }
  if (updates.branchId !== undefined) patch.branchId = updates.branchId || undefined
  if (updates.vendorType !== undefined) patch.vendorType = updates.vendorType
  if (updates.gstNumber !== undefined) patch.gstNumber = updates.gstNumber.trim().toUpperCase()

  await ensureFirebaseAuthForStorage()
  await updateDoc(vendorRef, patch)

  const updated = await getDoc(vendorRef)
  return mapVendorRecord(userId, updated.data() as Record<string, unknown>)
}
