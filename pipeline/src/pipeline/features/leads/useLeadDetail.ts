import { useCallback, useEffect, useState } from "react";
import { leadsApi } from "../../api/leads";
import type { LeadRecord } from "../../api/types";
import { useAuth } from "../auth/auth-context";
import { useLeadTimeline } from "./useLeadTimeline";

export const useLeadDetail = (leadId: string | null) => {
  const { session } = useAuth();
  const [lead, setLead] = useState<LeadRecord | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const token = session?.token ?? "";

  const timeline = useLeadTimeline(leadId);

  const load = useCallback(async () => {
    if (!token || !leadId) {
      setLead(null);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const result = await leadsApi.get(token, leadId);
      setLead(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load lead");
    } finally {
      setLoading(false);
    }
  }, [token, leadId]);

  // Set presence on mount, clear on unmount
  useEffect(() => {
    if (!token || !leadId) return;
    void leadsApi.setPresence(token, leadId).catch(() => {});
    return () => {
      void leadsApi.clearPresence(token, leadId).catch(() => {});
    };
  }, [token, leadId]);

  useEffect(() => {
    void load();
  }, [load]);

  const refresh = useCallback(() => {
    void load();
    timeline.refresh();
  }, [load, timeline]);

  return { lead, loading, error, timeline, refresh };
};
