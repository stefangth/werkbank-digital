import type { ReactNode } from 'react';
import { Badge, MiniCard, MiniField, MiniRow, MiniAvatar, MiniWell } from '../atoms';

/**
 * The four Orders-mini illustrations, in step order:
 *   Create · Schedule · Edit · Finish
 * Token-only likenesses of the real order list and page. Copy lives in src/lib/minis;
 * these illustrations are role-invariant.
 */
export const ordersArt: readonly [ReactNode, ReactNode, ReactNode, ReactNode] = [
  // 01 Create: from an accepted quote
  <MiniCard key="o1">
    <MiniRow avatar={<MiniAvatar initials="BH" tone="bg-accent-500" />} name="Berger Hausverwaltung GmbH" sub="Quote A-0042" trailing={<Badge variant="confirmed">Accepted</Badge>} />
  </MiniCard>,

  // 02 Schedule: date and technician
  <MiniCard key="o2">
    <MiniField label="Date">
      <span className="tabular-nums">03/11/2026</span>
    </MiniField>
    <MiniField label="Technician">Anna Berg</MiniField>
  </MiniCard>,

  // 03 Edit: changed against the quote
  <MiniCard key="o3">
    <MiniWell label="Radiator" trailing="€214.20" />
    <MiniWell label="Difference to quote" trailing="+€23.80" />
  </MiniCard>,

  // 04 Finish: status
  <MiniCard key="o4">
    <MiniRow avatar={<MiniAvatar initials="AU" tone="bg-accent-700" />} name="AU-0007" sub="Done" trailing={<Badge variant="neutral">Locked</Badge>} />
  </MiniCard>,
] as const;
