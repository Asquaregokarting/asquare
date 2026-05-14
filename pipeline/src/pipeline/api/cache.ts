/**
 * Minimal TTL-based in-memory cache for API responses.
 * Used to avoid redundant Firestore reads within a short window.
 */
export const createTtlCache = <T>(ttlMs: number) => {
  let cached: { data: T; expiresAt: number } | null = null;
  return {
    get: (): T | null => {
      if (cached && Date.now() < cached.expiresAt) return cached.data;
      cached = null;
      return null;
    },
    set: (data: T): void => {
      cached = { data, expiresAt: Date.now() + ttlMs };
    },
    invalidate: (): void => {
      cached = null;
    }
  };
};
