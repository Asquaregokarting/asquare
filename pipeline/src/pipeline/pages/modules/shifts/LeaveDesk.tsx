import { FormEvent, useEffect, useMemo, useState } from "react";
import { fmtDateIST, fmtDateTimeFullIST } from "../../../../lib/date-format";
import {
  EmployeeShiftRole,
  LeaveRequestRecord,
  LeaveRequestStatus,
  OvertimeRequestRecord,
  ShiftIssueRecord,
  shiftWorkforceApi
} from "../../../api/shift-workforce";
import { shiftsApi, ShiftRecord } from "../../../api/shifts";
import { Role } from "../../../api/types";
import { DataTable } from "../../../components/ui/DataTable";
import { SummaryCards } from "../../../components/ui/SummaryCards";

interface LeaveDeskProps {
  token: string;
  user: {
    id: string;
    name: string;
    role: Role;
  };
}

interface WorkingDayCell {
  key: string;
  date?: string;
  dayLabel?: string;
  status?: "Worked" | "Leave" | "Pending Leave" | "Weekend" | "Absent";
}

const EMPLOYEE_ROLES: EmployeeShiftRole[] = ["Telecaller", "Cashier", "TrackMarshall", "Editor"];
const REVIEWER_ROLES: Array<"Owner" | "Admin" | "Developer"> = ["Owner", "Admin", "Developer"];
const APPROVER_ROLES: Array<"Owner" | "Admin"> = ["Owner", "Admin"];

const isEmployeeRole = (role: Role): role is EmployeeShiftRole => EMPLOYEE_ROLES.includes(role as EmployeeShiftRole);
const isReviewerRole = (role: Role): role is "Owner" | "Admin" | "Developer" =>
  REVIEWER_ROLES.includes(role as "Owner" | "Admin" | "Developer");
const isApproverRole = (role: Role): role is "Owner" | "Admin" => APPROVER_ROLES.includes(role as "Owner" | "Admin");

const toLocalDate = (value: Date): string => {
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, "0");
  const day = String(value.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
};

const formatDate = (value: string | undefined) => fmtDateIST(value);
const formatDateTime = (value: string | undefined) => fmtDateTimeFullIST(value);

const statusPillClass = (status: string): string => {
  if (status === "Approved" || status === "Worked") return "border-success/40 bg-success/10 text-success";
  if (status === "Rejected" || status === "Absent") return "border-critical/40 bg-critical/10 text-critical";
  if (status === "Pending" || status === "Pending Leave" || status === "UnderReview") {
    return "border-warning/40 bg-warning/10 text-warning";
  }
  if (status === "Open") return "border-info/40 bg-info/10 text-info";
  return "border-border/70 bg-surface text-muted";
};

