// Plugin-local route paths: one source for the nav item, the dashboard CTA and the route.
export const TECHNICIANS_PATH = "/technicians";
export const CATALOG_PATH = "/catalog";
export const CUSTOMERS_PATH = "/customers";
export const customerPath = (id: string) => `${CUSTOMERS_PATH}/${id}`;
