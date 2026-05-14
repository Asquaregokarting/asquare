import { doc, getDoc, setDoc } from "firebase/firestore";
import { initializeFirestore } from "../lib/firebase";
import { getFirestoreSessionUser, isPrivilegedRole } from "./firestore-session";
import { getFirestoreUserAuthById } from "./users-firestore";
import {
  MaskedSensitiveProfileRecord,
  UserGender,
  UserProfileBundle,
  UserProfileRecord,
  UserRecord,
  UserSensitiveProfileRecord
} from "./types";
import { nowIso, toOptionalString } from "./firestore-utils";

const USER_PROFILES_COLLECTION = "userProfiles";
const USER_SENSITIVE_PROFILES_COLLECTION = "userSensitiveProfiles";
const SECURITY_NOTICE =
  "Sensitive profile data is masked in the app UI, but current authentication/session trust is not a secure KYC-grade model yet.";

const compactObject = <T extends object>(value: T): T =>
  Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== undefined)) as T;

const isGender = (value: unknown): value is UserGender =>
  typeof value === "string" && ["Male", "Female", "Other"].includes(value);

const getCollectionDoc = (collectionName: string, userId: string) => {
  const firestore = initializeFirestore();
  if (!firestore) {
    return null;
  }
  return doc(firestore, collectionName, userId);
};

const maskValue = (value: string | undefined, visibleDigits = 4): string | undefined => {
  const raw = String(value ?? "").trim();
  if (!raw) {
    return undefined;
  }
  if (raw.length <= visibleDigits) {
    return raw;
  }
  return `${"*".repeat(Math.max(raw.length - visibleDigits, 0))}${raw.slice(-visibleDigits)}`;
};

const computeCompletionPercent = (
  account: Pick<UserRecord, "name" | "email" | "phone">,
  profile: Pick<UserProfileRecord, "profilePhotoUrl" | "dob" | "gender">,
  sensitive: Pick<UserSensitiveProfileRecord, "aadharNumber" | "panNumber" | "bankName" | "bankAccountNumber" | "ifscCode">
): number => {
  const checks = [
    Boolean(toOptionalString(profile.profilePhotoUrl)),
    Boolean(toOptionalString(account.name)),
    Boolean(toOptionalString(account.email)),
    Boolean(toOptionalString(account.phone)),
    Boolean(toOptionalString(profile.dob)),
    Boolean(profile.gender),
    Boolean(toOptionalString(sensitive.aadharNumber)),
    Boolean(toOptionalString(sensitive.panNumber)),
    Boolean(toOptionalString(sensitive.bankName)),
    Boolean(toOptionalString(sensitive.bankAccountNumber)),
    Boolean(toOptionalString(sensitive.ifscCode))
  ];
  const completed = checks.filter(Boolean).length;
  return Math.round((completed / checks.length) * 100);
};

const mapProfileRecord = (userId: string, data: Record<string, unknown> | undefined, account: UserRecord): UserProfileRecord => {
  const createdAt = toOptionalString(data?.createdAt) ?? account.createdAt ?? nowIso();
  const updatedAt = toOptionalString(data?.updatedAt) ?? createdAt;
  return {
    userId,
    profilePhotoUrl: toOptionalString(data?.profilePhotoUrl),
    dob: toOptionalString(data?.dob),
    gender: isGender(data?.gender) ? data?.gender : undefined,
    branchId: toOptionalString(data?.branchId),
    createdAt,
    updatedAt,
    profileCompletionPercent:
      typeof data?.profileCompletionPercent === "number" && Number.isFinite(data.profileCompletionPercent)
        ? Math.max(0, Math.min(100, Math.round(data.profileCompletionPercent)))
        : 0,
    securityNotice: SECURITY_NOTICE
  };
};

const mapSensitiveProfileRecord = (userId: string, data: Record<string, unknown> | undefined): UserSensitiveProfileRecord => {
  const createdAt = toOptionalString(data?.createdAt) ?? nowIso();
  const updatedAt = toOptionalString(data?.updatedAt) ?? createdAt;
  return {
    userId,
    aadharNumber: toOptionalString(data?.aadharNumber),
    panNumber: toOptionalString(data?.panNumber),
    bankAccountNumber: toOptionalString(data?.bankAccountNumber),
    bankName: toOptionalString(data?.bankName),
    ifscCode: toOptionalString(data?.ifscCode),
    createdAt,
    updatedAt
  };
};

const toMaskedSensitive = (sensitive: UserSensitiveProfileRecord): MaskedSensitiveProfileRecord => ({
  aadharNumber: maskValue(sensitive.aadharNumber),
  panNumber: maskValue(sensitive.panNumber),
  bankAccountNumber: maskValue(sensitive.bankAccountNumber),
  bankName: sensitive.bankName,
  ifscCode: maskValue(sensitive.ifscCode)
});

const assertProfileAccess = async (token: string, targetUserId: string): Promise<UserRecord> => {
  const sessionUser = await getFirestoreSessionUser(token);
  if (sessionUser.id !== targetUserId && !isPrivilegedRole(sessionUser.role)) {
    throw new Error("You are not allowed to access this profile.");
  }
  return sessionUser;
};

export const isFirestoreUserProfilesActive = (): boolean =>
  Boolean(getCollectionDoc(USER_PROFILES_COLLECTION, "__probe__") && getCollectionDoc(USER_SENSITIVE_PROFILES_COLLECTION, "__probe__"));