export const LeaveDesk = ({ token, user }: LeaveDeskProps) => {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const [leaveRequests, setLeaveRequests] = useState<LeaveRequestRecord[]>([]);
  const [overtimeRequests, setOvertimeRequests] = useState<OvertimeRequestRecord[]>([]);
  const [issueReports, setIssueReports] = useState<ShiftIssueRecord[]>([]);
  const [calendarShifts, setCalendarShifts] = useState<ShiftRecord[]>([]);
  const [calendarMonth, setCalendarMonth] = useState<Date>(() => {
    const today = new Date();
    return new Date(today.getFullYear(), today.getMonth(), 1);
  });
  const [leaveStatusFilter, setLeaveStatusFilter] = useState<LeaveRequestStatus | "All">("All");

  const [leaveDialogOpen, setLeaveDialogOpen] = useState(false);
  const [overtimeDialogOpen, setOvertimeDialogOpen] = useState(false);
  const [issueDialogOpen, setIssueDialogOpen] = useState(false);

  const [leaveForm, setLeaveForm] = useState({
    reason: "",
    fromDate: toLocalDate(new Date()),
    toDate: toLocalDate(new Date())
  });
  const [overtimeForm, setOvertimeForm] = useState({
    requestDate: toLocalDate(new Date()),
    hours: "",
    reason: ""
  });
  const [issueForm, setIssueForm] = useState({
    issueType: "Attendance",
    issueDate: toLocalDate(new Date()),
    description: ""
  });

  const employeeRole = isEmployeeRole(user.role);
  const reviewerRole = isReviewerRole(user.role);
  const approverRole = isApproverRole(user.role);
  const canViewAll = reviewerRole && !employeeRole;
  const monthStart = toLocalDate(new Date(calendarMonth.getFullYear(), calendarMonth.getMonth(), 1));
  const monthEnd = toLocalDate(new Date(calendarMonth.getFullYear(), calendarMonth.getMonth() + 1, 0));

  const loadDesk = async () => {
    setLoading(true);
    setError(null);
    try {
      const userIdForScopedData = canViewAll ? undefined : user.id;
      const [leaveResult, overtimeResult, issueResult, monthShifts] = await Promise.all([
        shiftWorkforceApi.listLeaves(token, {
          status: leaveStatusFilter === "All" ? undefined : leaveStatusFilter,
          userId: userIdForScopedData
        }),
        shiftWorkforceApi.listOvertime(token, { userId: userIdForScopedData }),
        shiftWorkforceApi.listIssues(token, { userId: userIdForScopedData }),
        employeeRole
          ? shiftsApi.list(token, { userId: user.id, from: monthStart, to: monthEnd })
          : Promise.resolve(null)
      ]);
      setLeaveRequests(leaveResult.requests);
      setOvertimeRequests(overtimeResult.requests);
      setIssueReports(issueResult.issues);
      setCalendarShifts(monthShifts?.shifts ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load leave desk.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadDesk();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, user.id, user.role, leaveStatusFilter, calendarMonth]);

  const leaveSummary = {
    pending: leaveRequests.filter((item) => item.status === "Pending").length,
    approved: leaveRequests.filter((item) => item.status === "Approved").length,
    rejected: leaveRequests.filter((item) => item.status === "Rejected").length
  };

  const workingDayCells = useMemo<WorkingDayCell[]>(() => {
    if (!employeeRole) return [];

    const year = calendarMonth.getFullYear();
    const month = calendarMonth.getMonth();
    const firstDay = new Date(year, month, 1);
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const shiftDates = new Set(calendarShifts.map((shift) => shift.shiftDate));
    const myLeaves = leaveRequests.filter((row) => row.userId === user.id);
    const cells: WorkingDayCell[] = [];

    for (let i = 0; i < firstDay.getDay(); i += 1) cells.push({ key: `pad-start-${i}` });
    for (let day = 1; day <= daysInMonth; day += 1) {
      const date = toLocalDate(new Date(year, month, day));
      const weekday = new Date(year, month, day).getDay();
      const leave = myLeaves.find((item) => item.fromDate <= date && item.toDate >= date);
      const hasShift = shiftDates.has(date);
      let status: WorkingDayCell["status"] = "Absent";
      if (leave?.status === "Approved") status = "Leave";
      else if (leave?.status === "Pending") status = "Pending Leave";
      else if (hasShift) status = "Worked";
      else if (weekday === 0 || weekday === 6) status = "Weekend";
      cells.push({ key: date, date, dayLabel: String(day), status });
    }
    while (cells.length % 7 !== 0) cells.push({ key: `pad-end-${cells.length}` });
    return cells;
  }, [calendarMonth, calendarShifts, employeeRole, leaveRequests, user.id]);

  const onReviewLeave = async (requestId: string, status: Exclude<LeaveRequestStatus, "Pending">): Promise<void> => {
    setLoading(true);
    setError(null);
    setSuccess(null);
    try {
      await shiftWorkforceApi.reviewLeave(token, requestId, { status });
      setSuccess(`Leave request ${status.toLowerCase()}.`);
      await loadDesk();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to review leave request.");
    } finally {
      setLoading(false);
    }
  };

  const onSubmitLeave = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    setLoading(true);
    setError(null);
    setSuccess(null);
    try {
      await shiftWorkforceApi.applyLeave(token, leaveForm);
      setLeaveDialogOpen(false);
      setLeaveForm({
        reason: "",
        fromDate: toLocalDate(new Date()),
        toDate: toLocalDate(new Date())
      });
      setSuccess("Leave request submitted.");
      await loadDesk();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to submit leave request.");
    } finally {
      setLoading(false);
    }
  };

  const onSubmitOvertime = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    setLoading(true);
    setError(null);
    setSuccess(null);
    try {
      await shiftWorkforceApi.requestOvertime(token, {
        requestDate: overtimeForm.requestDate,
        hours: Number(overtimeForm.hours),
        reason: overtimeForm.reason
      });
      setOvertimeDialogOpen(false);
      setOvertimeForm({
        requestDate: toLocalDate(new Date()),
        hours: "",
        reason: ""
      });
      setSuccess("Overtime request submitted.");
      await loadDesk();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to submit overtime request.");
    } finally {
      setLoading(false);
    }
  };

  const onSubmitIssue = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    setLoading(true);
    setError(null);
    setSuccess(null);
    try {
      await shiftWorkforceApi.reportIssue(token, issueForm);
      setIssueDialogOpen(false);
      setIssueForm({
        issueType: "Attendance",
        issueDate: toLocalDate(new Date()),
        description: ""
      });
      setSuccess("Issue reported successfully.");
      await loadDesk();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to report issue.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="ui-section-stack lg:space-y-5">
      {error ? <p className="rounded-lg border border-critical/45 bg-critical/10 px-3 py-2 text-sm text-critical">{error}</p> : null}
      {success ? <p className="rounded-lg border border-success/45 bg-success/10 px-3 py-2 text-sm text-success">{success}</p> : null}

      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-surface p-3">
        <div>
          <p className="text-sm font-semibold text-text">
            {canViewAll ? "Review employee leave requests" : "Track your leave history and workforce requests"}
          </p>
          <p className="text-xs text-muted">Admin and Owner approve/reject requests. Developer can only view.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          {employeeRole ? (
            <button type="button" onClick={() => setLeaveDialogOpen(true)} className="ui-btn ui-btn-primary">
              Apply Leave
            </button>
          ) : null}
          {employeeRole ? (
            <button type="button" onClick={() => setOvertimeDialogOpen(true)} className="ui-btn ui-btn-info">
              Request Overtime
            </button>
          ) : null}
          {employeeRole ? (
            <button type="button" onClick={() => setIssueDialogOpen(true)} className="ui-btn ui-btn-neutral">
              Report Issue
            </button>
          ) : null}
        </div>
      </div>

      <SummaryCards
        items={[
          { id: "pending", label: "Pending Leaves", value: String(leaveSummary.pending), tone: "warning" },
          { id: "approved", label: "Approved Leaves", value: String(leaveSummary.approved), tone: "success" },
          { id: "rejected", label: "Rejected Leaves", value: String(leaveSummary.rejected), tone: "critical" },
          { id: "overtime", label: "Overtime Requests", value: String(overtimeRequests.length), tone: "info" }
        ]}
      />

      {employeeRole ? (
        <div className="rounded-xl border border-border bg-surface p-4">
          <div className="mb-3 flex items-center justify-between">
            <h4 className="text-lg font-semibold text-text">Working Days Calendar</h4>
            <div className="inline-flex items-center gap-2">
              <button
                type="button"
                className="ui-btn ui-btn-neutral min-h-8 px-2 py-1 text-xs"
                onClick={() => setCalendarMonth((current) => new Date(current.getFullYear(), current.getMonth() - 1, 1))}
              >
                Prev
              </button>
              <span className="text-sm font-semibold text-text">
                {calendarMonth.toLocaleString(undefined, { month: "long", year: "numeric" })}
              </span>
              <button
                type="button"
                className="ui-btn ui-btn-neutral min-h-8 px-2 py-1 text-xs"
                onClick={() => setCalendarMonth((current) => new Date(current.getFullYear(), current.getMonth() + 1, 1))}
              >
                Next
              </button>
            </div>
          </div>
          <div className="grid grid-cols-7 gap-2 text-center text-xs font-semibold uppercase tracking-[0.07em] text-muted">
            {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((label) => (
              <div key={label}>{label}</div>
            ))}
          </div>
          <div className="mt-2 grid grid-cols-7 gap-2">
            {workingDayCells.map((cell) =>
              cell.date ? (
                <div key={cell.key} className="rounded-lg border border-border/70 bg-panel p-2 text-center">
                  <p className="text-sm font-semibold text-text">{cell.dayLabel}</p>
                  <p className={`mt-1 rounded-md border px-1.5 py-0.5 text-[10px] font-semibold ${statusPillClass(cell.status ?? "")}`}>
                    {cell.status}
                  </p>
                </div>
              ) : (
                <div key={cell.key} className="rounded-lg border border-transparent p-2" />
              )
            )}
          </div>
        </div>
      ) : null}

      <div className="rounded-xl border border-border bg-surface p-4">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h4 className="text-lg font-semibold text-text">{canViewAll ? "Employee Leave Requests" : "Leave History"}</h4>
          <select
            className="ui-field min-h-9 max-w-[180px]"
            value={leaveStatusFilter}
            onChange={(event) => setLeaveStatusFilter(event.target.value as LeaveRequestStatus | "All")}
          >
            <option value="All">All Statuses</option>
            <option value="Pending">Pending</option>
            <option value="Approved">Approved</option>
            <option value="Rejected">Rejected</option>
          </select>
        </div>
        <DataTable
          columns={[
            ...(canViewAll
              ? [
                  {
                    key: "employee",
                    header: "Employee",
                    render: (item: LeaveRequestRecord) => (
                      <div>
                        <p className="text-sm font-semibold text-text">{item.userName}</p>
                        <p className="text-xs text-muted">{item.role}</p>
                      </div>
                    )
                  }
                ]
              : []),
            { key: "fromDate", header: "From", render: (item: LeaveRequestRecord) => formatDate(item.fromDate) },
            { key: "toDate", header: "To", render: (item: LeaveRequestRecord) => formatDate(item.toDate) },
            {
              key: "reason",
              header: "Reason",
              render: (item: LeaveRequestRecord) => (
                <span className="inline-block max-w-[320px] truncate align-middle" title={item.reason}>
                  {item.reason}
                </span>
              )
            },
            {
              key: "status",
              header: "Status",
              render: (item: LeaveRequestRecord) => (
                <span className={`rounded-md border px-2 py-1 text-xs font-semibold ${statusPillClass(item.status)}`}>
                  {item.status}
                </span>
              )
            },
            {
              key: "updated",
              header: "Updated",
              render: (item: LeaveRequestRecord) => formatDateTime(item.updatedAt)
            },
            ...(approverRole
              ? [
                  {
                    key: "actions",
                    header: "Actions",
                    render: (item: LeaveRequestRecord) =>
                      item.status === "Pending" ? (
                        <div className="flex flex-wrap gap-2">
                          <button
                            type="button"
                            onClick={() => void onReviewLeave(item.id, "Approved")}
                            className="rounded-lg border border-success/45 bg-success/10 px-2 py-1 text-xs font-semibold text-success"
                          >
                            Approve
                          </button>
                          <button
                            type="button"
                            onClick={() => void onReviewLeave(item.id, "Rejected")}
                            className="rounded-lg border border-critical/45 bg-critical/10 px-2 py-1 text-xs font-semibold text-critical"
                          >
                            Reject
                          </button>
                        </div>
                      ) : (
                        <span className="text-xs text-muted">Reviewed</span>
                      )
                  }
                ]
              : [])
          ]}
          rows={leaveRequests}
          rowKey={(item) => item.id}
          emptyMessage={loading ? "Loading leave requests..." : "No leave requests found."}
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="rounded-xl border border-border bg-surface p-4">
          <h4 className="mb-3 text-lg font-semibold text-text">Overtime Requests</h4>
          <DataTable
            columns={[
              ...(canViewAll
                ? [
                    {
                      key: "employee",
                      header: "Employee",
                      render: (item: OvertimeRequestRecord) => (
                        <div>
                          <p className="text-sm font-semibold text-text">{item.userName}</p>
                          <p className="text-xs text-muted">{item.role}</p>
                        </div>
                      )
                    }
                  ]
                : []),
              { key: "date", header: "Date", render: (item: OvertimeRequestRecord) => formatDate(item.requestDate) },
              { key: "hours", header: "Hours", render: (item: OvertimeRequestRecord) => item.hours.toFixed(2) },
              {
                key: "status",
                header: "Status",
                render: (item: OvertimeRequestRecord) => (
                  <span className={`rounded-md border px-2 py-1 text-xs font-semibold ${statusPillClass(item.status)}`}>
                    {item.status}
                  </span>
                )
              }
            ]}
            rows={overtimeRequests}
            rowKey={(item) => item.id}
            emptyMessage={loading ? "Loading overtime requests..." : "No overtime requests found."}
          />
        </div>

        <div className="rounded-xl border border-border bg-surface p-4">
          <h4 className="mb-3 text-lg font-semibold text-text">Reported Issues</h4>
          <DataTable
            columns={[
              ...(canViewAll
                ? [
                    {
                      key: "employee",
                      header: "Employee",
                      render: (item: ShiftIssueRecord) => (
                        <div>
                          <p className="text-sm font-semibold text-text">{item.userName}</p>
                          <p className="text-xs text-muted">{item.role}</p>
                        </div>
                      )
                    }
                  ]
                : []),
              { key: "type", header: "Type", render: (item: ShiftIssueRecord) => item.issueType },
              { key: "date", header: "Date", render: (item: ShiftIssueRecord) => formatDate(item.issueDate) },
              {
                key: "status",
                header: "Status",
                render: (item: ShiftIssueRecord) => (
                  <span className={`rounded-md border px-2 py-1 text-xs font-semibold ${statusPillClass(item.status)}`}>
                    {item.status}
                  </span>
                )
              }
            ]}
            rows={issueReports}
            rowKey={(item) => item.id}
            emptyMessage={loading ? "Loading issues..." : "No issues found."}
          />
        </div>
      </div>

      {leaveDialogOpen ? (
        <div className="fixed inset-0 z-40 grid place-items-center bg-base/75 p-4 backdrop-blur-sm">
          <div className="w-full max-w-xl rounded-2xl border border-border/80 bg-panel shadow-panel">
            <div className="flex items-center justify-between border-b border-border/70 px-5 py-4">
              <h4 className="text-2xl font-semibold text-text">Apply Leave</h4>
              <button type="button" onClick={() => setLeaveDialogOpen(false)} className="ui-btn ui-btn-neutral min-h-8 px-2 py-1 text-sm">
                x
              </button>
            </div>
            <form onSubmit={(event) => void onSubmitLeave(event)} className="space-y-4 px-5 py-4">
              <div>
                <label className="mb-1 block text-sm text-muted">Reason</label>
                <textarea
                  rows={3}
                  required
                  value={leaveForm.reason}
                  onChange={(event) => setLeaveForm((current) => ({ ...current, reason: event.target.value }))}
                  className="ui-field w-full resize-none rounded-xl bg-surface"
                />
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <label className="mb-1 block text-sm text-muted">From Date</label>
                  <input
                    type="date"
                    required
                    value={leaveForm.fromDate}
                    onChange={(event) => setLeaveForm((current) => ({ ...current, fromDate: event.target.value }))}
                    className="ui-field w-full rounded-xl bg-surface"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-sm text-muted">To Date</label>
                  <input
                    type="date"
                    required
                    value={leaveForm.toDate}
                    onChange={(event) => setLeaveForm((current) => ({ ...current, toDate: event.target.value }))}
                    className="ui-field w-full rounded-xl bg-surface"
                  />
                </div>
              </div>
              <div className="flex justify-end gap-2 border-t border-border/70 pt-4">
                <button type="button" onClick={() => setLeaveDialogOpen(false)} className="ui-btn ui-btn-neutral">
                  Cancel
                </button>
                <button type="submit" className="ui-btn ui-btn-primary" disabled={loading}>
                  Submit Request
                </button>
              </div>
            </form>
          </div>
        </div>
      ) : null}

      {overtimeDialogOpen ? (
        <div className="fixed inset-0 z-40 grid place-items-center bg-base/75 p-4 backdrop-blur-sm">
          <div className="w-full max-w-xl rounded-2xl border border-border/80 bg-panel shadow-panel">
            <div className="flex items-center justify-between border-b border-border/70 px-5 py-4">
              <h4 className="text-2xl font-semibold text-text">Request Overtime</h4>
              <button type="button" onClick={() => setOvertimeDialogOpen(false)} className="ui-btn ui-btn-neutral min-h-8 px-2 py-1 text-sm">
                x
              </button>
            </div>
            <form onSubmit={(event) => void onSubmitOvertime(event)} className="space-y-4 px-5 py-4">
              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <label className="mb-1 block text-sm text-muted">Date</label>
                  <input
                    type="date"
                    required
                    value={overtimeForm.requestDate}
                    onChange={(event) =>
                      setOvertimeForm((current) => ({ ...current, requestDate: event.target.value }))
                    }
                    className="ui-field w-full rounded-xl bg-surface"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-sm text-muted">Hours</label>
                  <input
                    type="number"
                    min="0.5"
                    step="0.5"
                    required
                    value={overtimeForm.hours}
                    onChange={(event) => setOvertimeForm((current) => ({ ...current, hours: event.target.value }))}
                    className="ui-field w-full rounded-xl bg-surface"
                  />
                </div>
              </div>
              <div>
                <label className="mb-1 block text-sm text-muted">Reason</label>
                <textarea
                  rows={3}
                  required
                  value={overtimeForm.reason}
                  onChange={(event) => setOvertimeForm((current) => ({ ...current, reason: event.target.value }))}
                  className="ui-field w-full resize-none rounded-xl bg-surface"
                />
              </div>
              <div className="flex justify-end gap-2 border-t border-border/70 pt-4">
                <button type="button" onClick={() => setOvertimeDialogOpen(false)} className="ui-btn ui-btn-neutral">
                  Cancel
                </button>
                <button type="submit" className="ui-btn ui-btn-primary" disabled={loading}>
                  Submit Overtime
                </button>
              </div>
            </form>
          </div>
        </div>
      ) : null}

      {issueDialogOpen ? (
        <div className="fixed inset-0 z-40 grid place-items-center bg-base/75 p-4 backdrop-blur-sm">
          <div className="w-full max-w-xl rounded-2xl border border-border/80 bg-panel shadow-panel">
            <div className="flex items-center justify-between border-b border-border/70 px-5 py-4">
              <h4 className="text-2xl font-semibold text-text">Report Issue</h4>
              <button type="button" onClick={() => setIssueDialogOpen(false)} className="ui-btn ui-btn-neutral min-h-8 px-2 py-1 text-sm">
                x
              </button>
            </div>
            <form onSubmit={(event) => void onSubmitIssue(event)} className="space-y-4 px-5 py-4">
              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <label className="mb-1 block text-sm text-muted">Issue Type</label>
                  <select
                    value={issueForm.issueType}
                    onChange={(event) => setIssueForm((current) => ({ ...current, issueType: event.target.value }))}
                    className="ui-field w-full rounded-xl bg-surface"
                  >
                    <option value="Attendance">Attendance</option>
                    <option value="Shift Schedule">Shift Schedule</option>
                    <option value="System">System</option>
                    <option value="Other">Other</option>
                  </select>
                </div>
                <div>
                  <label className="mb-1 block text-sm text-muted">Issue Date</label>
                  <input
                    type="date"
                    required
                    value={issueForm.issueDate}
                    onChange={(event) => setIssueForm((current) => ({ ...current, issueDate: event.target.value }))}
                    className="ui-field w-full rounded-xl bg-surface"
                  />
                </div>
              </div>
              <div>
                <label className="mb-1 block text-sm text-muted">Description</label>
                <textarea
                  rows={3}
                  required
                  value={issueForm.description}
                  onChange={(event) => setIssueForm((current) => ({ ...current, description: event.target.value }))}
                  className="ui-field w-full resize-none rounded-xl bg-surface"
                />
              </div>
              <div className="flex justify-end gap-2 border-t border-border/70 pt-4">
                <button type="button" onClick={() => setIssueDialogOpen(false)} className="ui-btn ui-btn-neutral">
                  Cancel
                </button>
                <button type="submit" className="ui-btn ui-btn-primary" disabled={loading}>
                  Submit Issue
                </button>
              </div>
            </form>
          </div>
        </div>
      ) : null}
    </div>
  );
};

export default LeaveDesk;
