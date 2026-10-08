import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { renderWithProviders } from "@/test/renderWithProviders";
import type { AuthContextType } from "@/features/auth/AuthContext";
import type { AssignmentReport } from "../data/technicianApp";

vi.mock("../hooks/useAssignments", () => ({ ASSIGNMENTS_KEY: ["werkbank", "assignments"], useAssignmentActions: vi.fn(), useVisitObjectUrls: () => ({ data: {} }) }));
vi.mock("../lib/resizeImage", () => ({ resizeImage: vi.fn() }));
vi.mock("./SignaturePad", () => ({
  SignaturePad: ({ onChange }: { onChange: (b: Blob | null) => void }) => (
    <button type="button" onClick={() => onChange(new Blob(["sig"], { type: "image/png" }))}>draw</button>
  ),
}));
const { toastError } = vi.hoisted(() => ({ toastError: vi.fn() }));
vi.mock("sonner", () => ({ toast: { error: toastError, success: vi.fn() } }));

import { useAssignmentActions } from "../hooks/useAssignments";
import { resizeImage } from "../lib/resizeImage";
import { ReportSheet } from "./ReportSheet";

const photo = (i: number) => ({ id: `p${i}`, path: `org/o1/r1/${i}.jpg`, position: i, caption: null });
const report = (o: Partial<AssignmentReport> = {}): AssignmentReport => ({
  id: "r1", artist_id: "a1", technician_name: "Kai", visit_date: "2026-10-08", body: "Alt", locked_at: null,
  signer_name: null, signature_path: null, signed_at: null, is_mine: true, photos: [photo(1), photo(2)], ...o,
});

const mutation = () => ({ mutate: vi.fn(), isPending: false });
let actions: Record<string, ReturnType<typeof mutation>>;
const onOpenChange = vi.fn();

const renderSheet = (r: AssignmentReport | undefined = report()) => renderWithProviders(
  <ReportSheet orderId="o1" report={r} open onOpenChange={onOpenChange} />,
  { authOverrides: { user: { id: "u1" }, currentOrg: { id: "org" } } as unknown as Partial<AuthContextType> },
);

