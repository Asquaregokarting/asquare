import {
  approveFirestoreVendorRegistration,
  deleteFirestoreVendor,
  getMyFirestoreRegistration,
  isEmailAlreadyRegistered,
  isMobileAlreadyRegistered,
  isFirestoreVendorRegistrationActive,
  listApprovedFirestoreVendors,
  listFirestoreVendorRegistrations,
  rejectFirestoreVendorRegistration,
  submitFirestoreVendorRegistration,
  VendorDeletionSummary
} from "./vendor-registration-firestore";
import { VendorRegistrationPayload, VendorRegistrationRecord } from "./types";

export const vendorRegistrationApi = {
  isActive(): boolean {
    return isFirestoreVendorRegistrationActive();
  },
  getMine(token: string): Promise<VendorRegistrationRecord | null> {
    return getMyFirestoreRegistration(token);
  },
  submit(payload: VendorRegistrationPayload, password: string): Promise<VendorRegistrationRecord> {
    return submitFirestoreVendorRegistration(payload, password);
  },
  list(token: string): Promise<VendorRegistrationRecord[]> {
    return listFirestoreVendorRegistrations(token);
  },
  approve(token: string, registrationId: string, revenueShare?: number, vendorType?: "ThirdParty" | "SubLease"): Promise<void> {
    return approveFirestoreVendorRegistration(token, registrationId, revenueShare, vendorType);
  },
  reject(token: string, registrationId: string): Promise<void> {
    return rejectFirestoreVendorRegistration(token, registrationId);
  },
  listApproved(token: string): Promise<VendorRegistrationRecord[]> {
    return listApprovedFirestoreVendors(token);
  },
  deleteVendor(token: string, vendorUserId: string): Promise<VendorDeletionSummary> {
    return deleteFirestoreVendor(token, vendorUserId);
  },
  checkMobileUniqueness(mobileNumber: string): Promise<boolean> {
    return isMobileAlreadyRegistered(mobileNumber);
  },
  checkEmailUniqueness(email: string): Promise<boolean> {
    return isEmailAlreadyRegistered(email);
  }
};
