// Plugin-local route paths: one source for the nav item, the dashboard CTA and the route.
export const TECHNICIANS_PATH = "/technicians";
export const CATALOG_PATH = "/catalog";
export const CUSTOMERS_PATH = "/customers";
export const customerPath = (id: string) => `${CUSTOMERS_PATH}/${id}`;
export const PROPERTIES_PATH = "/properties";
export const propertyPath = (id: string) => `${PROPERTIES_PATH}/${id}`;
export const QUOTES_PATH = "/quotes";
export const quotePath = (id: string) => `${QUOTES_PATH}/${id}`;
export const ORDERS_PATH = "/orders";
export const orderPath = (id: string) => `${ORDERS_PATH}/${id}`;
export const PUBLIC_QUOTE_PATH = "/quote/:token";
