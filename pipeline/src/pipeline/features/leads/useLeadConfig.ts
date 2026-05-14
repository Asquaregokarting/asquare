import { useCallback, useEffect, useState } from "react";
import { leadsApi } from "../../api/leads";
import type { LeadAutomationConfig } from "../../api/types";
import { useAuth } from "../auth/auth-context";
import { useAsyncAction } from "../shared/useAsyncAction";

export const useLeadConfig = () => {
  const { session } = useAuth();
  const [config, setConfig] = useState<LeadAutomationConfig | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [success, setSuccess] = useState<string | null>(null);

  const token = session?.token ?? "";
  const action = useAsyncAction({ setBusy, setError, setSuccess });

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await leadsApi.getConfig();
      setConfig(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load config");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const updateConfig = useCallback(
    (patch: Partial<LeadAutomationConfig>) =>
      action(() => leadsApi.updateConfig(token, patch), {
        successMessage: "Config updated",
        fallbackError: "Failed to update config",
        onSuccess: (updated) => setConfig(updated),
      }),
    [token, action]
  );

  return { config, loading, error, busy, success, setSuccess, updateConfig };
};
