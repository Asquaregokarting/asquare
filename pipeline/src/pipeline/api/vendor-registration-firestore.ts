import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  limit,
  onSnapshot,
  orderBy,
  query,
  setDoc,
  updateDoc,
  where,
} from 'firebase/firestore'
import { ensureAnonymousAuth, initializeFirestore } from '../lib/firebase'
import { getFirestoreSessionUser, isPrivilegedRole } from './firestore-session'
import { nowIso } from './firestore-utils'
import {
  VendorRegistrationPayload,
  VendorRegistrationRecord,
  VendorRegistrationStatus,
  VendorType,
} from './types'
import { createFirestoreUser, setFirestoreUserPassword } from './users-firestore'
import { getAllLocations } from '../../lib/locations'

const VENDOR_REGISTRATIONS_COLLECTION = 'vendorRegistrations'

const MOBILE_PATTERN = /^[6-9]\d{9}$/
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/
const IFSC_PATTERN = /^[A-Z]{4}0[A-Z0-9]{6}$/
const BANK_ACCOUNT_PATTERN = /^\d{9,18}$/

const normalizeMobile = (value: string): string => {
  const digits = value.replace(/\D+/g, '')
  return digits.length === 12 && digits.startsWith('91') ? digits.slice(2) : digits
}

const getRegistrationsCollection = () => {
  const firestore = initializeFirestore()
  if (!firestore) return null
  return collection(firestore, VENDOR_REGISTRATIONS_COLLECTION)
}

export const isFirestoreVendorRegistrationActive = (): boolean =>
  Boolean(getRegistrationsCollection())

/**
 * Checks if a mobile number is already used by an existing registration or user.
 * Returns true if the number is already taken.
 */
export const isMobileAlreadyRegistered = async (mobileNumber: string): Promise<boolean> => {
  await ensureAnonymousAuth()
  const firestore = initializeFirestore()
  if (!firestore) return false

  const mobile = normalizeMobile(mobileNumber)
  if (!MOBILE_PATTERN.test(mobile)) return false

  // Check vendorRegistrations (pending or approved)
  const regCol = collection(firestore, VENDOR_REGISTRATIONS_COLLECTION)
  const regSnap = await getDocs(query(regCol, where('mobileNumber', '==', mobile), limit(1)))
  if (!regSnap.empty) return true

  // Check users collection (already created accounts)
  const usersCol = collection(firestore, 'users')
  const userSnap = await getDocs(query(usersCol, where('phone', '==', mobile), limit(1)))
  if (!userSnap.empty) return true

  return false
}

/**
 * Checks if an email is already used by an existing registration or user.
 * Returns true if the email is already taken.
 */
export const isEmailAlreadyRegistered = async (emailAddress: string): Promise<boolean> => {
  await ensureAnonymousAuth()
  const firestore = initializeFirestore()
  if (!firestore) return false

  const email = emailAddress.trim().toLowerCase()
  if (!EMAIL_PATTERN.test(email)) return false

  // Check vendorRegistrations (pending or approved)
  const regCol = collection(firestore, VENDOR_REGISTRATIONS_COLLECTION)
  const regSnap = await getDocs(query(regCol, where('email', '==', email), limit(1)))
  if (!regSnap.empty) return true

  // Check users collection (already created accounts)
  const usersCol = collection(firestore, 'users')
  const userSnap = await getDocs(query(usersCol, where('email', '==', email), limit(1)))
  if (!userSnap.empty) return true

  return false
}

