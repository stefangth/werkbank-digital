import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { fireEvent, screen } from "@testing-library/react";
import { renderWithProviders } from "@/test/renderWithProviders";
import { SignaturePad } from "./SignaturePad";

const ctx = {
  beginPath: vi.fn(), moveTo: vi.fn(), lineTo: vi.fn(), stroke: vi.fn(), fillRect: vi.fn(), setTransform: vi.fn(),
  lineWidth: 0, lineCap: "", lineJoin: "", strokeStyle: "", fillStyle: "",
};

describe("SignaturePad", () => {
  beforeEach(() => {
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(ctx as unknown as CanvasRenderingContext2D);
    vi.spyOn(HTMLCanvasElement.prototype, "toBlob").mockImplementation((cb: BlobCallback) => cb(new Blob(["png"], { type: "image/png" })));
    vi.spyOn(HTMLCanvasElement.prototype, "getBoundingClientRect").mockReturnValue({ left: 0, top: 0, width: 300, height: 150 } as DOMRect);
  });
  afterEach(() => vi.restoreAllMocks());

  it("emits null while empty, a png after a stroke and null after clearing", async () => {
    const onChange = vi.fn();
    renderWithProviders(<SignaturePad onChange={onChange} />);
    expect(onChange).toHaveBeenLastCalledWith(null);

    const pad = screen.getByLabelText("Signature field");
    fireEvent.pointerDown(pad, { clientX: 10, clientY: 10, pointerId: 1 });
    fireEvent.pointerMove(pad, { clientX: 50, clientY: 40, pointerId: 1 });
    fireEvent.pointerUp(pad, { clientX: 50, clientY: 40, pointerId: 1 });
    expect(ctx.lineTo).toHaveBeenCalled();
    const last = onChange.mock.calls.at(-1)?.[0];
    expect(last).toBeInstanceOf(Blob);
    expect((last as Blob).type).toBe("image/png");

    fireEvent.click(screen.getByRole("button", { name: "Clear" }));
    expect(onChange).toHaveBeenLastCalledWith(null);
  });

  it("ignores a move without a pressed pointer", () => {
    const onChange = vi.fn();
    renderWithProviders(<SignaturePad onChange={onChange} />);
    const pad = screen.getByLabelText("Signature field");
    fireEvent.pointerMove(pad, { clientX: 50, clientY: 40, pointerId: 1 });
    fireEvent.pointerUp(pad, { clientX: 50, clientY: 40, pointerId: 1 });
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenLastCalledWith(null);
  });
});
