import { useCallback, useMemo } from "react";
import { useSearchParams } from "react-router-dom";
import type { LeadScoreLabel, LeadSource, LeadStatus } from "../../api/types";

export interface LeadFilters {
  status?: LeadStatus;
  branchId?: string;
  assignedTo?: string;
  scoreLabel?: LeadScoreLabel;
  source?: LeadSource;
  dateFrom?: string;
  dateTo?: string;
  search?: string;
}

const read = (params: URLSearchParams, key: string): string | undefined => {
  const val = params.get(key)?.trim();
  return val || undefined;
};

export const useLeadFilters = () => {
  const [searchParams, setSearchParams] = useSearchParams();

  const filters: LeadFilters = useMemo(
    () => ({
      status: read(searchParams, "status") as LeadStatus | undefined,
      branchId: read(searchParams, "branchId"),
      assignedTo: read(searchParams, "assignedTo"),
      scoreLabel: read(searchParams, "scoreLabel") as LeadScoreLabel | undefined,
      source: read(searchParams, "source") as LeadSource | undefined,
      dateFrom: read(searchParams, "dateFrom"),
      dateTo: read(searchParams, "dateTo"),
      search: read(searchParams, "search"),
    }),
    [searchParams]
  );

  const setFilter = useCallback(
    (key: keyof LeadFilters, value: string | undefined) => {
      const next = new URLSearchParams(searchParams);
      if (value) {
        next.set(key, value);
      } else {
        next.delete(key);
      }
      setSearchParams(next, { replace: true });
    },
    [searchParams, setSearchParams]
  );

  const resetFilters = useCallback(() => {
    setSearchParams({}, { replace: true });
  }, [setSearchParams]);

  return { filters, setFilter, resetFilters };
};
