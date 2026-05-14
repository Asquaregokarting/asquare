import { useQuery } from "@tanstack/react-query";
import type { Firestore } from "firebase/firestore";
import type { BranchLocation } from "../types";
import { fetchLocationsFromFirestore, getAllLocations } from "./locations";

export function useLocations(db: Firestore) {
  const query = useQuery<BranchLocation[]>({
    queryKey: ["locations"],
    queryFn: () => fetchLocationsFromFirestore(db),
    staleTime: 5 * 60 * 1000,
    gcTime: 30 * 60 * 1000,
  });

  const locations = query.data ?? getAllLocations();

  return {
    locations,
    enabledLocations: locations.filter((l) => l.enabled),
    isLoading: query.isLoading,
    error: query.error,
    refetch: query.refetch,
  };
}
