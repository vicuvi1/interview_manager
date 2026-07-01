import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

// These render inside the app shell (the layout provides the sidebar + topbar),
// so they only fill the page content area.

function CardSkeleton({ rows = 3 }: { rows?: number }) {
  return (
    <Card className="p-5 sm:p-6">
      <Skeleton className="h-5 w-40" />
      <div className="mt-4 space-y-3">
        {Array.from({ length: rows }).map((_, i) => (
          <Skeleton key={i} className="h-4 w-full" />
        ))}
      </div>
    </Card>
  );
}

function StatRowSkeleton() {
  return (
    <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
      {Array.from({ length: 4 }).map((_, i) => (
        <Card key={i} className="flex items-center gap-3 p-4">
          <Skeleton className="h-10 w-10 rounded-lg" />
          <div className="space-y-2">
            <Skeleton className="h-5 w-14" />
            <Skeleton className="h-3 w-16" />
          </div>
        </Card>
      ))}
    </div>
  );
}

export function DashboardSkeleton() {
  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <Skeleton className="h-14 w-14 rounded-full" />
        <div className="space-y-2">
          <Skeleton className="h-6 w-48" />
          <Skeleton className="h-4 w-32" />
        </div>
      </div>
      <div className="grid gap-5 lg:grid-cols-2">
        <CardSkeleton rows={5} />
        <CardSkeleton rows={4} />
      </div>
      <CardSkeleton rows={4} />
    </div>
  );
}

export function AdminSkeleton() {
  return (
    <div className="space-y-5">
      <StatRowSkeleton />
      <StatRowSkeleton />
      <CardSkeleton rows={6} />
    </div>
  );
}

export function CalendarSkeleton() {
  return (
    <div className="grid gap-5 lg:grid-cols-5">
      <div className="lg:col-span-3">
        <Card className="p-5 sm:p-6">
          <Skeleton className="h-5 w-32" />
          <div className="mt-4 grid grid-cols-7 gap-1">
            {Array.from({ length: 42 }).map((_, i) => (
              <Skeleton key={i} className="aspect-square w-full rounded-lg" />
            ))}
          </div>
        </Card>
      </div>
      <div className="lg:col-span-2">
        <CardSkeleton rows={5} />
      </div>
    </div>
  );
}
