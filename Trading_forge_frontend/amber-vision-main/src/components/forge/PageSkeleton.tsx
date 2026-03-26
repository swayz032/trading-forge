import { Skeleton } from "@/components/ui/skeleton";

export function CardGridSkeleton({ count = 4 }: { count?: number }) {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="forge-card p-5 space-y-3">
          <Skeleton className="h-3 w-20 bg-surface-2" />
          <Skeleton className="h-6 w-28 bg-surface-2" />
          <Skeleton className="h-3 w-16 bg-surface-2" />
        </div>
      ))}
    </div>
  );
}

export function TableSkeleton({ rows = 5, cols = 6 }: { rows?: number; cols?: number }) {
  return (
    <div className="forge-card p-5 space-y-3">
      <div className="flex gap-4 mb-4">
        {Array.from({ length: cols }).map((_, i) => (
          <Skeleton key={i} className="h-3 flex-1 bg-surface-2" />
        ))}
      </div>
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="flex gap-4 py-2">
          {Array.from({ length: cols }).map((_, j) => (
            <Skeleton key={j} className="h-4 flex-1 bg-surface-2" />
          ))}
        </div>
      ))}
    </div>
  );
}

export function ChartSkeleton({ height = 320 }: { height?: number }) {
  return (
    <div className="forge-card p-5">
      <div className="flex items-center justify-between mb-4">
        <Skeleton className="h-4 w-32 bg-surface-2" />
        <Skeleton className="h-3 w-20 bg-surface-2" />
      </div>
      <Skeleton className="w-full bg-surface-2 rounded-lg" style={{ height }} />
    </div>
  );
}

export function MetricCardSkeleton() {
  return (
    <div className="forge-card px-4 py-3 space-y-2">
      <Skeleton className="h-2.5 w-16 bg-surface-2" />
      <Skeleton className="h-5 w-24 bg-surface-2" />
    </div>
  );
}

export function PageHeaderSkeleton() {
  return (
    <div className="space-y-2">
      <Skeleton className="h-7 w-48 bg-surface-2" />
      <Skeleton className="h-4 w-64 bg-surface-2" />
    </div>
  );
}

export function StrategyCardSkeleton() {
  return (
    <div className="forge-card p-5 space-y-4">
      <div className="flex items-start justify-between">
        <div className="space-y-2 flex-1">
          <div className="flex gap-2">
            <Skeleton className="h-4 w-8 bg-surface-2" />
            <Skeleton className="h-4 w-16 bg-surface-2" />
          </div>
          <Skeleton className="h-4 w-40 bg-surface-2" />
          <Skeleton className="h-3 w-56 bg-surface-2" />
        </div>
        <Skeleton className="h-16 w-16 rounded-full bg-surface-2" />
      </div>
      <div className="grid grid-cols-4 gap-3 pt-3 border-t border-border/20">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="space-y-1">
            <Skeleton className="h-2.5 w-8 bg-surface-2" />
            <Skeleton className="h-3.5 w-12 bg-surface-2" />
          </div>
        ))}
      </div>
    </div>
  );
}
