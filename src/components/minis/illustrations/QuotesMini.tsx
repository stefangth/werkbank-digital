import type { ReactNode } from 'react';
import { Badge, MiniCard, MiniField, MiniRow, MiniAvatar, MiniWell } from '../atoms';

/**
 * The four Quotes-mini illustrations, in step order:
 *   Draft · Number · Sent · Answer
 * Token-only likenesses of the real quote list and page. Copy lives in src/lib/minis;
 * these illustrations are role-invariant.
 */
export const quotesArt: readonly [ReactNode, ReactNode, ReactNode, ReactNode] = [
  // 01 Draft: items and totals
  <MiniCard key="q1">
    <MiniWell label="Heating inspection" trailing="€180.00" />
    <MiniWell label="Gross total" trailing="€214.20" />
  </MiniCard>,

  // 02 Number: assigned, versions keep it
  <MiniCard key="q2">
    <MiniField label="Quote no.">
      <span className="tabular-nums">A-0042</span>
    </MiniField>
    <MiniField label="Revision">
      <span className="tabular-nums">A-0042-2</span>
    </MiniField>
  </MiniCard>,

  // 03 Sent: locked
  <MiniCard key="q3">
    <MiniRow avatar={<MiniAvatar initials="BH" tone="bg-accent-500" />} name="Berger Hausverwaltung GmbH" trailing={<Badge variant="neutral">Sent</Badge>} />
  </MiniCard>,

  // 04 Answer: accepted
  <MiniCard key="q4">
    <MiniRow avatar={<MiniAvatar initials="JS" tone="bg-accent-700" />} name="Schulz, Jana" sub="Signed" trailing={<Badge variant="confirmed">Accepted</Badge>} />
  </MiniCard>,
] as const;
