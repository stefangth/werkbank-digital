import { describe, it, expect, vi, beforeEach, afterAll } from "vitest";
import { act, fireEvent, screen } from "@testing-library/react";
import { renderWithProviders } from "@/test/renderWithProviders";
import i18n from "@/i18n";
import { STORAGE_KEY } from "@/i18n/config";

vi.mock("./DatePopover", () => ({
  DatePopover: ({ onSelect, children }: { onSelect: (d: string) => void; children: React.ReactNode }) => (
    <div>{children}<button onClick={() => onSelect("2026-11-02")}>test-pick-date</button></div>
  ),
}));
vi.mock("./TechnicianMultiSelect", () => ({
  TechnicianMultiSelect: ({ value, onChange }: { value: string[]; onChange: (ids: string[]) => void }) => (
    <button onClick={() => onChange([...value, "a2"])}>test-add-technician</button>
  ),
}));

import { OrderScheduleCard } from "./OrderScheduleCard";

describe("OrderScheduleCard", () => {
  const onSchedule = vi.fn();
  const onTechnicians = vi.fn();

  beforeEach(async () => {
    vi.clearAllMocks();
    localStorage.setItem(STORAGE_KEY, "de");
    await act(async () => { await i18n.changeLanguage("de"); });
  });
  afterAll(async () => { await act(async () => { await i18n.changeLanguage("en"); }); });

  const render = (over: Partial<React.ComponentProps<typeof OrderScheduleCard>> = {}) =>
    renderWithProviders(
      <OrderScheduleCard date={null} time={null} technicianIds={["a1"]} technicianNames={["Anna Berg"]} readOnly={false} onSchedule={onSchedule} onTechnicians={onTechnicians} {...over} />,
    );

  it("disables the time without a date", () => {
    render();
    expect(screen.getByLabelText("Uhrzeit")).toBeDisabled();
  });

  it("saves a picked date", () => {
    render();
    fireEvent.click(screen.getByText("test-pick-date"));
    expect(onSchedule).toHaveBeenCalledWith({ scheduled_date: "2026-11-02" });
  });

  it("saves a time on blur, shown without seconds, and skips an unchanged one", () => {
    render({ date: "2026-11-02", time: "08:30:00" });
    const time = screen.getByLabelText("Uhrzeit");
    expect(time).toBeEnabled();
    expect(time).toHaveValue("08:30");
    fireEvent.blur(time);
    expect(onSchedule).not.toHaveBeenCalled();
    fireEvent.change(time, { target: { value: "09:15" } });
    fireEvent.blur(time);
    expect(onSchedule).toHaveBeenCalledWith({ scheduled_time: "09:15" });
  });

  it("clears the time with the field", () => {
    render({ date: "2026-11-02", time: "08:30:00" });
    const time = screen.getByLabelText("Uhrzeit");
    fireEvent.change(time, { target: { value: "" } });
    fireEvent.blur(time);
    expect(onSchedule).toHaveBeenCalledWith({ scheduled_time: null });
  });

  it("removing the date also removes the time", () => {
    render({ date: "2026-11-02", time: "08:30:00" });
    fireEvent.click(screen.getByRole("button", { name: "Termin entfernen" }));
    expect(onSchedule).toHaveBeenCalledWith({ scheduled_date: null, scheduled_time: null });
  });

  it("saves the technicians", () => {
    render();
    fireEvent.click(screen.getByText("test-add-technician"));
    expect(onTechnicians).toHaveBeenCalledWith(["a1", "a2"]);
  });

  it("is plain text when read only", () => {
    render({ readOnly: true, date: "2026-11-02", time: "08:30:00" });
    expect(screen.queryByLabelText("Uhrzeit")).not.toBeInTheDocument();
    expect(screen.queryByText("test-add-technician")).not.toBeInTheDocument();
    expect(screen.getByText("02/11/2026")).toBeInTheDocument();
    expect(screen.getByText("08:30")).toBeInTheDocument();
    expect(screen.getByText("Anna Berg")).toBeInTheDocument();
  });
});
