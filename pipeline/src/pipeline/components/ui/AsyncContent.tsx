import { ReactNode } from "react";
import { EmptyState } from "./EmptyState";
import { Skeleton } from "./Skeleton";

interface AsyncContentProps {
  loading: boolean;
  error?: string | null;
  isEmpty: boolean;
  emptyTitle: string;
  emptyDescription: string;
  loadingTitle?: string;
  loadingDescription?: string;
  onRetry?: () => void;
  children: ReactNode;
}

export const AsyncContent = ({
  loading,
  error,
  isEmpty,
  emptyTitle,
  emptyDescription,
  loadingTitle = "Loading content",
  loadingDescription = "Fetching the latest data for this section.",
  onRetry,
  children
}: AsyncContentProps) => {
  if (loading) {
    return (
      <div className="space-y-3">
        <div className="rounded-xl border border-border/60 bg-surface/70 px-5 py-4">
          <p className="text-sm font-semibold text-text">{loadingTitle}</p>
          <p className="mt-1 text-sm text-muted">{loadingDescription}</p>
        </div>
        <Skeleton className="h-16 w-full" />
        <Skeleton className="h-16 w-full" />
        <Skeleton className="h-16 w-full" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="space-y-3">
        <EmptyState title="Unable to load this section" description={error} />
        {onRetry ? (
          <div className="flex justify-center">
            <button type="button" onClick={onRetry} className="ui-btn ui-btn-primary">
              Retry
            </button>
          </div>
        ) : null}
      </div>
    );
  }

  if (isEmpty) {
    return <EmptyState title={emptyTitle} description={emptyDescription} />;
  }

  return <>{children}</>;
};
