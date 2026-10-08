import type { ReactNode } from 'react';
import { Badge, MiniCard, MiniField, MiniRow, MiniAvatar, MiniWell } from '../atoms';

/**
 * The four Invoices-mini illustrations, in step order:
 *   Create · Check · Issue · Correct
 * Token-only likenesses of the real invoice list and page. Copy lives in src/lib/minis;
 * these illustrations are role-invariant.
 */
export const invoicesArt: readonly [ReactNode, ReactNode, ReactNode, ReactNode] = [
  // 01 Create: from a done order
  <MiniCard key="i1">
    <MiniRow avatar={<MiniAvatar initials="BH" tone="bg-accent-500" />} name="Berger Hausverwaltung GmbH" sub="Order AU-0007" trailing={<Badge variant="confirmed">Done</Badge>} />
  </MiniCard>,

  // 02 Check: service date and terms
  <MiniCard key="i2">
    <MiniField label="Service date">
      <span className="tabular-nums">03/11/2026</span>
    </MiniField>
    <MiniField label="Due in">14 days</MiniField>
  </MiniCard>,

  // 03 Issue: number and lock
  <MiniCard key="i3">
    <MiniRow avatar={<MiniAvatar initials="RE" tone="bg-accent-700" />} name="RE-0012" sub="Issued" trailing={<Badge variant="neutral">Locked</Badge>} />
  </MiniCard>,

  // 04 Correct: cancellation
  <MiniCard key="i4">
    <MiniWell label="Invoice RE-0012" trailing="€476.00" />
    <MiniWell label="Cancellation RE-0013" trailing="-€476.00" />
  </MiniCard>,
] as const;
