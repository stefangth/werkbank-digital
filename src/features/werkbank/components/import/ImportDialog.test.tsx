import { describe, it, expect, vi, beforeEach, afterAll } from "vitest";
import { act, fireEvent, screen, within } from "@testing-library/react";
import { z } from "zod";
import { renderWithProviders } from "@/test/renderWithProviders";
import { anOrganization } from "@/test/fixtures";
import i18n from "@/i18n";
import { STORAGE_KEY } from "@/i18n/config";

const { client } = vi.hoisted(() => ({ client: { fake: "supabase" } }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: client }));

import { ImportDialog } from "./ImportDialog";
import type { ImportResult, ImportSpec } from "../../import/types";
import { ImportPartialError } from "../../import/partialError";

type FakeForm = { item_no: string; name: string; price: string };

function fakeSpec(results: ImportResult[] | Error, entity: ImportSpec<FakeForm>["entity"] = "catalog_items"): ImportSpec<FakeForm> {
  return {
    entity,
    fields: [
      { key: "item_no", labelKey: "catalog.dialog.itemNo", required: false, aliases: ["Nr"], kind: "text" },
      { key: "name", labelKey: "catalog.dialog.name", required: true, aliases: ["Bezeichnung"], kind: "text" },
      { key: "price", labelKey: "catalog.dialog.labour", required: false, aliases: ["Preis"], kind: "money" },
    ],
    schema: (t) =>
      z.object({
        item_no: z.string(),
        name: z.string().trim().min(1, t("catalog.errors.name")),
        price: z.string().regex(/^\d+\.\d{2}$/, t("catalog.errors.price")),
      }),
    toRpcRow: (form) => ({ ...form }),
    run: vi.fn(async () => {
      if (results instanceof Error) throw results;
      return results;
    }),
  };
}

const CSV = `Nr,Bezeichnung,Preis
A-1,Heizkörper,"12,50"
A-2,,5
A-3,Ventil,3`;

function upload(content: string, name = "liste.csv") {
  const file = new File([content], name, { type: "text/csv" });
  // jsdom lacks Blob.text()
  Object.defineProperty(file, "text", { value: async () => content });
  fireEvent.change(screen.getByLabelText("Datei auswählen"), { target: { files: [file] } });
}

function renderDialog(spec: ImportSpec<FakeForm>, onDone = vi.fn(), onOpenChange = vi.fn()) {
  renderWithProviders(<ImportDialog spec={spec} open onOpenChange={onOpenChange} onDone={onDone} />, {
    authOverrides: { currentOrg: anOrganization({ id: "org-1" }) as never },
  });
  return { onDone, onOpenChange };
}

