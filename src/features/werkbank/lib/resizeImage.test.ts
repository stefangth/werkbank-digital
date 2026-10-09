import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { resizeImage } from "./resizeImage";
import { PHOTO_JPEG_QUALITY, PHOTO_MAX_BYTES } from "./visitDefaults";

let outSize = 1000;
const drawImage = vi.fn();
const toBlob = vi.fn();
let canvas: HTMLCanvasElement;

function stubImage(width: number, height: number) {
  const close = vi.fn();
  vi.stubGlobal("createImageBitmap", vi.fn(async () => ({ width, height, close })));
  return close;
}

describe("resizeImage", () => {
  beforeEach(() => {
    outSize = 1000;
    drawImage.mockReset();
    toBlob.mockReset().mockImplementation((cb: BlobCallback) => cb(new Blob([new Uint8Array(outSize)], { type: "image/jpeg" })));
    const create = document.createElement.bind(document);
    vi.spyOn(document, "createElement").mockImplementation((tag: string) => {
      const el = create(tag);
      if (tag === "canvas") {
        canvas = el as HTMLCanvasElement;
        canvas.getContext = vi.fn(() => ({ drawImage })) as unknown as HTMLCanvasElement["getContext"];
        canvas.toBlob = toBlob as unknown as HTMLCanvasElement["toBlob"];
      }
      return el;
    });
  });
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("scales the long edge down to 2000 px as JPEG", async () => {
    const close = stubImage(4000, 3000);
    const out = await resizeImage(new Blob(["x"]));
    expect(canvas.width).toBe(2000);
    expect(canvas.height).toBe(1500);
    expect(drawImage).toHaveBeenCalledWith(expect.anything(), 0, 0, 2000, 1500);
    expect(toBlob).toHaveBeenCalledWith(expect.any(Function), "image/jpeg", PHOTO_JPEG_QUALITY);
    expect(out.type).toBe("image/jpeg");
    expect(close).toHaveBeenCalled();
  });

  it("keeps a smaller image at its size", async () => {
    stubImage(1200, 800);
    await resizeImage(new Blob(["x"]));
    expect(canvas.width).toBe(1200);
    expect(canvas.height).toBe(800);
  });

  it("scales a portrait image by its height", async () => {
    stubImage(3000, 4000);
    await resizeImage(new Blob(["x"]));
    expect(canvas.width).toBe(1500);
    expect(canvas.height).toBe(2000);
  });

  it("rejects a result over the byte limit", async () => {
    stubImage(1200, 800);
    outSize = PHOTO_MAX_BYTES + 1;
    await expect(resizeImage(new Blob(["x"]))).rejects.toThrow("photo_too_large");
  });

  it("rejects when the canvas yields no blob", async () => {
    stubImage(1200, 800);
    toBlob.mockImplementation((cb: BlobCallback) => cb(null));
    await expect(resizeImage(new Blob(["x"]))).rejects.toThrow("photo_unreadable");
  });
});
