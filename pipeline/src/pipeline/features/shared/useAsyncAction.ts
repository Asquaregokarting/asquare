import { useCallback } from "react";

interface AsyncActionOptions<ResultT> {
  successMessage?: string;
  fallbackError: string;
  onSuccess?: (result: ResultT) => Promise<void> | void;
}

interface UseAsyncActionConfig {
  setBusy: (value: boolean) => void;
  setError: (value: string | null) => void;
  setSuccess: (value: string | null) => void;
}

export const resolveAsyncErrorMessage = (error: unknown, fallback: string): string => {
  if (error instanceof Error && error.message.trim()) {
    return error.message;
  }
  return fallback;
};

export const useAsyncAction = ({ setBusy, setError, setSuccess }: UseAsyncActionConfig) =>
  useCallback(
    async <ResultT,>(action: () => Promise<ResultT>, options: AsyncActionOptions<ResultT>): Promise<ResultT | undefined> => {
      setBusy(true);
      setError(null);
      setSuccess(null);

      try {
        const result = await action();
        if (options.successMessage) {
          setSuccess(options.successMessage);
        }
        if (options.onSuccess) {
          await options.onSuccess(result);
        }
        return result;
      } catch (error) {
        setError(resolveAsyncErrorMessage(error, options.fallbackError));
        return undefined;
      } finally {
        setBusy(false);
      }
    },
    [setBusy, setError, setSuccess]
  );
