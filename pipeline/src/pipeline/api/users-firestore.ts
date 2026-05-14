import type { UpdateData, DocumentData } from 'firebase/firestore'
import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  limit,
  query,
  setDoc,
  updateDoc,
  where,
} from 'firebase/firestore'
import { ensureAnonymousAuth, initializeFirestore } from '../lib/firebase'
import { createTtlCache } from './cache'
import { nowIso, toOptionalString } from './firestore-utils'
import { NotificationSound, Role, UserNotificationSettings, UserRecord } from './types'

const USERS_COLLECTION = 'users'
const USE_FIRESTORE_USERS = import.meta.env.VITE_USE_FIRESTORE_USERS !== 'false'
const VALID_ROLES: Role[] = [
  'Owner',
  'Admin',
  'Telecaller',
  'Cashier',
  'TrackMarshall',
  'Incharge',
  'Editor',
  'Developer',
  'Backend',
  'ThirdParty',
  'HR',
  'Accountant',
]
const VALID_NOTIFICATION_SOUNDS: NotificationSound[] = ['soft', 'chime', 'bell', 'off', 'custom']

const isRole = (value: unknown): value is Role =>
  typeof value === 'string' && VALID_ROLES.includes(value as Role)

const toUserDocIdBase = (value: string): string => {
  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
  return normalized || 'user'
}

const toBoolean = (value: unknown): boolean | undefined => {
  if (typeof value === 'boolean') {
    return value
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value !== 0
  }
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase()
    if (['true', '1', 'yes', 'active', 'enabled'].includes(normalized)) {
      return true
    }
    if (['false', '0', 'no', 'inactive', 'disabled'].includes(normalized)) {
      return false
    }
  }
  return undefined
}

const readFirstString = (data: Record<string, unknown>, keys: string[]): string | undefined => {
  for (const key of keys) {
    const value = toOptionalString(data[key])
    if (value) {
      return value
    }
  }
  return undefined
}

const readFirstBoolean = (data: Record<string, unknown>, keys: string[]): boolean | undefined => {
  for (const key of keys) {
    const value = toBoolean(data[key])
    if (value !== undefined) {
      return value
    }
  }
  return undefined
}

const toStringArray = (value: unknown): string[] => {
  if (!Array.isArray(value)) return []
  return value.map((item) => String(item ?? '').trim()).filter((item) => item.length > 0)
}

const toNotificationSettings = (value: unknown): UserNotificationSettings | undefined => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return undefined
  }
  const record = value as Record<string, unknown>
  const soundRaw = String(record.sound ?? 'soft')
    .trim()
    .toLowerCase() as NotificationSound
  const sound: NotificationSound = VALID_NOTIFICATION_SOUNDS.includes(soundRaw) ? soundRaw : 'soft'
  const settings: UserNotificationSettings = {
    sound,
    browserPushEnabled: Boolean(record.browserPushEnabled),
  }
  const customSoundDataUrl = toOptionalString(record.customSoundDataUrl)
  if (customSoundDataUrl) {
    settings.customSoundDataUrl = customSoundDataUrl
  }
  return settings
}

const toIsoFromUnknown = (value: unknown): string | undefined => {
  if (!value) return undefined
  if (typeof value === 'string') return value
  if (typeof value === 'object' && value !== null && 'toDate' in value) {
    try {
      return (value as { toDate: () => Date }).toDate().toISOString()
    } catch {
      return undefined
    }
  }
  if (value instanceof Date) return value.toISOString()
  return undefined
}

const mapUserRecord = (id: string, data: Record<string, unknown>): UserRecord => {
  const rawRole = readFirstString(data, ['role', 'userRole', 'user_role', 'type']) ?? ''
  return {
    id,
    name:
      readFirstString(data, ['name', 'fullName', 'full_name', 'displayName', 'display_name']) ??
      'User',
    email: readFirstString(data, ['email', 'emailAddress', 'email_address', 'mail']) ?? '',
    username: readFirstString(data, ['username', 'userName', 'user_name', 'loginId', 'login_id']),
    role: isRole(rawRole) ? rawRole : 'Telecaller',
    isActive: readFirstBoolean(data, ['isActive', 'active', 'status']) ?? true,
    phone: readFirstString(data, [
      'phone',
      'phoneNumber',
      'phone_number',
      'mobile',
      'contactNumber',
      'contact_number',
    ]),
    workspaceIds: toStringArray(
      data.workspaceIds ??
        data.workspace_ids ??
        data.assignedWorkspaces ??
        data.assigned_workspaces,
    ),
    allowedLocations: toStringArray(data.allowedLocations ?? data.allowed_locations),
    maxDiscountPercent:
      data.maxDiscountPercent != null ? Number(data.maxDiscountPercent) : undefined,
    createdAt: readFirstString(data, ['createdAt', 'created_at']),
    lastLoginAt: readFirstString(data, ['lastLoginAt', 'last_login_at']),
    notificationSettings: toNotificationSettings(
      data.notificationSettings ?? data.notification_settings,
    ),
    branchId: readFirstString(data, ['branchId', 'branch_id', 'branch', 'location']),
    lastAssignedTicketAt: toIsoFromUnknown(
      data.lastAssignedTicketAt ?? data.last_assigned_ticket_at,
    ),
  }
}