const mapRecord = (id: string, data: Record<string, unknown>): VendorRegistrationRecord => ({
  id,
  branchId: String(data.branchId ?? ''),
  vendorName: String(data.vendorName ?? ''),
  companyName: String(data.companyName ?? ''),
  mobileNumber: String(data.mobileNumber ?? ''),
  email: String(data.email ?? ''),
  gstNumber: String(data.gstNumber ?? ''),
  address: String(data.address ?? ''),
  bankAccountNumber: String(data.bankAccountNumber ?? ''),
  bankName: String(data.bankName ?? ''),
  ifscCode: String(data.ifscCode ?? ''),
  bankBranch: String(data.bankBranch ?? ''),
  submittedAt: String(data.submittedAt ?? ''),
  status: (data.status as VendorRegistrationStatus) ?? 'Pending',
  reviewedAt: data.reviewedAt ? String(data.reviewedAt) : undefined,
  reviewedBy: data.reviewedBy ? String(data.reviewedBy) : undefined,
  createdUserId: data.createdUserId ? String(data.createdUserId) : undefined,
  vendorType:
    data.vendorType === 'SubLease'
      ? 'SubLease'
      : data.vendorType === 'ThirdParty'
        ? 'ThirdParty'
        : undefined,
})

const validatePayload = (
  payload: VendorRegistrationPayload,
): { mobile: string; email: string; ifsc: string; account: string } => {
  if (!payload.branchId) throw new Error('Branch selection is required.')
  if (!payload.vendorName.trim()) throw new Error('Vendor Name is required.')
  if (!payload.companyName.trim()) throw new Error('Company Name is required.')

  const mobile = normalizeMobile(payload.mobileNumber)
  if (!MOBILE_PATTERN.test(mobile))
    throw new Error('Mobile Number must be a valid 10-digit Indian mobile number.')

  const email = payload.email.trim().toLowerCase()
  if (!EMAIL_PATTERN.test(email)) throw new Error('Email must be a valid email address.')

  if (!payload.address.trim()) throw new Error('Address is required.')

  const account = payload.bankAccountNumber.replace(/\s+/g, '')
  if (!BANK_ACCOUNT_PATTERN.test(account))
    throw new Error('Bank Account Number must contain 9 to 18 digits.')
  if (!payload.bankName.trim()) throw new Error('Bank Name is required.')

  const ifsc = payload.ifscCode.trim().toUpperCase()
  if (!IFSC_PATTERN.test(ifsc)) throw new Error('IFSC Code format is invalid (e.g. HDFC0001234).')
  if (!payload.bankBranch.trim()) throw new Error('Bank Branch is required.')

  return { mobile, email, ifsc, account }
}

export const submitFirestoreVendorRegistration = async (
  payload: VendorRegistrationPayload,
  password: string,
): Promise<VendorRegistrationRecord> => {
  await ensureAnonymousAuth()
  const col = getRegistrationsCollection()
  if (!col) throw new Error('Vendor registrations store is not configured.')

  const { mobile, email, ifsc, account } = validatePayload(payload)
  if (!password || password.length < 8) throw new Error('Password must be at least 8 characters.')

  // Duplicate guard: check mobile and email uniqueness before inserting
  const [mobileTaken, emailTaken] = await Promise.all([
    isMobileAlreadyRegistered(mobile),
    isEmailAlreadyRegistered(email),
  ])
  if (mobileTaken)
    throw new Error('Mobile number already registered. Please use a different number or sign in.')
  if (emailTaken)
    throw new Error('Email already registered. Please use a different email or sign in.')

  const timestamp = nowIso()
  const docRef = await addDoc(col, {
    branchId: payload.branchId,
    vendorName: payload.vendorName.trim(),
    companyName: payload.companyName.trim(),
    mobileNumber: mobile,
    email,
    gstNumber: payload.gstNumber?.trim().toUpperCase() || '',
    address: payload.address.trim(),
    bankAccountNumber: account,
    bankName: payload.bankName.trim(),
    ifscCode: ifsc,
    bankBranch: payload.bankBranch.trim(),
    initialPassword: password,
    submittedAt: timestamp,
    status: 'Pending',
  })

  return mapRecord(docRef.id, {
    branchId: payload.branchId,
    vendorName: payload.vendorName.trim(),
    companyName: payload.companyName.trim(),
    mobileNumber: mobile,
    email,
    gstNumber: payload.gstNumber?.trim().toUpperCase() || '',
    address: payload.address.trim(),
    bankAccountNumber: account,
    bankName: payload.bankName.trim(),
    ifscCode: ifsc,
    bankBranch: payload.bankBranch.trim(),
    submittedAt: timestamp,
    status: 'Pending',
  })
}

