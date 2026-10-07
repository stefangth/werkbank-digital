/** Safari lets a script open a tab only close to the click, so the tab is opened first and
 *  pointed at the PDF once the edge call returns. */
export function openPendingTab(): Window | null {
  return window.open("", "_blank");
}

/** Shows `url` in the pending tab; if the browser refused the tab, `onBlocked` gets the url
 *  (to offer a link the user can click). */
export function showInTab(tab: Window | null, url: string, onBlocked: (url: string) => void): void {
  if (tab && !tab.closed) tab.location.href = url;
  else onBlocked(url);
}
