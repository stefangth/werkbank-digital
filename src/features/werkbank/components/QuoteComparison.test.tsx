import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { act, screen } from "@testing-library/react";
import { renderWithProviders } from "@/test/renderWithProviders";
import i18n from "@/i18n";
import { STORAGE_KEY } from "@/i18n/config";
import type { DocumentItem } from "../data/documentItems";
import { QuoteComparison } from "./QuoteComparison";

const item = (id: string, name: string) => ({ id, name, kind: "item" }) as DocumentItem;

describe("QuoteComparison", () => {
  beforeEach(async () => {
    localStorage.setItem(STORAGE_KEY, "de");
    await act(async () => { await i18n.changeLanguage("de"); });
  });
  afterAll(async () => { await act(async () => { await i18n.changeLanguage("en"); }); });

  const render = (over: Partial<React.ComponentProps<typeof QuoteComparison>> = {}) =>
    renderWithProviders(
      <QuoteComparison
        quoteNumber="A-0042"
        quoteGross={119}
        orderGross={142.8}
        orderItems={[item("o1", "Heizkörper"), item("o2", "Anfahrt")]}
        diff={{ changed: new Set(["o1"]), added: new Set(["o2"]), removedCount: 2 }}
        {...over}
      />,
    );

  it("shows quote gross, order gross and the difference", () => {
    render();
    const line = screen.getByTestId("comparison-line");
    expect(line).toHaveTextContent("Angebot A-0042");
    expect(line).toHaveTextContent("119,00");
    expect(line).toHaveTextContent("142,80");
    expect(line).toHaveTextContent("+23,80");
  });

  it("marks changed and new lines and counts removed ones", () => {
    render();
    expect(screen.getByText("Heizkörper").closest("li")).toHaveTextContent("Geändert");
    expect(screen.getByText("Anfahrt").closest("li")).toHaveTextContent("Neu");
    expect(screen.getByText(/2 Positionen des Angebots fehlen/)).toBeInTheDocument();
  });

  it("shows a negative difference and no list when nothing differs", () => {
    render({ orderGross: 100, diff: { changed: new Set(), added: new Set(), removedCount: 0 } });
    expect(screen.getByTestId("comparison-line")).toHaveTextContent("-19,00");
    expect(screen.queryByRole("list")).not.toBeInTheDocument();
  });
});
