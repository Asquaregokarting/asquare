import {
  getFirestoreMyVendorDetails,
  getFirestoreVendorDetailsByUserId,
  isFirestoreVendorDetailsActive,
  listFirestoreVendorDetails,
  submitFirestoreVendorDetails,
  updateFirestoreVendorDetails
} from "./vendor-details-firestore";
import { VendorDetailsPayload, VendorDetailsRecord } from "./types";

export const vendorDetailsApi = {
  isActive(): boolean {
    return isFirestoreVendorDetailsActive();
  },
  getMine(token: string): Promise<VendorDetailsRecord> {
    return getFirestoreMyVendorDetails(token);
  },
  getByUserId(token: string, userId: string): Promise<VendorDetailsRecord> {
    return getFirestoreVendorDetailsByUserId(token, userId);
  },
  submit(token: string, payload: VendorDetailsPayload): Promise<VendorDetailsRecord> {
    return submitFirestoreVendorDetails(token, payload);
  },
  list(token: string): Promise<VendorDetailsRecord[]> {
    return listFirestoreVendorDetails(token);
  },
  update(token: string, userId: string, updates: Partial<VendorDetailsPayload>): Promise<VendorDetailsRecord> {
    return updateFirestoreVendorDetails(token, userId, updates);
  }
};
