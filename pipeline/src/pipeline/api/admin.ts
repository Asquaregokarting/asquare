import { AuditLogRecord } from "./types";

export const adminApi = {
  async listAuditLogs(_token: string, _limit = 10): Promise<{ logs: AuditLogRecord[] }> {
    // Audit logs were only available via the mock API.
    // Return empty until a Firestore-backed implementation is added.
    return { logs: [] };
  }
};

