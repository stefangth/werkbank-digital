import type { ReactNode } from 'react';
import { Badge, MiniCard, MiniField, MiniRow, MiniAvatar, MiniWell } from '../atoms';

/**
 * The four Open-items-mini illustrations, in step order:
 *   Overview · Payments · Notices · Holds
 * Token-only likenesses of the real open items page. Copy lives in src/lib/minis;
 * these illustrations are role-invariant.
 */
export const openItemsArt: readonly [ReactNode, ReactNode, ReactNode, ReactNode] = [
  // 01 Overview: totals
  <MiniCard key="o1">
    <MiniWell label="Open in total" trailing="€4,760.00" />
    <MiniWell label="Of which overdue" trailing="€1,190.00" />
  </MiniCard>,

  // 02 Payments: partial payment
  <MiniCard key="o2">
    <MiniField label="Payment">
      <span className="tabular-nums">€500.00</span>
    </MiniField>
    <MiniRow avatar={<MiniAvatar initials="RE" tone="bg-accent-700" />} name="RE-0012" sub="Partly paid" trailing={<Badge variant="neutral">€690.00 open</Badge>} />
  </MiniCard>,

  // 03 Notices: due list
  <MiniCard key="o3">
    <MiniRow avatar={<MiniAvatar initials="BH" tone="bg-accent-500" />} name="Berger Hausverwaltung GmbH" sub="Payment reminder" trailing={<Badge variant="waiting">Due</Badge>} />
  </MiniCard>,

  // 04 Holds: reason
  <MiniCard key="o4">
    <MiniField label="Dunning hold">Complaint open</MiniField>
    <MiniField label="Until">
      <span className="tabular-nums">30/11/2026</span>
    </MiniField>
  </MiniCard>,
] as const;
