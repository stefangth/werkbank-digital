import type { ReactNode } from 'react';
import { Badge, MiniCard, MiniField, MiniRow, MiniAvatar, MiniWell } from '../atoms';

/**
 * The four Properties-mini illustrations, in step order:
 *   Property · Invoice recipient · Contacts on site · Archive
 * Token-only likenesses of the real property list and detail page. Copy lives in
 * src/lib/minis; these illustrations are role-invariant.
 */
export const propertiesArt: readonly [ReactNode, ReactNode, ReactNode, ReactNode] = [
  // 01 Property: name, address, owning customer
  <MiniCard key="p1">
    <MiniField label="Property">Lindenhof 12</MiniField>
    <MiniField label="Address">Gartenweg 4, 04109 Leipzig</MiniField>
    <MiniField label="Customer">Berger Hausverwaltung</MiniField>
  </MiniCard>,

  // 02 Invoice recipient: differs from the customer
  <MiniCard key="p2">
    <div className="text-eyebrow text-muted-foreground">Invoice goes to</div>
    <div className="text-caption font-medium text-foreground">Eigentümergemeinschaft Lindenhof 12</div>
    <div className="text-eyebrow text-muted-foreground">represented by Berger Hausverwaltung</div>
  </MiniCard>,

  // 03 Contacts on site
  <MiniCard key="p3">
    <MiniRow avatar={<MiniAvatar initials="HW" tone="bg-accent-500" />} name="Horst Wagner" sub="Caretaker" trailing={<Badge variant="confirmed">Primary</Badge>} />
    <MiniRow avatar={<MiniAvatar initials="SL" tone="bg-accent-700" />} name="Sabine Lange" sub="Tenant, 2nd floor" />
  </MiniCard>,

  // 04 Archive: kept, hidden from the list
  <MiniCard key="p4">
    <MiniRow name="Lindenhof 12" sub="Gartenweg 4, Leipzig" trailing={<Badge variant="neutral">Archived</Badge>} />
    <MiniWell label="Show archived" trailing="On" />
  </MiniCard>,
] as const;
