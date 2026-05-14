import { doc, getDoc, setDoc, updateDoc } from 'firebase/firestore'
import { initializeFirestore } from '../lib/firebase'
import { getFirestoreSessionUser } from './firestore-session'
import { nowIso, toOptionalString } from './firestore-utils'
import { HREmployeeProfileExt } from './types'

const HR_PROFILE_COLLECTION = 'hrEmployeeProfiles'

const initialize = () => initializeFirestore()

const mapProfile = (data: Record<string, unknown>): HREmployeeProfileExt => ({
  designation: toOptionalString(data.designation),
  dateOfJoining: toOptionalString(data.dateOfJoining),
  reportingManagerId: toOptionalString(data.reportingManagerId),
  reportingManagerName: toOptionalString(data.reportingManagerName),
  emergencyContactName: toOptionalString(data.emergencyContactName),
  emergencyContactPhone: toOptionalString(data.emergencyContactPhone),
  emergencyContactRelation: toOptionalString(data.emergencyContactRelation),
  bankAccountNumber: toOptionalString(data.bankAccountNumber),
  bankIfsc: toOptionalString(data.bankIfsc),
  bankName: toOptionalString(data.bankName),
  panNumber: toOptionalString(data.panNumber),
  aadhaarLast4: toOptionalString(data.aadhaarLast4),
  address: toOptionalString(data.address),
  bloodGroup: toOptionalString(data.bloodGroup),
  baseSalary:
    typeof data.baseSalary === 'number' && Number.isFinite(data.baseSalary)
      ? data.baseSalary
      : undefined,
})

export const getHREmployeeProfile = async (
  employeeId: string,
): Promise<HREmployeeProfileExt | null> => {
  const firestore = initialize()
  if (!firestore) return null
  const snapshot = await getDoc(doc(firestore, HR_PROFILE_COLLECTION, employeeId))
  if (!snapshot.exists()) return null
  return mapProfile(snapshot.data() as Record<string, unknown>)
}

export const upsertHREmployeeProfile = async (
  token: string,
  employeeId: string,
  payload: HREmployeeProfileExt,
): Promise<HREmployeeProfileExt> => {
  const firestore = initialize()
  if (!firestore) throw new Error('Firestore HR employee profile is not configured.')
  const sessionUser = await getFirestoreSessionUser(token)
  const ref = doc(firestore, HR_PROFILE_COLLECTION, employeeId)
  const cleaned: Record<string, unknown> = {}
  Object.entries(payload).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== '') {
      cleaned[key] = value
    }
  })
  cleaned.updatedAt = nowIso()
  cleaned.updatedBy = sessionUser.id
  cleaned.updatedByName = sessionUser.name
  await setDoc(ref, cleaned, { merge: true })
  return payload
}

export const clearHREmployeeProfileField = async (
  employeeId: string,
  field: keyof HREmployeeProfileExt,
): Promise<void> => {
  const firestore = initialize()
  if (!firestore) throw new Error('Firestore HR employee profile is not configured.')
  await updateDoc(doc(firestore, HR_PROFILE_COLLECTION, employeeId), {
    [field]: null,
    updatedAt: nowIso(),
  })
}
