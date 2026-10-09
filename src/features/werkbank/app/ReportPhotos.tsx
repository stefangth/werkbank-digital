import { Trash2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import type { AssignmentPhoto } from "../data/technicianApp";

/** Photo thumbnails of one visit report from signed URLs. Without a URL (offline, or still
 *  loading) a placeholder stands in; photos are not cached offline. */
export function ReportPhotos({ photos, urls, onRemove, removeDisabled }: {
  photos: AssignmentPhoto[];
  urls: Record<string, string>;
  onRemove?: (photoId: string) => void;
  removeDisabled?: boolean;
}) {
  const { t } = useTranslation("werkbank");
  if (photos.length === 0) return null;
  const sorted = [...photos].sort((a, b) => a.position - b.position);
  return (
    <ul className="m-0 grid list-none grid-cols-2 gap-2 p-0">
      {sorted.map((p, i) => (
        <li key={p.id} className="space-y-1">
          {urls[p.path] ? (
            <img src={urls[p.path]} alt={t("app.report.photoAlt", { n: i + 1 })} className="aspect-square w-full rounded-control object-cover" />
          ) : (
            <div className="flex aspect-square w-full items-center justify-center rounded-control bg-well-tint p-2 text-center text-control text-muted-foreground">
              {t("app.report.photoOnlineOnly")}
            </div>
          )}
          {onRemove && (
            <Button
              type="button" variant="secondary" size="touch" className="w-full" disabled={removeDisabled}
              aria-label={t("app.report.removePhoto")} onClick={() => onRemove(p.id)}
            >
              <Trash2 aria-hidden="true" />
            </Button>
          )}
        </li>
      ))}
    </ul>
  );
}
