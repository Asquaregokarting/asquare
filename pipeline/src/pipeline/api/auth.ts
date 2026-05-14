import { loginWithFirestoreAuth, logoutFirestoreAuth, resetFirestoreAuthPassword } from "./auth-firestore";
import { LoginResponse } from "./types";

export const authApi = {
  login(identifier: string, password: string): Promise<LoginResponse> {
    return loginWithFirestoreAuth(identifier, password);
  },
  logout(_token: string): Promise<{ message: string }> {
    return logoutFirestoreAuth();
  },
  resetPassword(token: string, oldPassword: string, newPassword: string): Promise<{ message: string }> {
    return resetFirestoreAuthPassword(token, oldPassword, newPassword);
  }
};
