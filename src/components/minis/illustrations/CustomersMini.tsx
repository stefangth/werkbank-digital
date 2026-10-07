import type { ReactNode } from 'react';
import { Badge, MiniCard, MiniField, MiniRow, MiniAvatar, MiniWell } from '../atoms';

/**
 * The four Customers-mini illustrations, in step order:
 *   Type · Numbers · Properties · Contacts
 * Token-only likenesses of the real customer list and form. Copy lives in src/lib/minis;
 * these illustrations are role-invariant.
 */
export const customersArt: readonly [ReactNode, ReactNode, ReactNode, ReactNode] = [
  // 01 Type: property manager or private
  <MiniCard key="c1">
    <MiniRow avatar={<MiniAvatar initials="BH" tone="bg-accent-500" />} name="Berger Hausverwaltung GmbH" trailing={<Badge variant="accent">Property manager</Badge>} />
    <MiniRow avatar={<MiniAvatar initials="JS" tone="bg-accent-700" />} name="Schulz, Jana" trailing={<Badge variant="neutral">Private</Badge>} />
  </MiniCard>,

  // 02 Numbers: assigned automatically
  <MiniCard key="c2">
    <MiniField label="Customer no.">
      <span className="tabular-nums">K-10001</span>
    </MiniField>
    <MiniField label="Next number">
      <span className="tabular-nums">K-10002</span>
    </MiniField>
  </MiniCard>,

  // 03 Properties: count per customer
  <MiniCard key="c3">
    <MiniWell label="Berger Hausverwaltung GmbH" trailing="3 properties" />
    <MiniWell label="Schulz, Jana" trailing="1 property" />
  </MiniCard>,

  // 04 Contacts: people attached to a customer
  <MiniCard key="c4">
    <MiniRow avatar={<MiniAvatar initials="PK" tone="bg-accent-500" />} name="Petra Krause" sub="Property management" trailing={<Badge variant="confirmed">Primary</Badge>} />
    <MiniRow avatar={<MiniAvatar initials="TB" tone="bg-accent-700" />} name="Tom Becker" sub="Accounting" />
  </MiniCard>,
] as const;