export const getMyFirestoreRegistration = async (
  token: string,
): Promise<VendorRegistrationRecord | null> => {
  const sessionUser = await getFirestoreSessionUser(token)
  const col = getRegistrationsCollection()
  if (!col) return null

  const snapshot = await getDocs(
    query(col, where('email', '==', sessionUser.email.toLowerCase()), limit(1)),
  )
  if (snapshot.empty) return null
  const entry = snapshot.docs[0]
  const record = mapRecord(entry.id, entry.data() as Record<string, unknown>)
  return record.status === 'Approved' ? record : null
}

export const listApprovedFirestoreVendors = async (
  token: string,
): Promise<VendorRegistrationRecord[]> => {
  const sessionUser = await getFirestoreSessionUser(token)
  if (!isPrivilegedRole(sessionUser.role))
    throw new Error('Only Owner/Admin can view approved vendors.')

  const col = getRegistrationsCollection()
  if (!col) return []

  const snapshot = await getDocs(query(col, where('status', '==', 'Approved')))
  return snapshot.docs
    .map((entry) => mapRecord(entry.id, entry.data() as Record<string, unknown>))
    .sort((a, b) => a.vendorName.localeCompare(b.vendorName))
}

export const listFirestoreVendorRegistrations = async (
  token: string,
): Promise<VendorRegistrationRecord[]> => {
  const sessionUser = await getFirestoreSessionUser(token)
  if (!isPrivilegedRole(sessionUser.role))
    throw new Error('Only Owner/Admin can view vendor registrations.')

  const col = getRegistrationsCollection()
  if (!col) throw new Error('Vendor registrations store is not configured.')

  const snapshot = await getDocs(query(col, orderBy('submittedAt', 'desc')))
  return snapshot.docs.map((entry) => mapRecord(entry.id, entry.data() as Record<string, unknown>))
}

export const approveFirestoreVendorRegistration = async (
  token: string,
  registrationId: string,
  revenueShare: number = 0,
  vendorType: VendorType = 'ThirdParty',
): Promise<void> => {
  const sessionUser = await getFirestoreSessionUser(token)
  if (!isPrivilegedRole(sessionUser.role))
    throw new Error('Only Owner/Admin can approve vendor registrations.')

  const firestore = initializeFirestore()
  if (!firestore) throw new Error('Vendor registrations store is not configured.')

  const regRef = doc(firestore, VENDOR_REGISTRATIONS_COLLECTION, registrationId)
  const snapshot = await getDoc(regRef)
  if (!snapshot.exists()) throw new Error('Registration not found.')

  const data = snapshot.data() as Record<string, unknown>
  if (data.status !== 'Pending') throw new Error('Only pending registrations can be approved.')

  const initialPassword = String(data.initialPassword ?? '')
  if (!initialPassword) throw new Error('Registration is missing password data.')

  const mobile = String(data.mobileNumber ?? '')
  const createdUser = await createFirestoreUser(
    {
      name: String(data.vendorName ?? 'Vendor'),
      username: mobile,
      email: String(data.email ?? ''),
      phone: mobile,
      role: 'ThirdParty',
      temporaryPassword: initialPassword,
    },
    token,
  )

  await setFirestoreUserPassword(createdUser.id, initialPassword, false)

  // Write a vendorDetails stub so VendorRegistrationGate passes for this user
  const vendorDetailsRef = doc(firestore, 'vendorDetails', createdUser.id)
  const existingVD = await getDoc(vendorDetailsRef)
  if (!existingVD.exists()) {
    const ts = nowIso()
    await setDoc(vendorDetailsRef, {
      userId: createdUser.id,
      userName: String(data.vendorName ?? ''),
      userEmail: String(data.email ?? ''),
      particular: String(data.companyName ?? ''),
      vendorName: String(data.vendorName ?? ''),
      mobileNumber: String(data.mobileNumber ?? ''),
      email: String(data.email ?? ''),
      preferredActivity: 'Third Party Partner',
      priceInclusiveGst: 0,
      revenueShare: Math.max(0, Math.min(100, revenueShare)),
      vendorType,
      address: String(data.address ?? ''),
      gstNumber: String(data.gstNumber ?? ''),
      bankAccountNumber: String(data.bankAccountNumber ?? ''),
      bankName: String(data.bankName ?? ''),
      ifscCode: String(data.ifscCode ?? ''),
      branch: String(data.bankBranch ?? ''),
      branchId: String(data.branchId ?? ''),
      submittedAt: ts,
      updatedAt: ts,
      status: 'Submitted',
    })
  }

  await updateDoc(regRef, {
    status: 'Approved',
    reviewedAt: nowIso(),
    reviewedBy: sessionUser.name,
    createdUserId: createdUser.id,
    revenueShare: Math.max(0, Math.min(100, revenueShare)),
    vendorType,
  })
}

