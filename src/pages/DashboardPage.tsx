import { createElement, type ReactElement } from 'react';
import type { OrgKind } from '@/lib/orgKind';
import { useAuth } from '@/features/auth/AuthContext';
import { ArtistDashboard } from '@/components/dashboard/ArtistDashboard';
import TodayContainer from '@/components/today/TodayPage';
import { useOrgKind } from '@/hooks/useOrgKind';
import { MODULE_UIS } from '@/modules/ui';

/** The dashboard a module contributes for this kind, as an element, or null. */
function moduleDashboardFor(kind: OrgKind): ReactElement | null {
  const Dashboard = MODULE_UIS.map((m) => m.dashboards[kind]).find((d) => d !== undefined);
  return Dashboard ? createElement(Dashboard) : null;
}

/**
 * The /dashboard route. It ALWAYS renders (artists get their dashboard, everyone
 * else gets the Autopilot Today board) and never redirects — clicking "Today"
 * can never bounce the user off it. The one-time Get running landing decision
 * lives at the app entry point instead (see features/auth/HomeLanding.tsx), so
 * it only fires on login or a page open at the app root. A module that owns the active
 * kind may replace the board with its own dashboard (module UI manifest).
 */
export default function DashboardPage() {
  const { hasRole } = useAuth();
  const orgKind = useOrgKind();
  const moduleDashboard = moduleDashboardFor(orgKind);
  if (moduleDashboard) return moduleDashboard;
  const isArtistOnly = hasRole('artist') && !hasRole('producer') && !hasRole('admin');
  return isArtistOnly ? <ArtistDashboard /> : <TodayContainer />;
}
