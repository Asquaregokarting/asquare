import { useCallback, useEffect, useState } from "react";
import { leadsApi } from "../../api/leads";
import type { LeadMetricsResult } from "../../api/leads-firestore";
import { useAuth } from "../auth/auth-context";

export const useLeadMetrics = () => {
  const { session } = useAuth();
  const [metrics, setMetrics] = useState<LeadMetricsResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const token = session?.token ?? "";

  const load = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    setError(null);
    try {
      const result = await leadsApi.getMetrics(token);
      setMetrics(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load metrics");
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    void load();
  }, [load]);

  return { metrics, loading, error, refresh: load };
};
