import { WifiOff } from "lucide-react";
import { Trans, useTranslation } from "react-i18next";
import { Metric } from "@/components/ui/metric";
import { formatTimeShort } from "@/lib/dates";
import { useOnline } from "../hooks/useOnline";

/** Shown while offline: the cached list is what the phone had at the last successful fetch. */
export function OfflineBanner() {
  const { t } = useTranslation("werkbank");
  const { online, lastSync } = useOnline();
  if (online) return null;
  return (
    <div role="status" className="border-b border-border bg-well-tint">
      <p className="mx-auto m-0 flex max-w-screen-sm items-center gap-2 px-4 py-2 text-control">
        <WifiOff aria-hidden="true" className="size-4 shrink-0" />
        <span>
          {lastSync ? (
            <Trans t={t} i18nKey="app.offline.banner" values={{ time: formatTimeShort(lastSync.toISOString()) }}
              components={{ time: <Metric size="body">{null}</Metric> }} />
          ) : t("app.offline.bannerNoSync")}
        </span>
      </p>
    </div>
  );
}

/** The hint under write buttons, which are disabled while offline. */
export function NeedsNetwork() {
  const { t } = useTranslation("werkbank");
  const { online } = useOnline();
  if (online) return null;
  return <p className="m-0 text-control text-muted-foreground">{t("app.offline.needsNetwork")}</p>;
}
