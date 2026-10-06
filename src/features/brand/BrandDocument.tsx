import { useEffect } from "react";
import { useBrand } from "@/hooks/useBrand";
import { DEFAULT_BRAND_KEY } from "@/lib/brand";

/**
 * Applies the brand to the document chrome: tab title and favicon. Renders nothing. For
 * showflow it leaves the index.html defaults alone, so existing behaviour is unchanged.
 */
export default function BrandDocument() {
  const brand = useBrand();
  useEffect(() => {
    if (brand.key === DEFAULT_BRAND_KEY) return;
    const previousTitle = document.title;
    const link = document.querySelector<HTMLLinkElement>('link[rel="icon"]');
    const previousHref = link?.getAttribute("href") ?? null;
    document.title = brand.name;
    link?.setAttribute("href", brand.faviconPath);
    return () => {
      document.title = previousTitle;
      if (link && previousHref !== null) link.setAttribute("href", previousHref);
    };
  }, [brand]);
  return null;
}