export const rejectFirestoreVendorRegistration = async (
  token: string,
  registrationId: string,
): Promise<void> => {
  const sessionUser = await getFirestoreSessionUser(token)
  if (!isPrivilegedRole(sessionUser.role))
    throw new Error('Only Owner/Admin can reject vendor registrations.')

  const firestore = initializeFirestore()
  if (!firestore) throw new Error('Vendor registrations store is not configured.')

  const regRef = doc(firestore, VENDOR_REGISTRATIONS_COLLECTION, registrationId)
  const snapshot = await getDoc(regRef)
  if (!snapshot.exists()) throw new Error('Registration not found.')

  const data = snapshot.data() as Record<string, unknown>
  if (data.status !== 'Pending') throw new Error('Only pending registrations can be rejected.')

  await updateDoc(regRef, {
    status: 'Rejected',
    reviewedAt: nowIso(),
    reviewedBy: sessionUser.name,
  })
}

// ─── Vendor locations (all branch IDs) ───────────────────────────────────────
const VENDOR_LOCATION_IDS = getAllLocations().map((l) => l.branchId)

export interface VendorDeletionSummary {
  deletedLedgerEntries: number
  deletedVendorInvoices: number
  deletedBillingTransactions: number
  deletedGames: number
}

/**
 * Permanently deletes a vendor and all associated data in a cascading manner.
 *
 * Deleted collections (in order):
 *   1. vendorLedger        - all entries where vendorId === vendorUserId
 *   2. vendorInvoices      - all invoices where vendorId === vendorUserId
 *   3. billingTransactions - all transactions where vendorId === vendorUserId
 *   4. locations/x/games   - all game trees where metadata.vendorId === vendorUserId
 *   5. vendorDetails       - the vendor profile document
 *   6. vendorRegistrations - the original registration record
 *   7. users               - the ThirdParty user account
 *
 * Note: companyInvoices are kept intact as they aggregate company-wide revenue.
 * Only Owner/Admin may call this function.
 */