const getUsersCollection = () => {
  if (!USE_FIRESTORE_USERS) {
    return null
  }
  const firestore = initializeFirestore()
  if (!firestore) {
    return null
  }
  return collection(firestore, USERS_COLLECTION)
}

export const isFirestoreUsersActive = (): boolean => Boolean(getUsersCollection())

// Cache the full unfiltered user list for 2 minutes to avoid redundant Firestore reads.
// Filtering by role/status/search is applied in-memory on top of the cached snapshot.
const usersCache = createTtlCache<UserRecord[]>(2 * 60 * 1000)

const fetchAllUsers = async (): Promise<UserRecord[]> => {
  const cached = usersCache.get()
  if (cached) return cached

  await ensureAnonymousAuth()
  const usersCollection = getUsersCollection()
  if (!usersCollection) {
    throw new Error('Firestore users is not configured.')
  }

  // Only fetch documents that have a valid pipeline role to exclude customer users
  // (Firestore "in" queries support up to 30 values, we have 9 roles)
  const snapshot = await getDocs(query(usersCollection, where('role', 'in', VALID_ROLES)))
  const users = snapshot.docs.map((item) =>
    mapUserRecord(item.id, item.data() as Record<string, unknown>),
  )
  usersCache.set(users)
  return users
}

export const invalidateUsersCache = (): void => usersCache.invalidate()

export const listFirestoreUsers = async (queryParams?: {
  role?: UserRecord['role']
  status?: 'Active' | 'Inactive'
  q?: string
  location?: string
}): Promise<UserRecord[]> => {
  const users = await fetchAllUsers()

  const search = queryParams?.q?.trim().toLowerCase() ?? ''
  const filtered = users.filter((user) => {
    if (queryParams?.role && user.role !== queryParams.role) {
      return false
    }
    if (queryParams?.status === 'Active' && !user.isActive) {
      return false
    }
    if (queryParams?.status === 'Inactive' && user.isActive) {
      return false
    }
    if (search) {
      const haystack =
        `${user.name} ${user.username ?? ''} ${user.email} ${user.phone ?? ''}`.toLowerCase()
      if (!haystack.includes(search)) {
        return false
      }
    }
    if (queryParams?.location) {
      const allowed = user.allowedLocations
      // Users with empty/undefined allowedLocations have access to all branches
      if (Array.isArray(allowed) && allowed.length > 0 && !allowed.includes(queryParams.location)) {
        return false
      }
    }
    return true
  })

  return filtered.sort((left, right) => {
    const a = left.createdAt ?? ''
    const b = right.createdAt ?? ''
    return b.localeCompare(a)
  })
}

export const createFirestoreUser = async (
  payload: {
    name: string
    username: string
    email: string
    phone: string
    role: UserRecord['role']
    workspaceIds?: string[]
    allowedLocations?: string[]
    maxDiscountPercent?: number
    temporaryPassword: string
  },
  token?: string,
): Promise<UserRecord> => {
  const usersCollection = getUsersCollection()
  if (!usersCollection) {
    throw new Error('Firestore users is not configured.')
  }

  const email = payload.email.trim().toLowerCase()
  if (!email) {
    throw new Error('Email is required.')
  }
  const username = payload.username.trim()
  if (!username) {
    throw new Error('Username is required.')
  }

  const existingUser = await getFirestoreUserAuthByEmail(email)
  if (existingUser) {
    throw new Error('A user with this email already exists.')
  }
  const existingUsername =
    (await getFirestoreUserAuthByField('username', username)) ??
    (await getFirestoreUserAuthByField('userName', username))
  if (existingUsername) {
    throw new Error('A user with this username already exists.')
  }

  const name = payload.name.trim()
  if (!name) {
    throw new Error('Name is required.')
  }

  const createdAt = nowIso()
  const body = {
    name,
    fullName: name,
    username,
    userName: username,
    email,
    emailAddress: email,
    role: payload.role,
    userRole: payload.role,
    isActive: true,
    status: 'Active',
    phone: payload.phone.trim(),
    workspaceIds: payload.workspaceIds ?? [],
    allowedLocations: payload.allowedLocations ?? [],
    maxDiscountPercent: payload.maxDiscountPercent ?? 0,
    password: payload.temporaryPassword,
    mustChangePassword: true,
    temporaryPasswordSetAt: createdAt,
    createdAt,
    notificationSettings: {
      sound: 'soft',
      browserPushEnabled: false,
    } satisfies UserNotificationSettings,
    createdBy: token ? String(token) : undefined,
  }

  const baseDocId = toUserDocIdBase(username)
  let nextDocId = baseDocId
  let suffix = 2
  // Keep document IDs human-readable and deterministic (name-based) without random IDs.
  while ((await getDoc(doc(usersCollection, nextDocId))).exists()) {
    nextDocId = `${baseDocId}-${suffix}`
    suffix += 1
  }

  await setDoc(doc(usersCollection, nextDocId), body)
  usersCache.invalidate()
  return mapUserRecord(nextDocId, body)
}

