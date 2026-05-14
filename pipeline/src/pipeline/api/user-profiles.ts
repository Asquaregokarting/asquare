import { getFirestoreUserProfileBundle, isFirestoreUserProfilesActive, updateFirestoreUserProfileBundle } from "./user-profiles-firestore";
import { UserProfileBundle, UserProfileRecord, UserSensitiveProfileRecord } from "./types";

export const userProfilesApi = {
  isActive(): boolean {
    return isFirestoreUserProfilesActive();
  },
  get(token: string, userId: string): Promise<UserProfileBundle> {
    return getFirestoreUserProfileBundle(token, userId);
  },
  update(
    token: string,
    userId: string,
    payload: Partial<
      Pick<UserProfileRecord, "profilePhotoUrl" | "dob" | "gender" | "branchId"> &
        Pick<UserSensitiveProfileRecord, "aadharNumber" | "panNumber" | "bankAccountNumber" | "bankName" | "ifscCode">
    >
  ): Promise<UserProfileBundle> {
    return updateFirestoreUserProfileBundle(token, userId, payload);
  }
};
