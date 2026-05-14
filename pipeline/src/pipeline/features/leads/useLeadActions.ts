import { useCallback, useState } from "react";
import { leadsApi, type CreateLeadPayload } from "../../api/leads";
import type { CallOutcome, LeadStatus, LeadSubStatus } from "../../api/types";
import { useAuth } from "../auth/auth-context";
import { useAsyncAction } from "../shared/useAsyncAction";

export const useLeadActions = (onMutate?: () => void) => {
  const { session } = useAuth();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const token = session?.token ?? "";
  const action = useAsyncAction({ setBusy, setError, setSuccess });
  const refresh = () => onMutate?.();

  const createLead = useCallback(
    (payload: CreateLeadPayload) =>
      action(() => leadsApi.create(token, payload), {
        successMessage: "Lead created",
        fallbackError: "Failed to create lead",
        onSuccess: refresh,
      }),
    [token, action]
  );

  const claimLead = useCallback(
    (leadId: string) =>
      action(() => leadsApi.claim(token, leadId), {
        successMessage: "Lead claimed",
        fallbackError: "Failed to claim lead",
        onSuccess: refresh,
      }),
    [token, action]
  );

  const assignLead = useCallback(
    (leadId: string, toUserId: string) =>
      action(() => leadsApi.assign(token, leadId, toUserId), {
        successMessage: "Lead assigned",
        fallbackError: "Failed to assign lead",
        onSuccess: refresh,
      }),
    [token, action]
  );

  const updateStatus = useCallback(
    (leadId: string, status: LeadStatus, subStatus?: LeadSubStatus) =>
      action(() => leadsApi.updateStatus(token, leadId, status, subStatus), {
        successMessage: "Status updated",
        fallbackError: "Failed to update status",
        onSuccess: refresh,
      }),
    [token, action]
  );

  const submitFeedback = useCallback(
    (leadId: string, notes: string) =>
      action(() => leadsApi.submitFeedback(token, leadId, notes), {
        successMessage: "Feedback submitted",
        fallbackError: "Failed to submit feedback",
        onSuccess: refresh,
      }),
    [token, action]
  );

  const addNote = useCallback(
    (leadId: string, text: string) =>
      action(() => leadsApi.addNote(token, leadId, text), {
        successMessage: "Note added",
        fallbackError: "Failed to add note",
        onSuccess: refresh,
      }),
    [token, action]
  );

  const scheduleCallback = useCallback(
    (leadId: string, date: string) =>
      action(() => leadsApi.scheduleCallback(token, leadId, date), {
        successMessage: "Callback scheduled",
        fallbackError: "Failed to schedule callback",
        onSuccess: refresh,
      }),
    [token, action]
  );

  const deleteLead = useCallback(
    (leadId: string) =>
      action(() => leadsApi.delete(token, leadId), {
        successMessage: "Lead deleted",
        fallbackError: "Failed to delete lead",
        onSuccess: refresh,
      }),
    [token, action]
  );

  const recoverAbandonedCarts = useCallback(
    (branchId?: string) =>
      action(() => leadsApi.recoverAbandonedCarts(token, branchId), {
        successMessage: "Abandoned carts recovered",
        fallbackError: "Failed to recover abandoned carts",
        onSuccess: refresh,
      }),
    [token, action]
  );

  const logOutcome = useCallback(
    (leadId: string, outcome: CallOutcome, callbackDate?: string, notes?: string) =>
      action(() => leadsApi.logCallOutcome(token, leadId, outcome, callbackDate, notes), {
        successMessage: "Outcome logged",
        fallbackError: "Failed to log outcome",
        onSuccess: refresh,
      }),
    [token, action]
  );

  return {
    busy,
    error,
    success,
    setError,
    setSuccess,
    createLead,
    claimLead,
    assignLead,
    updateStatus,
    submitFeedback,
    addNote,
    scheduleCallback,
    deleteLead,
    recoverAbandonedCarts,
    logOutcome,
  };
};
