import { Suspense, type ComponentType } from "react";
import { Skeleton } from "@/components/ui/skeleton";

/** Renders a page that may be lazily loaded (React.lazy), with the app's page skeleton as
 *  the fallback while its chunk loads. Module pages and dashboards arrive this way so they
 *  stay out of the main bundle. */
export function SuspendedPage({ Page }: { Page: ComponentType }) {
  return (
    <Suspense fallback={<Skeleton className="h-[80vh] w-full" />}>
      <Page />
    </Suspense>
  );
}
