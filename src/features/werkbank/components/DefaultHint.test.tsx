import { describe, it, expect } from "vitest";
import { fireEvent, screen } from "@testing-library/react";
import { renderWithProviders } from "@/test/renderWithProviders";
import { DefaultHint } from "./DefaultHint";

describe("DefaultHint", () => {
  it("is named by its text and shows it on hover", async () => {
    renderWithProviders(<DefaultHint text="Vorgabe 7 Tage. Kommt aus den Einstellungen." />);
    const icon = screen.getByLabelText("Vorgabe 7 Tage. Kommt aus den Einstellungen.");
    fireEvent.focus(icon.parentElement as HTMLElement);
    expect((await screen.findAllByText("Vorgabe 7 Tage. Kommt aus den Einstellungen.")).length).toBeGreaterThan(0);
  });
});