export const getFirestoreUserProfileBundle = async (token: string, targetUserId: string): Promise<UserProfileBundle> => {
  const userId = targetUserId.trim();
  if (!userId) {
    throw new Error("User id is required.");
  }
  await assertProfileAccess(token, userId);

  const authRecord = await getFirestoreUserAuthById(userId);
  if (!authRecord) {
    throw new Error("User not found.");
  }

  const profileRef = getCollectionDoc(USER_PROFILES_COLLECTION, userId);
  const sensitiveRef = getCollectionDoc(USER_SENSITIVE_PROFILES_COLLECTION, userId);
  if (!profileRef || !sensitiveRef) {
    throw new Error("Firestore profiles is not configured.");
  }

  const [profileSnapshot, sensitiveSnapshot] = await Promise.all([getDoc(profileRef), getDoc(sensitiveRef)]);
  const profile = mapProfileRecord(userId, profileSnapshot.data() as Record<string, unknown> | undefined, authRecord.user);
  const sensitive = mapSensitiveProfileRecord(userId, sensitiveSnapshot.data() as Record<string, unknown> | undefined);
  const profileCompletionPercent = computeCompletionPercent(authRecord.user, profile, sensitive);
  const normalizedProfile: UserProfileRecord = {
    ...profile,
    profileCompletionPercent
  };

  if (!profileSnapshot.exists() || profile.profileCompletionPercent !== profileCompletionPercent) {
    await setDoc(
      profileRef,
      compactObject({
        ...normalizedProfile,
        securityNotice: SECURITY_NOTICE
      }),
      { merge: true }
    );
  }

  return {
    account: authRecord.user,
    profile: normalizedProfile,
    sensitive,
    maskedSensitive: toMaskedSensitive(sensitive)
  };
};

export const updateFirestoreUserProfileBundle = async (
  token: string,
  targetUserId: string,
  payload: Partial<
    Pick<UserProfileRecord, "profilePhotoUrl" | "dob" | "gender" | "branchId"> &
      Pick<UserSensitiveProfileRecord, "aadharNumber" | "panNumber" | "bankAccountNumber" | "bankName" | "ifscCode">
  >
): Promise<UserProfileBundle> => {
  const userId = targetUserId.trim();
  if (!userId) {
    throw new Error("User id is required.");
  }
  await assertProfileAccess(token, userId);

  const authRecord = await getFirestoreUserAuthById(userId);
  if (!authRecord) {
    throw new Error("User not found.");
  }

  const profileRef = getCollectionDoc(USER_PROFILES_COLLECTION, userId);
  const sensitiveRef = getCollectionDoc(USER_SENSITIVE_PROFILES_COLLECTION, userId);
  if (!profileRef || !sensitiveRef) {
    throw new Error("Firestore profiles is not configured.");
  }

  const [profileSnapshot, sensitiveSnapshot] = await Promise.all([getDoc(profileRef), getDoc(sensitiveRef)]);
  const existingProfile = mapProfileRecord(userId, profileSnapshot.data() as Record<string, unknown> | undefined, authRecord.user);
  const existingSensitive = mapSensitiveProfileRecord(userId, sensitiveSnapshot.data() as Record<string, unknown> | undefined);

  const updatedProfile: UserProfileRecord = {
    ...existingProfile,
    profilePhotoUrl: payload.profilePhotoUrl !== undefined ? toOptionalString(payload.profilePhotoUrl) : existingProfile.profilePhotoUrl,
    dob: payload.dob !== undefined ? toOptionalString(payload.dob) : existingProfile.dob,
    gender: payload.gender !== undefined ? (isGender(payload.gender) ? payload.gender : undefined) : existingProfile.gender,
    branchId: payload.branchId !== undefined ? toOptionalString(payload.branchId) : existingProfile.branchId,
    updatedAt: nowIso(),
    securityNotice: SECURITY_NOTICE,
    profileCompletionPercent: 0
  };

  const updatedSensitive: UserSensitiveProfileRecord = {
    ...existingSensitive,
    aadharNumber: payload.aadharNumber !== undefined ? toOptionalString(payload.aadharNumber) : existingSensitive.aadharNumber,
    panNumber: payload.panNumber !== undefined ? toOptionalString(payload.panNumber) : existingSensitive.panNumber,
    bankAccountNumber:
      payload.bankAccountNumber !== undefined ? toOptionalString(payload.bankAccountNumber) : existingSensitive.bankAccountNumber,
    bankName: payload.bankName !== undefined ? toOptionalString(payload.bankName) : existingSensitive.bankName,
    ifscCode: payload.ifscCode !== undefined ? toOptionalString(payload.ifscCode) : existingSensitive.ifscCode,
    updatedAt: nowIso()
  };

  updatedProfile.profileCompletionPercent = computeCompletionPercent(authRecord.user, updatedProfile, updatedSensitive);

  await Promise.all([
    setDoc(
      profileRef,
      compactObject({
        ...updatedProfile,
        securityNotice: SECURITY_NOTICE
      }),
      { merge: true }
    ),
    setDoc(sensitiveRef, compactObject(updatedSensitive), { merge: true })
  ]);

  return {
    account: authRecord.user,
    profile: updatedProfile,
    sensitive: updatedSensitive,
    maskedSensitive: toMaskedSensitive(updatedSensitive)
  };
};