describe("ReportSheet", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    actions = {
      updateReport: mutation(), addPhoto: mutation(), removePhoto: mutation(), lockReport: mutation(), signReport: mutation(),
    };
    vi.mocked(useAssignmentActions).mockReturnValue(actions as unknown as ReturnType<typeof useAssignmentActions>);
  });

  it("saves the text on blur, and only when it changed", () => {
    renderSheet();
    const body = screen.getByLabelText("What was done");
    fireEvent.blur(body);
    expect(actions.updateReport.mutate).not.toHaveBeenCalled();
    fireEvent.change(body, { target: { value: "Thermostat getauscht" } });
    fireEvent.blur(body);
    expect(actions.updateReport.mutate).toHaveBeenCalledWith({ reportId: "r1", body: "Thermostat getauscht", visitDate: "2026-10-08" }, expect.anything());
  });

  it("saves a changed visit date", () => {
    renderSheet();
    fireEvent.change(screen.getByLabelText("Visit date"), { target: { value: "2026-10-07" } });
    expect(actions.updateReport.mutate).toHaveBeenCalledWith({ reportId: "r1", body: "Alt", visitDate: "2026-10-07" }, expect.anything());
  });

  it("saves unsaved text when the sheet closes", () => {
    renderSheet();
    fireEvent.change(screen.getByLabelText("What was done"), { target: { value: "Neu" } });
    fireEvent.keyDown(document.activeElement ?? document.body, { key: "Escape" });
    expect(actions.updateReport.mutate).toHaveBeenCalledWith({ reportId: "r1", body: "Neu", visitDate: "2026-10-08" }, expect.anything());
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("sizes every field at 16px so iOS does not zoom on focus", async () => {
    renderSheet();
    for (const label of ["Visit date", "What was done"]) {
      const field = screen.getByLabelText(label);
      expect(field).toHaveClass("text-input-touch");
      expect(field).not.toHaveClass("text-[13px]");
    }
    fireEvent.click(screen.getByRole("button", { name: "Get signature" }));
    const signer = await screen.findByLabelText("Name of the signer");
    expect(signer).toHaveClass("text-input-touch");
    expect(signer).not.toHaveClass("text-[13px]");
  });

  it("explains the presets next to the visit date, the photo limit and the resizing", () => {
    renderSheet();
    expect(screen.getByText(/Default today/)).toBeInTheDocument();
    expect(screen.getByText(/Default 20 photos per report/)).toBeInTheDocument();
    expect(screen.getByText(/Photos are resized to 2000 px/)).toBeInTheDocument();
  });

  it("resizes a new photo, then uploads it", async () => {
    const resized = new Blob(["small"], { type: "image/jpeg" });
    vi.mocked(resizeImage).mockResolvedValue(resized);
    renderSheet();
    const file = new File(["big"], "x.heic", { type: "image/heic" });
    const input = document.body.querySelector('input[type="file"]') as HTMLInputElement;
    expect(input).toHaveAttribute("accept", "image/*");
    expect(input).toHaveAttribute("capture", "environment");
    fireEvent.change(input, { target: { files: [file] } });
    await waitFor(() => expect(actions.addPhoto.mutate).toHaveBeenCalledWith({ reportId: "r1", file: resized }, expect.anything()));
    expect(resizeImage).toHaveBeenCalledWith(file);
  });

  it("toasts a photo that stays too large and uploads nothing", async () => {
    vi.mocked(resizeImage).mockRejectedValue(new Error("photo_too_large"));
    renderSheet();
    const input = document.body.querySelector('input[type="file"]') as HTMLInputElement;
    fireEvent.change(input, { target: { files: [new File(["big"], "x.jpg")] } });
    await waitFor(() => expect(toastError).toHaveBeenCalledWith("The photo is too large even after resizing."));
    expect(actions.addPhoto.mutate).not.toHaveBeenCalled();
  });

  it("removes a photo", () => {
    renderSheet();
    fireEvent.click(screen.getAllByRole("button", { name: "Remove photo" })[1]);
    expect(actions.removePhoto.mutate).toHaveBeenCalledWith("p2");
  });

  it("disables adding at 20 photos", () => {
    renderSheet(report({ photos: Array.from({ length: 20 }, (_, i) => photo(i + 1)) }));
    expect(screen.getByRole("button", { name: "Add photo" })).toBeDisabled();
  });

  it("signs with a name and a drawn signature after a confirm, once on a double tap", async () => {
    renderSheet(report({ body: "Thermostat getauscht" }));
    fireEvent.click(screen.getByRole("button", { name: "Get signature" }));
    await screen.findByLabelText("Name of the signer");
    expect(screen.getByText("Thermostat getauscht")).toBeInTheDocument();
    expect(screen.getByText("2 photos")).toBeInTheDocument();
    const sign = screen.getByRole("button", { name: "Sign" });
    expect(sign).toBeDisabled();
    fireEvent.change(screen.getByLabelText("Name of the signer"), { target: { value: "   " } });
    fireEvent.click(screen.getByRole("button", { name: "draw" }));
    expect(sign).toBeDisabled();
    fireEvent.change(screen.getByLabelText("Name of the signer"), { target: { value: " Frau Meier " } });
    expect(sign).toBeEnabled();
    fireEvent.click(sign);
    expect(actions.signReport.mutate).not.toHaveBeenCalled();
    const dialog = await screen.findByRole("alertdialog");
    expect(within(dialog).getByText("The report cannot be changed afterwards.")).toBeInTheDocument();
    const confirm = within(dialog).getByRole("button", { name: "Sign" });
    fireEvent.click(confirm);
    fireEvent.click(confirm);
    expect(actions.signReport.mutate).toHaveBeenCalledTimes(1);
    expect(actions.signReport.mutate).toHaveBeenCalledWith(
      { reportId: "r1", signerName: "Frau Meier", png: expect.any(Blob) }, expect.anything(),
    );
    expect(confirm).toBeDisabled();
  });

  it("stays on the report when saving the text fails", async () => {
    actions.updateReport.mutate.mockImplementation((_v, opts) => opts.onError(new Error("network")));
    renderSheet();
    fireEvent.change(screen.getByLabelText("What was done"), { target: { value: "Neu" } });
    fireEvent.click(screen.getByRole("button", { name: "Get signature" }));
    await waitFor(() => expect(actions.updateReport.mutate).toHaveBeenCalled());
    await new Promise((r) => setTimeout(r, 0));
    expect(screen.queryByLabelText("Name of the signer")).toBeNull();
    expect(screen.getByLabelText("What was done")).toBeInTheDocument();
  });

  /** Typing, then tapping "Get signature": the blur starts the save and the tap lands while it runs. */
  const blurThenTapSign = () => {
    let settle: { onSuccess: () => void; onError: (e: Error) => void } | undefined;
    actions.updateReport.mutate.mockImplementation((_v, opts) => { settle = opts; });
    actions.updateReport.isPending = true;
    renderSheet();
    const body = screen.getByLabelText("What was done");
    fireEvent.change(body, { target: { value: "Neu" } });
    fireEvent.blur(body);
    const sign = screen.getByRole("button", { name: "Get signature" });
    expect(sign).toBeEnabled();
    fireEvent.click(sign);
    expect(actions.updateReport.mutate).toHaveBeenCalledTimes(1);
    expect(screen.queryByLabelText("Name of the signer")).toBeNull();
    return () => settle!;
  };

  it("keeps the first tap on Get signature after typing and opens the sign step once the save lands", async () => {
    const settle = blurThenTapSign();
    act(() => settle().onSuccess());
    expect(await screen.findByLabelText("Name of the signer")).toBeInTheDocument();
    expect(actions.updateReport.mutate).toHaveBeenCalledTimes(1);
  });

  it("stays on the report when the save running at the tap fails", async () => {
    const settle = blurThenTapSign();
    act(() => settle().onError(new Error("network")));
    await new Promise((r) => setTimeout(r, 0));
    expect(screen.queryByLabelText("Name of the signer")).toBeNull();
    expect(screen.getByLabelText("What was done")).toBeInTheDocument();
  });

  it("enters the sign step once the changed text is saved", async () => {
    actions.updateReport.mutate.mockImplementation((_v, opts) => opts.onSuccess());
    renderSheet();
    fireEvent.change(screen.getByLabelText("What was done"), { target: { value: "Neu" } });
    fireEvent.click(screen.getByRole("button", { name: "Get signature" }));
    expect(await screen.findByLabelText("Name of the signer")).toBeInTheDocument();
    expect(screen.getByText("Neu").tagName).toBe("P");
  });

  it("keeps an uploaded signature after a failed sign and retries the confirmation only", async () => {
    vi.stubGlobal("URL", Object.assign(URL, { createObjectURL: vi.fn(() => "blob:sig"), revokeObjectURL: vi.fn() }));
    actions.signReport.mutate.mockImplementationOnce((_v, opts) => {
      opts.onError(Object.assign(new Error("network"), { signatureUploaded: true }));
      opts.onSettled();
    });
    renderSheet(report({ id: "r-frozen" }));
    fireEvent.click(screen.getByRole("button", { name: "Get signature" }));
    fireEvent.change(await screen.findByLabelText("Name of the signer"), { target: { value: "Frau Meier" } });
    fireEvent.click(screen.getByRole("button", { name: "draw" }));
    fireEvent.click(screen.getByRole("button", { name: "Sign" }));
    fireEvent.click(within(await screen.findByRole("alertdialog")).getByRole("button", { name: "Sign" }));
    const png = actions.signReport.mutate.mock.calls[0][0].png;

    expect(await screen.findByText("The signature is saved. Only the confirmation is missing, so sign again to finish.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "draw" })).toBeNull();
    expect(screen.getByRole("img", { name: "Signature of Frau Meier" })).toHaveAttribute("src", "blob:sig");
    expect(screen.getByLabelText("Name of the signer")).toHaveAttribute("readonly");

    fireEvent.click(screen.getByRole("button", { name: "Sign" }));
    fireEvent.click(within(await screen.findByRole("alertdialog")).getByRole("button", { name: "Sign" }));
    expect(actions.signReport.mutate).toHaveBeenLastCalledWith(
      { reportId: "r-frozen", signerName: "Frau Meier", png, uploaded: true }, expect.anything(),
    );
    vi.unstubAllGlobals();
  });

  it("closes without a signature after a confirm, once on a double tap", async () => {
    renderSheet();
    fireEvent.click(screen.getByRole("button", { name: "Close without signature" }));
    const dialog = await screen.findByRole("alertdialog");
    expect(within(dialog).getByText("The report cannot be changed afterwards.")).toBeInTheDocument();
    const confirm = within(dialog).getByRole("button", { name: "Close report" });
    fireEvent.click(confirm);
    fireEvent.click(confirm);
    await waitFor(() => expect(actions.lockReport.mutate).toHaveBeenCalledTimes(1));
    expect(actions.lockReport.mutate).toHaveBeenCalledWith("r1", expect.anything());
  });

  const textOf = (re: RegExp) => screen.getByText((_, el) => el?.tagName === "P" && re.test(el.textContent ?? ""));

  it("shows a signed report read-only", () => {
    renderSheet(report({ locked_at: "2026-10-08T12:00:00Z", signed_at: "2026-10-08T12:00:00Z", signer_name: "Frau Meier", signature_path: "org/o1/r1/signature.png" }));
    expect(textOf(/^Signed by Frau Meier on .*2026/)).toBeInTheDocument();
    expect(screen.queryByLabelText("What was done")).toBeNull();
    expect(screen.queryByRole("button", { name: /Get signature|Close without signature|Add photo|Remove photo/ })).toBeNull();
    expect(screen.getByText("Alt")).toBeInTheDocument();
  });

  it("shows a report closed without signature read-only", () => {
    renderSheet(report({ locked_at: "2026-10-08T12:00:00Z" }));
    expect(textOf(/^Closed on .*2026/)).toBeInTheDocument();
    expect(screen.queryByLabelText("What was done")).toBeNull();
  });

  it("shows another technician's open report read-only", () => {
    renderSheet(report({ is_mine: false, technician_name: "Uwe" }));
    expect(screen.getByText("Uwe writes this report. You can only read it.")).toBeInTheDocument();
    expect(screen.queryByLabelText("What was done")).toBeNull();
    expect(screen.queryByRole("button", { name: /Get signature|Add photo/ })).toBeNull();
  });
});
