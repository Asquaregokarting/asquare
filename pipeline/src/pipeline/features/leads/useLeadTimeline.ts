import { useCallback, useEffect, useState } from "react";
import { leadsApi } from "../../api/leads";
import type { LeadTimelineEvent } from "../../api/types";
import { useAuth } from "../auth/auth-context";

export const useLeadTimeline = (leadId: string | null) => {
  const { session } = useAuth();
  const [events, setEvents] = useState<LeadTimelineEvent[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const token = session?.token ?? "";

  const load = useCallback(async () => {
    if (!token || !leadId) return;
    setLoading(true);
    setError(null);
    try {
      const result = await leadsApi.getTimeline(token, leadId);
      setEvents(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load timeline");
    } finally {
      setLoading(false);
    }
  }, [token, leadId]);

  useEffect(() => {
    void load();
  }, [load]);

  return { events, loading, error, refresh: load };
};
