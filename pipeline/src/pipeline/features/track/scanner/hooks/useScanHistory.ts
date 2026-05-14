// A² Scanner — useScanHistory hook

import { useEffect, useState } from "react";
import { subscribeScanHistory } from "../services/firestoreScans";
import { ScanHistoryRecord } from "../types/scanner.types";

export const useScanHistory = (
  locationFilter: string | null,
  statusFilter: "pending" | "completed"
) => {
  const [records, setRecords] = useState<ScanHistoryRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    setError(null);
    const unsubscribe = subscribeScanHistory(
      locationFilter,
      statusFilter,
      (data) => {
        setRecords(data);
        setLoading(false);
      },
      (err) => {
        setError(err.message || "Failed to load history.");
        setLoading(false);
      }
    );
    return () => unsubscribe();
  }, [locationFilter, statusFilter]);

  return { records, loading, error };
};
