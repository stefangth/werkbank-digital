import { useState } from "react";
import { useTranslation } from "react-i18next";
import { CalendarDays } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Eyebrow } from "@/components/ui/eyebrow";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Metric } from "@/components/ui/metric";
import { formatDateDMY } from "@/lib/dates";
import { DatePopover } from "./DatePopover";
import { Fact } from "./DocumentHeaderFields";
import { TechnicianMultiSelect } from "./TechnicianMultiSelect";

export type SchedulePatch = { scheduled_date?: string | null; scheduled_time?: string | null };
const hhmm = (time: string | null) => time?.slice(0, 5) ?? "";

/** The time field keeps its own text and saves on leaving it; the parent remounts it (key) when
 *  the saved value changes. */
function TimeField({ time, disabled, onSave }: { time: string | null; disabled: boolean; onSave: (time: string | null) => void }) {
  const { t } = useTranslation("werkbank");
  const [value, setValue] = useState(hhmm(time));
  return (
    <div className="space-y-1.5">
      <Label htmlFor="order-time">{t("orders.schedule.time")}</Label>
      <Input
        id="order-time"
        type="time"
        value={value}
        disabled={disabled}
        onChange={(e) => setValue(e.target.value)}
        onBlur={() => value !== hhmm(time) && onSave(value === "" ? null : value)}
      />
    </div>
  );
}

/** The technicians keep a local selection, so a second toggle builds on the first instead of on
 *  the server value that has not caught up yet. While a save is pending the toggles are disabled
 *  (saves are serialized); when it settles, or the server value changes, the server value wins. */
function TechniciansField({ ids, pending, onChange }: { ids: string[]; pending: boolean; onChange: (artistIds: string[]) => void }) {
  const serverKey = ids.join(",");
  const [selected, setSelected] = useState(ids);
  const [seen, setSeen] = useState({ key: serverKey, pending });
  if (seen.key !== serverKey || seen.pending !== pending) {
    setSeen({ key: serverKey, pending });
    if (seen.key !== serverKey || (seen.pending && !pending)) setSelected(ids);
  }
  return (
    <TechnicianMultiSelect
      id="order-technicians"
      value={selected}
      disabled={pending}
      onChange={(next) => { setSelected(next); onChange(next); }}
    />
  );
}

/** "Einsatz": when and who. The time can only be set with a date (a database check), so it is
 *  disabled until one is picked, and removing the date removes the time with it. Technicians
 *  are optional. Read only, it is plain text. */
export function OrderScheduleCard({
  date, time, technicianIds, technicianNames, readOnly, onSchedule, onTechnicians, techniciansPending = false,
}: {
  date: string | null;
  time: string | null;
  technicianIds: string[];
  /** Shown when read only. */
  technicianNames: string[];
  readOnly: boolean;
  onSchedule: (patch: SchedulePatch) => void;
  onTechnicians: (artistIds: string[]) => void;
  /** A technician save is in flight: toggles wait for it. */
  techniciansPending?: boolean;
}) {
  const { t } = useTranslation("werkbank");
  const none = t("quotes.header.none");

  return (
    <Card>
      <CardHeader><Eyebrow>{t("orders.schedule.title")}</Eyebrow></CardHeader>
      <CardContent>
        {readOnly ? (
          <dl className="m-0 grid gap-x-6 gap-y-3 text-sm md:grid-cols-3">
            <Fact label={t("orders.schedule.date")}>{date ? <Metric size="body">{formatDateDMY(date)}</Metric> : none}</Fact>
            <Fact label={t("orders.schedule.time")}>{time ? <Metric size="body">{hhmm(time)}</Metric> : none}</Fact>
            <Fact label={t("orders.schedule.technicians")}>{technicianNames.length ? technicianNames.join(", ") : none}</Fact>
          </dl>
        ) : (
          <div className="grid gap-4 md:grid-cols-3">
            <div className="space-y-1.5">
              <Label htmlFor="order-date">{t("orders.schedule.date")}</Label>
              <div className="flex gap-2">
                <DatePopover value={date} onSelect={(d) => onSchedule({ scheduled_date: d })}>
                  <Button id="order-date" variant="secondary" className="flex-1 justify-start gap-2">
                    <CalendarDays className="h-4 w-4" aria-hidden />
                    {date ? <Metric size="body">{formatDateDMY(date)}</Metric> : t("orders.schedule.pickDate")}
                  </Button>
                </DatePopover>
                {date && (
                  <Button variant="secondary" onClick={() => onSchedule({ scheduled_date: null, scheduled_time: null })}>
                    {t("orders.schedule.clear")}
                  </Button>
                )}
              </div>
            </div>
            <TimeField key={`${date}-${time}`} time={time} disabled={!date} onSave={(next) => onSchedule({ scheduled_time: next })} />
            <div className="space-y-1.5">
              <Label htmlFor="order-technicians">{t("orders.schedule.technicians")}</Label>
              <TechniciansField ids={technicianIds} pending={techniciansPending} onChange={onTechnicians} />
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
