import { PHOTO_JPEG_QUALITY, PHOTO_MAX_BYTES, PHOTO_MAX_EDGE_PX } from "./visitDefaults";

/** Re-encodes a camera photo as JPEG with its long edge at most `maxEdge`, in the browser via a
 *  canvas, so a phone uploads a few hundred KB instead of a 10 MB original (and HEIC or PNG
 *  becomes JPEG, the only photo type the bucket takes). A smaller image keeps its size.
 *  Rejects with `photo_unreadable` when the browser cannot decode or encode it and with
 *  `photo_too_large` when the result still exceeds `PHOTO_MAX_BYTES`. */
export async function resizeImage(file: Blob, maxEdge = PHOTO_MAX_EDGE_PX, quality = PHOTO_JPEG_QUALITY): Promise<Blob> {
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    throw new Error("photo_unreadable");
  }
  const scale = Math.min(1, maxEdge / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    bitmap.close();
    throw new Error("photo_unreadable");
  }
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", quality));
  if (!blob) throw new Error("photo_unreadable");
  if (blob.size > PHOTO_MAX_BYTES) throw new Error("photo_too_large");
  return blob;
}
