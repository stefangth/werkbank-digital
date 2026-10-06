import { describe, it, expect, vi } from 'vitest';
import { roleLabel, roleDescription, ROLE_LABELS, ROLE_DESCRIPTIONS, ROLES } from './app.config';
import type { AppRole } from './app.config';

vi.mock('@/lib/orgKind', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/orgKind')>();
  const production = actual.ORG_KIND_DEFS.production;
  const fake = {
    ...production,
    kind: 'fakefollow',
    roleLabelsFollowUiLanguage: true,
    vocabulary: {
      en: { ...production.vocabulary.en, roleProducer: 'Office', roleArtist: 'Technician' },
      de: { ...production.vocabulary.de, roleProducer: 'Buero', roleArtist: 'Techniker' },
    },
    roleDescriptions: {
      en: { admin: 'Runs it.', producer: 'Plans it.', artist: 'Does it.' },
      de: { admin: 'Leitet alles.', producer: 'Plant alles.', artist: 'Macht es.' },
    },
  };
  const defs = { ...actual.ORG_KIND_DEFS, fakefollow: fake };
  return {
    ...actual,
    ORG_KIND_DEFS: defs,
    // The module's own helper closes over its private table, so re-point it at the injected one.
    roleLabelsFollowUiLanguage: (kind: string) => (defs as Record<string, typeof fake>)[kind].roleLabelsFollowUiLanguage,
    VOCABULARY: { ...actual.VOCABULARY, fakefollow: fake.vocabulary },
  };
});

const ALL_ROLES = Object.values(ROLES) as AppRole[];

describe('roleLabel', () => {
  it('defaults to the production table', () => {
    expect(roleLabel('producer')).toBe(ROLE_LABELS.producer);
    expect(roleLabel('admin')).toBe('Admin');
    expect(roleLabel('unknown')).toBe('unknown');
  });
  it('reads the producer label from the vocabulary for staffing', () => {
    expect(roleLabel('producer', 'staffing')).toBe('Booking team');
    expect(roleLabel('artist', 'staffing')).toBe('Artist');
  });
  it('keeps staffing English in German because it does not follow the UI language', () => {
    expect(roleLabel('producer', 'staffing', 'de')).toBe('Booking team');
    expect(roleLabel('producer', 'production', 'de')).toBe('Production Team');
    expect(roleLabel('artist', 'production', 'de')).toBe('Artist');
    expect(roleLabel('admin', 'staffing', 'de')).toBe('Admin');
  });
  it('follows the UI language for a kind that opts in', () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- injected fake kind is not in the OrgKind union
    const kind = 'fakefollow' as any;
    expect(roleLabel('producer', kind, 'de')).toBe('Buero');
    expect(roleLabel('artist', kind, 'de')).toBe('Techniker');
    expect(roleLabel('artist', kind, 'en')).toBe('Technician');
    expect(roleLabel('admin', kind, 'de')).toBe('Admin');
  });
});

describe('roleDescription per language', () => {
  it('ignores the language for production and staffing', () => {
    for (const role of ALL_ROLES) {
      expect(roleDescription(role, 'production', 'de')).toBe(ROLE_DESCRIPTIONS[role]);
      expect(roleDescription(role, 'staffing', 'de')).toBe(roleDescription(role, 'staffing'));
    }
  });
  it('uses the kind descriptions in the UI language when the kind opts in', () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- injected fake kind is not in the OrgKind union
    const kind = 'fakefollow' as any;
    expect(roleDescription('producer', kind, 'de')).toBe('Plant alles.');
    expect(roleDescription('artist', kind, 'en')).toBe('Does it.');
    expect(roleDescription('unknown', kind, 'de')).toBe('');
  });
});
