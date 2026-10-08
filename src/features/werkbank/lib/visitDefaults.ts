/** Defaults of the technician app and visit reports. Each is shown next to its field with a
 *  DefaultHint. The SQL twins (photo limit 20, list windows 7 and 14 days, bucket limits) are
 *  literals with a comment pointing here. */
export const MAX_PHOTOS_PER_REPORT = 20;
export const PHOTO_MAX_EDGE_PX = 2000;
export const PHOTO_JPEG_QUALITY = 0.8;
export const PHOTO_MAX_BYTES = 5 * 1024 * 1024;
export const SIGNATURE_MAX_BYTES = 500 * 1024;
export const UPCOMING_DAYS = 7;
export const DONE_WINDOW_DAYS = 14;
export const OFFLINE_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
