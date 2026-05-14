import {
  ApiError,
  buildMockTokenForUser,
  parseMockTokenUserId,
  syncMockUserForSession,
  updateMockUserPassword,
} from './client'
import { LoginResponse } from './types'
import { logger } from '../../lib/logger'
import {
  FirestoreUserAuthRecord,
  getFirestoreUserAuthById,
  getFirestoreUserAuthByIdentifier,
  isFirestoreUsersActive,
  markFirestoreUserLogin,
  setFirestoreUserPassword,
} from './users-firestore'

const asLoginUser = (record: FirestoreUserAuthRecord): LoginResponse['user'] => {
  return {
    id: record.user.id,
    name: record.user.name,
    email: record.user.email,
    phone: record.user.phone,
    role: record.user.role,
    workspaceIds: record.user.workspaceIds ?? [],
    allowedLocations: record.user.allowedLocations ?? [],
    maxDiscountPercent: record.user.maxDiscountPercent,
    mustChangePassword: Boolean(record.mustChangePassword),
    notificationSettings: record.user.notificationSettings,
  }
}

const ensureFirestoreAuthEnabled = (): void => {
  if (!isFirestoreUsersActive()) {
    throw new ApiError('Firestore users is not configured.', 500)
  }
}

export const loginWithFirestoreAuth = async (
  identifier: string,
  password: string,
): Promise<LoginResponse> => {
  ensureFirestoreAuthEnabled()

  const normalizedIdentifier = identifier.trim()
  const submittedPassword = String(password ?? '')
  const authRecord = await getFirestoreUserAuthByIdentifier(normalizedIdentifier)

  if (!authRecord) {
    throw new ApiError('Invalid email/mobile or password.', 401)
  }
  if (!authRecord.user.isActive) {
    throw new ApiError(
      'Your account is pending approval. Please wait for Owner approval before logging in.',
      403,
    )
  }
  if (authRecord.password !== submittedPassword) {
    throw new ApiError('Invalid email/mobile or password.', 401)
  }

  // Last-login stamp drives the "inactive user" sweep + locked-period audits.
  // Silent failure here makes those telemetry-driven flows lie. Log so the
  // gap is visible even though login itself still proceeds.
  await markFirestoreUserLogin(authRecord.user.id).catch((err) =>
    logger.warn('auth.mark_login_failed', { userId: authRecord.user.id, err }),
  )

  const loginUser = asLoginUser(authRecord)
  syncMockUserForSession(loginUser, {
    phone: authRecord.user.phone,
    password: authRecord.password,
    isActive: authRecord.user.isActive,
  })

  return {
    token: buildMockTokenForUser(loginUser.id),
    user: loginUser,
  }
}

export const logoutFirestoreAuth = async (): Promise<{ message: string }> => {
  ensureFirestoreAuthEnabled()
  return { message: 'Logged out.' }
}

export const resetFirestoreAuthPassword = async (
  token: string,
  oldPassword: string,
  newPassword: string,
): Promise<{ message: string }> => {
  ensureFirestoreAuthEnabled()

  const userId = parseMockTokenUserId(token)
  if (!userId) {
    throw new ApiError('Unauthorized', 401)
  }

  const authRecord = await getFirestoreUserAuthById(userId)
  if (!authRecord || !authRecord.user.isActive) {
    throw new ApiError('Unauthorized', 401)
  }

  const currentPassword = String(oldPassword ?? '')
  const nextPassword = String(newPassword ?? '')
  if (authRecord.password !== currentPassword) {
    throw new ApiError('Old password is incorrect.', 400)
  }
  if (!nextPassword.trim()) {
    throw new ApiError('New password is required.', 400)
  }

  await setFirestoreUserPassword(userId, nextPassword, false)
  updateMockUserPassword(userId, nextPassword, false)

  return { message: 'Password reset successful.' }
}
