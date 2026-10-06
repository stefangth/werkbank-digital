import { useBrand } from "@/hooks/useBrand";
import { BrandWordmark } from "@/components/brand/BrandWordmark";
import { StageMark } from "@/components/brand/StageMark";
import { cn } from "@/lib/utils";

interface BrandMarkProps {
  /** "mark" = outline mark in the sidebar and topbar; "tile" = app-icon tile on auth screens. */
  variant: "mark" | "tile";
  size: number;
  className?: string;
}

/** The current brand's mark. Showflow (markSvgPath null) renders the built-in StageMark. */
export function BrandMark({ variant, size, className }: BrandMarkProps) {
  const brand = useBrand();
  if (brand.markSvgPath === null) {
    return <StageMark variant={variant} size={size} className={className} />;
  }
  return <img src={brand.markSvgPath} alt="" width={size} height={size} className={className} aria-hidden="true" />;
}

/** The current brand's name: the two-tone wordmark with version pill for showflow, plain text otherwise. */
export function BrandName({ className }: { className?: string }) {
  const brand = useBrand();
  if (brand.key === "showflow") return <BrandWordmark className={className} />;
  return (
    <span className={cn("font-display text-body font-semibold tracking-[-0.02em] truncate text-foreground", className)}>
      {brand.name}
    </span>
  );
}