export const updateFirestoreUser = async (
  userId: string,
  payload: Partial<UserRecord>,
): Promise<UserRecord> => {
  const usersCollection = getUsersCollection()
  if (!usersCollection) {
    throw new Error('Firestore users is not configured.')
  }

  const userRef = doc(usersCollection, userId)
  const updatePayload: Record<string, unknown> = {
    updatedAt: nowIso(),
  }
  if (payload.name !== undefined) {
    const name = payload.name.trim()
    updatePayload.name = name
    updatePayload.fullName = name
  }
  if (payload.email !== undefined) {
    const email = payload.email.trim().toLowerCase()
    if (!email) {
      throw new Error('Email is required.')
    }
    const existingUser = await getFirestoreUserAuthByEmail(email)
    if (existingUser && existingUser.user.id !== userId) {
      throw new Error('A user with this email already exists.')
    }
    updatePayload.email = email
    updatePayload.emailAddress = email
  }
  if (payload.username !== undefined) {
    const username = payload.username.trim()
    if (!username) {
      throw new Error('Username is required.')
    }
    const existingUsername =
      (await getFirestoreUserAuthByField('username', username)) ??
      (await getFirestoreUserAuthByField('userName', username))
    if (existingUsername && existingUsername.user.id !== userId) {
      throw new Error('A user with this username already exists.')
    }
    updatePayload.username = username
    updatePayload.userName = username
  }
  if (payload.phone !== undefined) updatePayload.phone = payload.phone.trim()
  if (payload.role !== undefined) {
    updatePayload.role = payload.role
    updatePayload.userRole = payload.role
  }
  if (payload.isActive !== undefined) {
    updatePayload.isActive = payload.isActive
    updatePayload.status = payload.isActive ? 'Active' : 'Inactive'
  }
  if (payload.workspaceIds !== undefined) updatePayload.workspaceIds = payload.workspaceIds
  if (payload.allowedLocations !== undefined)
    updatePayload.allowedLocations = payload.allowedLocations
  if (payload.maxDiscountPercent !== undefined)
    updatePayload.maxDiscountPercent = payload.maxDiscountPercent
  if (payload.lastLoginAt !== undefined) updatePayload.lastLoginAt = payload.lastLoginAt
  if (payload.notificationSettings !== undefined) {
    updatePayload.notificationSettings = toNotificationSettings(payload.notificationSettings) ?? {
      sound: 'soft',
      browserPushEnabled: false,
    }
  }

  await updateDoc(userRef, updatePayload as UpdateData<DocumentData>)
  usersCache.invalidate()
  const updatedSnapshot = await getDoc(userRef)
  if (!updatedSnapshot.exists()) {
    throw new Error('User not found.')
  }
  return mapUserRecord(updatedSnapshot.id, updatedSnapshot.data() as Record<string, unknown>)
}

export const deactivateFirestoreUser = async (userId: string): Promise<void> => {
  const usersCollection = getUsersCollection()
  if (!usersCollection) {
    throw new Error('Firestore users is not configured.')
  }

  const userRef = doc(usersCollection, userId)
  await updateDoc(userRef, {
    isActive: false,
    status: 'Inactive',
    updatedAt: nowIso(),
  })
  usersCache.invalidate()
}

export const deleteFirestoreUser = async (userId: string): Promise<void> => {
  const usersCollection = getUsersCollection()
  if (!usersCollection) {
    throw new Error('Firestore users is not configured.')
  }

  const userRef = doc(usersCollection, userId)
  await deleteDoc(userRef)
  usersCache.invalidate()
}