export const deleteFirestoreVendor = async (
  token: string,
  vendorUserId: string,
): Promise<VendorDeletionSummary> => {
  const sessionUser = await getFirestoreSessionUser(token)
  if (!isPrivilegedRole(sessionUser.role)) throw new Error('Only Owner/Admin can delete vendors.')

  const firestore = initializeFirestore()
  if (!firestore) throw new Error('Firestore is not configured.')

  let deletedLedgerEntries = 0
  let deletedVendorInvoices = 0
  let deletedBillingTransactions = 0
  let deletedGames = 0

  // 1. Delete vendorLedger entries
  const ledgerSnap = await getDocs(
    query(collection(firestore, 'vendorLedger'), where('vendorId', '==', vendorUserId)),
  )
  await Promise.all(ledgerSnap.docs.map((d) => deleteDoc(d.ref)))
  deletedLedgerEntries = ledgerSnap.size

  // 2. Delete vendorInvoices
  const invoicesSnap = await getDocs(
    query(collection(firestore, 'vendorInvoices'), where('vendorId', '==', vendorUserId)),
  )
  await Promise.all(invoicesSnap.docs.map((d) => deleteDoc(d.ref)))
  deletedVendorInvoices = invoicesSnap.size

  // 3. Delete POS transactions where this vendor is the primary vendor
  const txnSnap = await getDocs(
    query(
      collection(firestore, 'bookings'),
      where('vendorId', '==', vendorUserId),
      where('source', '==', 'POS'),
    ),
  )
  await Promise.all(txnSnap.docs.map((d) => deleteDoc(d.ref)))
  deletedBillingTransactions = txnSnap.size

  // 4. Delete vendor-owned games (and their full subgame/variant subtrees)
  for (const locationId of VENDOR_LOCATION_IDS) {
    const gamesCol = collection(firestore, 'locations', locationId, 'games')
    const gamesSnap = await getDocs(query(gamesCol, where('metadata.vendorId', '==', vendorUserId)))

    for (const gameDoc of gamesSnap.docs) {
      const subgamesCol = collection(
        firestore,
        'locations',
        locationId,
        'games',
        gameDoc.id,
        'subgames',
      )
      const subgamesSnap = await getDocs(subgamesCol)

      for (const subgameDoc of subgamesSnap.docs) {
        const variantsCol = collection(
          firestore,
          'locations',
          locationId,
          'games',
          gameDoc.id,
          'subgames',
          subgameDoc.id,
          'variants',
        )
        const variantsSnap = await getDocs(variantsCol)
        await Promise.all(variantsSnap.docs.map((d) => deleteDoc(d.ref)))
        await deleteDoc(subgameDoc.ref)
      }

      await deleteDoc(gameDoc.ref)
      deletedGames++
    }
  }

  // 5. Delete vendorDetails profile
  await deleteDoc(doc(firestore, 'vendorDetails', vendorUserId)).catch(() => undefined)

  // 6. Delete vendorRegistrations record(s) for this user
  const regSnap = await getDocs(
    query(
      collection(firestore, VENDOR_REGISTRATIONS_COLLECTION),
      where('createdUserId', '==', vendorUserId),
    ),
  )
  await Promise.all(regSnap.docs.map((d) => deleteDoc(d.ref)))

  // 7. Delete the ThirdParty user account
  await deleteDoc(doc(firestore, 'users', vendorUserId)).catch(() => undefined)

  return { deletedLedgerEntries, deletedVendorInvoices, deletedBillingTransactions, deletedGames }
}

/** Real-time subscription for recent vendor registrations (all statuses). Returns unsubscribe fn. */
export const subscribeRecentVendorRegistrations = (
  onData: (rows: VendorRegistrationRecord[]) => void,
  onError: (err: Error) => void,
): (() => void) => {
  const col = getRegistrationsCollection()
  if (!col) {
    onData([])
    return () => {}
  }
  // IST-aware 4-day cutoff (today + 3 prior days)
  const cutoff = new Date()
  cutoff.setMinutes(cutoff.getMinutes() + 330)
  cutoff.setDate(cutoff.getDate() - 3)
  cutoff.setHours(0, 0, 0, 0)
  cutoff.setMinutes(cutoff.getMinutes() - 330)
  const cutoffISO = cutoff.toISOString()
  return onSnapshot(
    query(col, where('submittedAt', '>=', cutoffISO), orderBy('submittedAt', 'desc'), limit(20)),
    (snapshot) => {
      const rows = snapshot.docs.map((entry) =>
        mapRecord(entry.id, entry.data() as Record<string, unknown>),
      )
      onData(rows)
    },
    onError,
  )
}
