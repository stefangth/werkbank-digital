import AppLayout from "@/components/layout/AppLayout";
import { SuspendedPage } from "@/components/layout/SuspendedPage";
import { ProtectedRoute } from "@/features/auth/ProtectedRoute";
import type { ModuleRoute } from "./ui";

/** The element of one module route: guarded, and inside the app shell unless the route is
 *  "bare" (the page then brings its own chrome). */
export function ModuleRouteElement({ route }: { route: ModuleRoute }) {
  const page = <SuspendedPage Page={route.Page} />;
  return (
    <ProtectedRoute requiredRoles={route.requiredRoles}>
      {route.shell === "bare" ? page : <AppLayout>{page}</AppLayout>}
    </ProtectedRoute>
  );
}
