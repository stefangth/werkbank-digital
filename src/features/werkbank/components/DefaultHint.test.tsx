import { describe, it, expect } from "vitest";
import { act, screen } from "@testing-library/react";
import { Input } from "@/components/ui/input";
import { renderWithProviders } from "@/test/renderWithProviders";
import { DefaultHint, HintedLabel, hintId } from "./DefaultHint";

const TEXT = "Vorgabe 7 Tage. Kommt aus den Einstellungen.";

describe("DefaultHint", () => {
  it("is a button named by its text that shows the text on keyboard focus", async () => {
    renderWithProviders(<DefaultHint text={TEXT} />);
    const hint = screen.getByRole("button", { name: TEXT });
    expect(hint).toHaveAttribute("type", "button");
    act(() => hint.focus());
    expect(hint).toHaveFocus();
    expect((await screen.findAllByText(TEXT)).length).toBeGreaterThan(1);
  });
});

describe("HintedLabel", () => {
  it("keeps the hint out of the control's name and describes the control with it", () => {
    renderWithProviders(
      <div>
        <HintedLabel htmlFor="days" hint={TEXT}>Tage</HintedLabel>
        <Input id="days" aria-describedby={hintId("days")} />
      </div>,
    );
    const input = screen.getByRole("textbox", { name: "Tage" });
    expect(input).toHaveAccessibleName("Tage");
    expect(input).toHaveAccessibleDescription(TEXT);
    expect(screen.getByText("Tage").tagName).toBe("LABEL");
    expect(screen.getByText("Tage")).not.toContainElement(screen.getByRole("button", { name: TEXT }));
  });
});
