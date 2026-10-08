/** Safari lets a script open a tab only close to the click, so the tab is opened first and
 *  pointed at the PDF once the edge call returns. `noopener` cannot be passed here (the call
 *  would return null), so the back reference is cut by hand before the tab navigates. */
export function openPendingTab(): Window | null {
  const tab = window.open("", "_blank");
  if (tab) tab.opener = null;
  return tab;
}

/** Shows `url` in the pending tab; if the browser refused the tab, `onBlocked` gets the url
 *  (to offer a link the user can click). A tab the user closed meanwhile is their decision: no
 *  tab is opened again and nothing is reported. */
export function showInTab(tab: Window | null, url: string, onBlocked: (url: string) => void): void {
  if (!tab) onBlocked(url);
  else if (!tab.closed) tab.location.href = url;
}

/** Blob URLs handed out by pdfBlobUrl; one pagehide listener frees them all. They stay alive until
 *  then because a still-open preview tab may need its blob again (download, reload). */
const blobUrls = new Set<string>();
let freeOnPagehide = false;

/** A blob URL for the base64 bytes of a PDF, to show in a pending tab. The URL is freed when the
 *  page unloads. */
export function pdfBlobUrl(base64: string): string {
  const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
  const url = URL.createObjectURL(new Blob([bytes], { type: "application/pdf" }));
  blobUrls.add(url);
  if (!freeOnPagehide) {
    freeOnPagehide = true;
    window.addEventListener("pagehide", () => {
      for (const u of blobUrls) URL.revokeObjectURL(u);
      blobUrls.clear();
      freeOnPagehide = false;
    }, { once: true });
  }
  return url;
}
