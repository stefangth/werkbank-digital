import { describe, it, expect } from 'vitest';
import { selectItems, groupByStage, countParams, findItem } from './filter';
import { HELP_ITEMS } from './items';
import { CORE_ORG_KINDS } from '@/lib/orgKind';

describe('help filter', () => {
  it('filters by role', () => {
    expect(selectItems('artist', 'all', '').every((i) => i.role === 'artist')).toBe(true);
  });

  it('"new" filter keeps only new items', () => {
    expect(selectItems('admin', 'new', '').every((i) => i.status === 'new')).toBe(true);
  });

  // The searched noun is a vocabulary placeholder in the copy ({{hireOrder}}), so search
  // has to match the DISPLAYED text: under the production kind {{hireOrder}} renders
  // "contract" (EN) / "Engagementvertrag" (DE), and both must find the same items.
  it('search matches the displayed English product noun', () => {
    expect(selectItems('producer', 'all', 'contract', 'production').length).toBeGreaterThan(0);
  });

  it('search matches the displayed German product noun (regardless of the reader\'s language)', () => {
    expect(selectItems('producer', 'all', 'engagementvertrag', 'production').length).toBeGreaterThan(0);
  });

  // ...and the staffing kind renders the other vocabulary, so its displayed noun matches too.
  it('search matches the staffing-kind displayed noun', () => {
    expect(selectItems('producer', 'all', 'work order', 'staffing').length).toBeGreaterThan(0);
  });

  it('groupByStage drops empty stages and preserves order', () => {
    const groups = groupByStage(selectItems('admin', 'all', ''));
    expect(groups.every((g) => g.items.length > 0)).toBe(true);
    expect(groups.map((g) => g.stage)).toEqual([...groups.map((g) => g.stage)].sort((a, b) => a - b));
  });

  it('count params: unfiltered reports totals, filtered reports matched/total', () => {
    const all = countParams('admin', 'all', '', 'production');
    expect(all.filtered).toBe(false);
    expect(all.total).toBe(HELP_ITEMS.filter((i) => i.role === 'admin' && !i.kinds).length);

    const filtered = countParams('admin', 'new', '', 'production');
    expect(filtered.filtered).toBe(true);
    expect(filtered.matched).toBeLessThanOrEqual(filtered.total);
  });
});

describe('help filter by org kind', () => {
  it('handwerk sees only items flagged for handwerk', () => {
    for (const role of ['admin', 'producer', 'artist'] as const) {
      const items = selectItems(role, 'all', '', 'handwerk');
      expect(items.every((i) => i.kinds?.includes('handwerk'))).toBe(true);
    }
    expect(selectItems('admin', 'all', '', 'handwerk').length).toBeGreaterThan(0);
    expect(selectItems('producer', 'all', '', 'handwerk').length).toBeGreaterThan(0);
    expect(selectItems('artist', 'all', '', 'handwerk')).toEqual([]);
  });

  it('production and staffing never see handwerk items', () => {
    for (const kind of CORE_ORG_KINDS) {
      for (const role of ['admin', 'producer', 'artist'] as const) {
        expect(selectItems(role, 'all', '', kind).some((i) => i.kinds)).toBe(false);
      }
    }
  });

  it('the production result is unchanged: every unflagged item, in order', () => {
    const expected = HELP_ITEMS.filter((i) => !i.kinds && i.role === 'producer').map((i) => i.id);
    expect(selectItems('producer', 'all', '', 'production').map((i) => i.id)).toEqual(expected);
    expect(expected.length).toBeGreaterThan(20);
  });

  it('search stays inside the kind', () => {
    expect(selectItems('admin', 'all', 'Nummernkreis', 'handwerk').length).toBeGreaterThan(0);
    expect(selectItems('admin', 'all', 'Nummernkreis', 'production')).toEqual([]);
  });

  it('count params are per kind', () => {
    const hw = countParams('admin', 'all', '', 'handwerk');
    const prod = countParams('admin', 'all', '', 'production');
    expect(hw.total).toBe(HELP_ITEMS.filter((i) => i.role === 'admin' && i.kinds?.includes('handwerk')).length);
    expect(hw.total).toBeGreaterThan(0);
    expect(prod.total).toBe(HELP_ITEMS.filter((i) => i.role === 'admin' && !i.kinds).length);
    expect(hw.newCount).toBeLessThanOrEqual(hw.total);
  });
});

describe('findItem', () => {
  it('resolves a known id', () => {
    expect(findItem('A3.11')?.role).toBe('admin');
  });

  it('returns null for an unknown id rather than throwing', () => {
    // A stale `/help?item=` link is a normal outcome, not an error.
    expect(findItem('NOPE')).toBeNull();
  });
});
