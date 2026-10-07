// Werkbank plugin UI: nav item, the technicians route and the handwerk dashboard,
// registered in src/modules/ui.ts. The pages load lazily so they ship in their own chunk
// instead of the main bundle every Showflow user downloads; the core renders module
// pages and dashboards inside Suspense (SuspendedPage).
import { lazy } from "react";
import { Building2, ClipboardList, FileText, HardHat, Home, Wrench } from "lucide-react";
import type { ModuleUi } from "@/modules/ui";
import { CATALOG_PATH, CUSTOMERS_PATH, ORDERS_PATH, PROPERTIES_PATH, PUBLIC_QUOTE_PATH, QUOTES_PATH, TECHNICIANS_PATH } from "./paths";

export const loadTechniciansPage = () =>
  import("./pages/TechniciansPage").then((m) => ({ default: m.TechniciansPage }));
export const loadWerkbankDashboard = () =>
  import("./components/WerkbankDashboard").then((m) => ({ default: m.WerkbankDashboard }));

export const loadCatalogPage = () =>
  import("./pages/CatalogPage").then((m) => ({ default: m.CatalogPage }));

export const loadCustomersPage = () =>
  import("./pages/CustomersPage").then((m) => ({ default: m.CustomersPage }));

export const loadCustomerDetailPage = () =>
  import("./pages/CustomerDetailPage").then((m) => ({ default: m.CustomerDetailPage }));

export const loadPropertiesPage = () =>
  import("./pages/PropertiesPage").then((m) => ({ default: m.PropertiesPage }));

export const loadPropertyDetailPage = () =>
  import("./pages/PropertyDetailPage").then((m) => ({ default: m.PropertyDetailPage }));

export const loadQuotesPage = () =>
  import("./pages/QuotesPage").then((m) => ({ default: m.QuotesPage }));

export const loadQuotePage = () =>
  import("./pages/QuotePage").then((m) => ({ default: m.QuotePage }));

export const loadOrdersPage = () =>
  import("./pages/OrdersPage").then((m) => ({ default: m.OrdersPage }));

export const loadOrderPage = () =>
  import("./pages/OrderPage").then((m) => ({ default: m.OrderPage }));

export const loadQuotePublicPage = () =>
  import("./pages/QuotePublicPage").then((m) => ({ default: m.QuotePublicPage }));

const QuotePublicPage = lazy(loadQuotePublicPage);
const OrdersPage = lazy(loadOrdersPage);
const OrderPage = lazy(loadOrderPage);
const QuotesPage = lazy(loadQuotesPage);
const QuotePage = lazy(loadQuotePage);
const PropertiesPage = lazy(loadPropertiesPage);
const PropertyDetailPage = lazy(loadPropertyDetailPage);
const CustomersPage = lazy(loadCustomersPage);
const CustomerDetailPage = lazy(loadCustomerDetailPage);
const CatalogPage = lazy(loadCatalogPage);
const TechniciansPage = lazy(loadTechniciansPage);
const WerkbankDashboard = lazy(loadWerkbankDashboard);

export const werkbankUi: ModuleUi = {
  navItems: [
    {
      to: CUSTOMERS_PATH,
      icon: Building2,
      label: "Customers",
      labelKey: "werkbank:nav.customers",
      section: "workspace",
      roles: ["admin", "producer"],
      kinds: ["handwerk"],
    },
    {
      to: PROPERTIES_PATH,
      icon: Home,
      label: "Properties",
      labelKey: "werkbank:nav.properties",
      section: "workspace",
      roles: ["admin", "producer"],
      kinds: ["handwerk"],
    },
    {
      to: QUOTES_PATH,
      icon: FileText,
      label: "Quotes",
      labelKey: "werkbank:nav.quotes",
      section: "workspace",
      roles: ["admin", "producer"],
      kinds: ["handwerk"],
    },
    {
      to: ORDERS_PATH,
      icon: ClipboardList,
      label: "Orders",
      labelKey: "werkbank:nav.orders",
      section: "workspace",
      roles: ["admin", "producer"],
      kinds: ["handwerk"],
    },
    {
      to: CATALOG_PATH,
      icon: Wrench,
      label: "Services",
      labelKey: "werkbank:nav.catalog",
      section: "workspace",
      roles: ["admin", "producer"],
      kinds: ["handwerk"],
    },
    {
      to: TECHNICIANS_PATH,
      icon: HardHat,
      label: "Technicians",
      labelKey: "werkbank:nav.technicians",
      section: "workspace",
      roles: ["admin", "producer"],
      kinds: ["handwerk"],
    },
  ],
  routes: [
    {
      path: CUSTOMERS_PATH,
      kinds: ["handwerk"],
      requiredRoles: ["admin", "producer"],
      Page: CustomersPage,
    },
    {
      path: `${CUSTOMERS_PATH}/:id`,
      kinds: ["handwerk"],
      requiredRoles: ["admin", "producer"],
      Page: CustomerDetailPage,
    },
    {
      path: PROPERTIES_PATH,
      kinds: ["handwerk"],
      requiredRoles: ["admin", "producer"],
      Page: PropertiesPage,
    },
    {
      path: `${PROPERTIES_PATH}/:id`,
      kinds: ["handwerk"],
      requiredRoles: ["admin", "producer"],
      Page: PropertyDetailPage,
    },
    {
      path: QUOTES_PATH,
      kinds: ["handwerk"],
      requiredRoles: ["admin", "producer"],
      Page: QuotesPage,
    },
    {
      path: `${QUOTES_PATH}/:id`,
      kinds: ["handwerk"],
      requiredRoles: ["admin", "producer"],
      Page: QuotePage,
    },
    {
      path: ORDERS_PATH,
      kinds: ["handwerk"],
      requiredRoles: ["admin", "producer"],
      Page: OrdersPage,
    },
    {
      path: `${ORDERS_PATH}/:id`,
      kinds: ["handwerk"],
      requiredRoles: ["admin", "producer"],
      Page: OrderPage,
    },
    {
      path: CATALOG_PATH,
      kinds: ["handwerk"],
      requiredRoles: ["admin", "producer"],
      Page: CatalogPage,
    },
    {
      path: TECHNICIANS_PATH,
      kinds: ["handwerk"],
      requiredRoles: ["admin", "producer"],
      Page: TechniciansPage,
    },
  ],
  publicRoutes: [{ path: PUBLIC_QUOTE_PATH, Page: QuotePublicPage }],
  dashboards: { handwerk: WerkbankDashboard },
};