export interface FirestoreUserAuthRecord {
  user: UserRecord
  password: string
  mustChangePassword: boolean
}

const mapFirestoreUserAuthRecord = (
  id: string,
  data: Record<string, unknown>,
): FirestoreUserAuthRecord => {
  const user = mapUserRecord(id, data)
  return {
    user,
    password: toOptionalString(data.password) ?? '',
    mustChangePassword: Boolean(data.mustChangePassword ?? true),
  }
}

const getFirestoreUserAuthByField = async (
  field: string,
  value: string,
): Promise<FirestoreUserAuthRecord | null> => {
  await ensureAnonymousAuth()
  const usersCollection = getUsersCollection()
  if (!usersCollection) {
    throw new Error('Firestore users is not configured.')
  }

  const candidate = value.trim()
  if (!candidate) {
    return null
  }

  // Also filter by role to avoid matching customer users in the shared collection
  const snapshot = await getDocs(
    query(
      usersCollection,
      where(field, '==', candidate),
      where('role', 'in', VALID_ROLES),
      limit(1),
    ),
  )
  if (snapshot.empty) {
    return null
  }

  const first = snapshot.docs[0]
  return mapFirestoreUserAuthRecord(first.id, first.data() as Record<string, unknown>)
}

export const getFirestoreUserAuthByEmail = async (
  email: string,
): Promise<FirestoreUserAuthRecord | null> => {
  const normalizedEmail = email.trim().toLowerCase()
  if (!normalizedEmail) {
    return null
  }

  return getFirestoreUserAuthByField('email', normalizedEmail)
}

export const getFirestoreUserAuthByIdentifier = async (
  identifier: string,
): Promise<FirestoreUserAuthRecord | null> => {
  const trimmed = identifier.trim()
  const normalized = trimmed.toLowerCase()
  if (!trimmed) {
    return null
  }

  const docIdCandidates = trimmed === normalized ? [trimmed] : [trimmed, normalized]
  for (const candidate of docIdCandidates) {
    const byId = await getFirestoreUserAuthById(candidate)
    if (byId) {
      return byId
    }
  }

  const usernameFieldCandidates: Array<[string, string]> = [
    ['username', trimmed],
    ['userName', trimmed],
  ]
  if (normalized !== trimmed) {
    usernameFieldCandidates.push(['username', normalized], ['userName', normalized])
  }

  for (const [field, value] of usernameFieldCandidates) {
    const byUsername = await getFirestoreUserAuthByField(field, value)
    if (byUsername) {
      return byUsername
    }
  }

  const phoneFields = [
    'phone',
    'phoneNumber',
    'phone_number',
    'mobile',
    'contactNumber',
    'contact_number',
  ]
  for (const field of phoneFields) {
    const byPhone = await getFirestoreUserAuthByField(field, trimmed)
    if (byPhone) {
      return byPhone
    }
  }

  return getFirestoreUserAuthByEmail(normalized)
}

export const getFirestoreUserAuthById = async (
  userId: string,
): Promise<FirestoreUserAuthRecord | null> => {
  await ensureAnonymousAuth()
  const usersCollection = getUsersCollection()
  if (!usersCollection) {
    throw new Error('Firestore users is not configured.')
  }

  const snapshot = await getDoc(doc(usersCollection, userId))
  if (!snapshot.exists()) {
    return null
  }
  const data = snapshot.data() as Record<string, unknown>
  // Skip customer users that don't have a valid pipeline role
  const rawRole = toOptionalString(data.role) ?? toOptionalString(data.userRole) ?? ''
  if (!isRole(rawRole)) {
    return null
  }
  return mapFirestoreUserAuthRecord(snapshot.id, data)
}

export const setFirestoreUserPassword = async (
  userId: string,
  password: string,
  mustChangePassword: boolean,
): Promise<void> => {
  const usersCollection = getUsersCollection()
  if (!usersCollection) {
    throw new Error('Firestore users is not configured.')
  }

  const userRef = doc(usersCollection, userId)
  await updateDoc(userRef, {
    password,
    mustChangePassword,
    passwordUpdatedAt: nowIso(),
    updatedAt: nowIso(),
  })
}

export const markFirestoreUserLogin = async (userId: string): Promise<void> => {
  await ensureAnonymousAuth()
  const usersCollection = getUsersCollection()
  if (!usersCollection) {
    throw new Error('Firestore users is not configured.')
  }

  const userRef = doc(usersCollection, userId)
  await updateDoc(userRef, {
    lastLoginAt: nowIso(),
    updatedAt: nowIso(),
  })
}
