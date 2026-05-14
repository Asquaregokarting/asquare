import {
  createFirestoreLeaveRequest,
  createFirestoreOvertimeRequest,
  createFirestoreShiftIssue,
  isFirestoreShiftWorkforceActive,
  listFirestoreLeaveRequests,
  listFirestoreOvertimeRequests,
  listFirestoreShiftIssues,
  reviewFirestoreLeaveRequest
} from "./shift-workforce-firestore";

export type EmployeeShiftRole = "Telecaller" | "Cashier" | "TrackMarshall" | "Editor";
export type LeaveRequestStatus = "Pending" | "Approved" | "Rejected";
export type OvertimeRequestStatus = "Pending" | "Approved" | "Rejected";
export type ShiftIssueStatus = "Open" | "UnderReview" | "Resolved";

export interface LeaveRequestRecord {
  id: string;
  userId: string;
  userName: string;
  role: EmployeeShiftRole;
  reason: string;
  fromDate: string;
  toDate: string;
  status: LeaveRequestStatus;
  createdAt: string;
  updatedAt: string;
  reviewedBy?: string;
  reviewerRole?: string;
  reviewedAt?: string;
  reviewNote?: string;
}

export interface OvertimeRequestRecord {
  id: string;
  userId: string;
  userName: string;
  role: EmployeeShiftRole;
  requestDate: string;
  hours: number;
  reason: string;
  status: OvertimeRequestStatus;
  createdAt: string;
  updatedAt: string;
}

export interface ShiftIssueRecord {
  id: string;
  userId: string;
  userName: string;
  role: EmployeeShiftRole;
  issueType: string;
  description: string;
  issueDate: string;
  status: ShiftIssueStatus;
  createdAt: string;
  updatedAt: string;
}

const ensureEnabled = (): void => {
  if (!isFirestoreShiftWorkforceActive()) {
    throw new Error("Shift workforce requests are unavailable. Configure Firestore for this feature.");
  }
};

export const shiftWorkforceApi = {
  listLeaves(
    token: string,
    query?: { status?: LeaveRequestStatus; userId?: string }
  ): Promise<{ requests: LeaveRequestRecord[] }> {
    ensureEnabled();
    return listFirestoreLeaveRequests(token, query).then((requests) => ({ requests }));
  },
  applyLeave(
    token: string,
    payload: { reason: string; fromDate: string; toDate: string }
  ): Promise<{ request: LeaveRequestRecord }> {
    ensureEnabled();
    return createFirestoreLeaveRequest(token, payload).then((request) => ({ request }));
  },
  reviewLeave(
    token: string,
    leaveId: string,
    payload: { status: Exclude<LeaveRequestStatus, "Pending">; reviewNote?: string }
  ): Promise<{ request: LeaveRequestRecord }> {
    ensureEnabled();
    return reviewFirestoreLeaveRequest(token, leaveId, payload).then((request) => ({ request }));
  },
  listOvertime(
    token: string,
    query?: { userId?: string; status?: OvertimeRequestStatus }
  ): Promise<{ requests: OvertimeRequestRecord[] }> {
    ensureEnabled();
    return listFirestoreOvertimeRequests(token, query).then((requests) => ({ requests }));
  },
  requestOvertime(
    token: string,
    payload: { requestDate: string; hours: number; reason: string }
  ): Promise<{ request: OvertimeRequestRecord }> {
    ensureEnabled();
    return createFirestoreOvertimeRequest(token, payload).then((request) => ({ request }));
  },
  listIssues(
    token: string,
    query?: { userId?: string; status?: ShiftIssueStatus }
  ): Promise<{ issues: ShiftIssueRecord[] }> {
    ensureEnabled();
    return listFirestoreShiftIssues(token, query).then((issues) => ({ issues }));
  },
  reportIssue(
    token: string,
    payload: { issueType: string; description: string; issueDate: string }
  ): Promise<{ issue: ShiftIssueRecord }> {
    ensureEnabled();
    return createFirestoreShiftIssue(token, payload).then((issue) => ({ issue }));
  }
};
