import {
  createFirestoreUser,
  deactivateFirestoreUser,
  deleteFirestoreUser,
  listFirestoreUsers,
  updateFirestoreUser
} from "./users-firestore";
import { UserRecord } from "./types";

export const usersApi = {
  list(
    _token: string,
    query?: { role?: UserRecord["role"]; status?: "Active" | "Inactive"; q?: string; location?: string }
  ): Promise<{ users: UserRecord[] }> {
    return listFirestoreUsers(query).then((users) => ({ users }));
  },
  create(
    token: string,
    payload: {
      name: string;
      username: string;
      email: string;
      phone: string;
      role: UserRecord["role"];
      workspaceIds?: string[];
      allowedLocations?: string[];
      temporaryPassword: string;
    }
  ): Promise<{ user: UserRecord }> {
    return createFirestoreUser(payload, token).then((user) => ({ user }));
  },
  update(_token: string, userId: string, payload: Partial<UserRecord>): Promise<{ user: UserRecord }> {
    return updateFirestoreUser(userId, payload).then((user) => ({ user }));
  },
  deactivate(_token: string, userId: string): Promise<{ message: string }> {
    return deactivateFirestoreUser(userId).then(() => ({ message: "User deactivated." }));
  },
  delete(_token: string, userId: string): Promise<{ message: string }> {
    return deleteFirestoreUser(userId).then(() => ({ message: "User deleted permanently." }));
  }
};
