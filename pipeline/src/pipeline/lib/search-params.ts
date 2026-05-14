export type SearchParamPatchValue = string | number | null | undefined;

interface ClampedNumberOptions {
  min?: number;
  max?: number;
}

export const readSearchParam = (searchParams: URLSearchParams, key: string, fallback = ""): string => {
  const value = searchParams.get(key);
  return value === null ? fallback : value.trim();
};

export const readClampedNumberSearchParam = (
  searchParams: URLSearchParams,
  key: string,
  fallback: number,
  options?: ClampedNumberOptions
): number => {
  const rawValue = readSearchParam(searchParams, key);
  if (!rawValue) {
    return fallback;
  }

  const parsed = Number(rawValue);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }

  const rounded = Math.round(parsed);
  const min = options?.min ?? Number.NEGATIVE_INFINITY;
  const max = options?.max ?? Number.POSITIVE_INFINITY;
  return Math.min(Math.max(rounded, min), max);
};

export const updateSearchParams = (
  current: URLSearchParams,
  patch: Record<string, SearchParamPatchValue>
): URLSearchParams => {
  const next = new URLSearchParams(current);

  for (const [key, rawValue] of Object.entries(patch)) {
    const normalized = rawValue === null || rawValue === undefined ? "" : String(rawValue).trim();
    if (!normalized) {
      next.delete(key);
    } else {
      next.set(key, normalized);
    }
  }

  return next;
};
