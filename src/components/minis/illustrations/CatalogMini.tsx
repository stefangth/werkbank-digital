import type { ReactNode } from 'react';
import { Badge, MiniCard, MiniField, MiniRow, MiniWell } from '../atoms';

/**
 * The four Catalog-mini illustrations, in step order:
 *   Unit · Labour and material · VAT · Into quotes
 * Token-only likenesses of the real catalog form and list. Copy lives in src/lib/minis;
 * these illustrations are role-invariant.
 */
export const catalogArt: readonly [ReactNode, ReactNode, ReactNode, ReactNode] = [
  // 01 Unit
  <MiniCard key="k1">
    <MiniField label="Item">Heating check</MiniField>
    <MiniField label="Unit">
      <Badge variant="accent">Hours</Badge>
    </MiniField>
  </MiniCard>,

  // 02 Labour and material
  <MiniCard key="k2">
    <MiniField label="Labour">
      <span className="tabular-nums">58,00 €</span>
    </MiniField>
    <MiniField label="Material">
      <span className="tabular-nums">12,50 €</span>
    </MiniField>
    <MiniWell label="Net total" trailing="70,50 €" />
  </MiniCard>,

  // 03 VAT
  <MiniCard key="k3">
    <MiniField label="VAT">
      <Badge variant="neutral">19 %</Badge>
    </MiniField>
    <div className="text-eyebrow text-muted-foreground">Net total stays labour plus material</div>
  </MiniCard>,

  // 04 Into quotes: copied, not linked
  <MiniCard key="k4">
    <MiniRow name="Heating check" sub="Catalog item" />
    <MiniWell label="Quote line" trailing="70,50 €" />
    <div className="text-eyebrow text-muted-foreground">Price is copied into the quote</div>
  </MiniCard>,
] as const;
