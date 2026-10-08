import type { MiniDef, PageKey } from './types';
import { settingsMini } from './pages/settings';
import { bookingsMini } from './pages/bookings';
import { availabilityMini } from './pages/availability';
import { chatsMini } from './pages/chats';
import { productionsMini } from './pages/productions';
import { artistsMini } from './pages/artists';
import { platformMini } from './pages/platform';
import { hireOrdersMini } from './pages/hireOrders';
import { customersMini } from './pages/customers';
import { propertiesMini } from './pages/properties';
import { catalogMini } from './pages/catalog';
import { quotesMini } from './pages/quotes';
import { invoicesMini } from './pages/invoices';
import { openItemsMini } from './pages/openItems';
import { ordersMini } from './pages/orders';

export * from './types';
export { resolveMiniRole } from './resolveMiniRole';
export type { MiniRoleCtx } from './resolveMiniRole';

/**
 * Every page mini, keyed by PageKey. Adding a page: author ./pages/<page>.ts, add it
 * here, add its illustration in src/components/minis/illustrations, and drop
 * <PageMini page="<page>" /> into the page below its setup rail.
 */
export const MINIS = {
  settings: settingsMini,
  bookings: bookingsMini,
  availability: availabilityMini,
  chats: chatsMini,
  productions: productionsMini,
  artists: artistsMini,
  platform: platformMini,
  hireOrders: hireOrdersMini,
  customers: customersMini,
  properties: propertiesMini,
  catalog: catalogMini,
  quotes: quotesMini,
  orders: ordersMini,
  invoices: invoicesMini,
  openItems: openItemsMini,
} as const satisfies Record<PageKey, MiniDef>;

export type RegisteredPageKey = keyof typeof MINIS;
export const PAGE_KEYS = Object.keys(MINIS) as RegisteredPageKey[];