describe("ImportDialog", () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    localStorage.setItem(STORAGE_KEY, "de");
    await act(async () => { await i18n.changeLanguage("de"); });
  });
  afterAll(async () => {
    await act(async () => { await i18n.changeLanguage("en"); });
  });

  it("runs upload, map, review, import and summary", async () => {
    const spec = fakeSpec([
      { row: 0, status: "created", reason: null, detail: null },
      { row: 1, status: "skipped", reason: "customer_no_taken", detail: null },
    ]);
    const { onDone } = renderDialog(spec);

    upload(CSV);

    // map: selects prefilled from the aliases
    const nameSelect = await screen.findByRole("combobox", { name: "Spalte für Bezeichnung" });
    expect(nameSelect).toHaveTextContent("Bezeichnung");
    expect(screen.getByRole("combobox", { name: "Spalte für Artikelnummer (optional)" })).toHaveTextContent("Nr");
    expect(screen.getByRole("combobox", { name: "Spalte für Lohn" })).toHaveTextContent("Preis");
    fireEvent.click(screen.getByRole("button", { name: "Weiter" }));

    // review: counts and the invalid row with its schema message, by sheet row number
    expect(await screen.findByText("2 Zeilen sind bereit, 1 Zeile hat Fehler und wird ausgelassen.")).toBeInTheDocument();
    const invalid = screen.getByRole("list", { name: "Zeilen mit Fehlern" });
    expect(within(invalid).getByText("Zeile 3: Gib eine Bezeichnung ein")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "2 Zeilen importieren" }));

    // summary from the mocked run results; the RPC row 1 is sheet row 4 (header is row 1)
    expect(await screen.findByText("1 importiert, 1 übersprungen, 1 Fehler")).toBeInTheDocument();
    const reasons = screen.getByRole("list", { name: "Nicht importierte Zeilen" });
    expect(within(reasons).getByText("Zeile 3: Ungültige Angaben")).toBeInTheDocument();
    expect(within(reasons).getByText("Zeile 4: Kundennummer schon vergeben")).toBeInTheDocument();

    expect(spec.run).toHaveBeenCalledTimes(1);
    expect(spec.run).toHaveBeenCalledWith(client, "org-1", [
      { item_no: "A-1", name: "Heizkörper", price: "12.50" },
      { item_no: "A-3", name: "Ventil", price: "3.00" },
    ]);
    expect(onDone).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole("button", { name: "Fertig" }));
    expect(onDone).toHaveBeenCalledTimes(1);
  });

  it("names the missing customer number of an unknown_customer row", async () => {
    const spec = fakeSpec([
      { row: 0, status: "error", reason: "unknown_customer", detail: "K-99" },
      { row: 1, status: "created", reason: null, detail: null },
    ]);
    renderDialog(spec);
    upload(CSV);
    fireEvent.click(await screen.findByRole("button", { name: "Weiter" }));
    fireEvent.click(await screen.findByRole("button", { name: "2 Zeilen importieren" }));
    expect(await screen.findByText("Zeile 2: Kunde K-99 nicht gefunden")).toBeInTheDocument();
  });

  it("explains a property_exists row as an existing property", async () => {
    const spec = fakeSpec([
      { row: 0, status: "created", reason: null, detail: null },
      { row: 1, status: "skipped", reason: "property_exists", detail: "11111111-1111-4111-8111-111111111111" },
    ]);
    renderDialog(spec);
    upload(CSV);
    fireEvent.click(await screen.findByRole("button", { name: "Weiter" }));
    fireEvent.click(await screen.findByRole("button", { name: "2 Zeilen importieren" }));
    expect(await screen.findByText("Zeile 4: Objekt existiert schon")).toBeInTheDocument();
  });

  it("keeps the review step and shows an error when the import fails", async () => {
    const spec = fakeSpec(new Error("boom"));
    const { onDone } = renderDialog(spec);
    upload(CSV);
    fireEvent.click(await screen.findByRole("button", { name: "Weiter" }));
    fireEvent.click(await screen.findByRole("button", { name: "2 Zeilen importieren" }));
    expect(await screen.findByText("Das hat nicht geklappt. Versuch es bitte noch einmal.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "2 Zeilen importieren" })).toBeEnabled();
    expect(onDone).not.toHaveBeenCalled();
  });

  it("moves to the summary with a warning when a later chunk failed after earlier ones were saved", async () => {
    const spec = fakeSpec(
      new ImportPartialError([{ row: 0, status: "created", reason: null, detail: null }], [1], new Error("network")),
    );
    const { onDone } = renderDialog(spec);
    upload(CSV);
    fireEvent.click(await screen.findByRole("button", { name: "Weiter" }));
    fireEvent.click(await screen.findByRole("button", { name: "2 Zeilen importieren" }));

    expect(await screen.findByText("1 importiert, 0 übersprungen, 1 Fehler")).toBeInTheDocument();
    expect(
      screen.getByText(
        "Der Import wurde nach 1 von 2 Zeilen unterbrochen. Die bereits importierten Zeilen sind gespeichert. Importiere nicht noch einmal die ganze Datei, sondern nur die nicht importierten Zeilen.",
      ),
    ).toBeInTheDocument();
    // valid row 1 is sheet row 4; invalid row 3 stays listed
    const reasons = screen.getByRole("list", { name: "Nicht importierte Zeilen" });
    expect(within(reasons).getByText("Zeile 3: Ungültige Angaben")).toBeInTheDocument();
    expect(within(reasons).getByText("Zeile 4: Nicht gesendet, weil der Import unterbrochen wurde")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "2 Zeilen importieren" })).not.toBeInTheDocument();
    expect(screen.queryByText("Das hat nicht geklappt. Versuch es bitte noch einmal.")).not.toBeInTheDocument();
    expect(onDone).toHaveBeenCalledTimes(1);
    expect(spec.run).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole("button", { name: "Fertig" }));
    expect(onDone).toHaveBeenCalledTimes(1);
  });

  it("blocks the mapping until every required field has a column", async () => {
    renderDialog(fakeSpec([]));
    upload("Spalte A,Spalte B\nx,y");
    await screen.findByRole("combobox", { name: "Spalte für Bezeichnung" });
    expect(screen.getByRole("button", { name: "Weiter" })).toBeDisabled();
  });

  it("explains a sheet with more than 5000 rows in the upload step", async () => {
    renderDialog(fakeSpec([]));
    upload(["Nr,Bezeichnung", ...Array.from({ length: 5001 }, (_, i) => `A-${i},X`)].join("\n"));
    expect(await screen.findByText("Die Datei hat mehr als 5000 Zeilen. Teile sie bitte auf.")).toBeInTheDocument();
    expect(screen.getByLabelText("Datei auswählen")).toBeInTheDocument();
  });

  it("tells you to import the customers first when importing properties", () => {
    renderDialog(fakeSpec([], "properties"));
    expect(screen.getByText("Importiere zuerst die Kunden. Liegenschaften finden ihren Kunden über die Kundennummer.")).toBeInTheDocument();
  });
});
