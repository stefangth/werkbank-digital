/** Safari lets a script open a tab only close to the click, so the tab is opened first and
 *  pointed at the PDF once the edge call returns. `noopener` cannot be passed here (the call
 *  would return null), so the back reference is cut by hand before the tab navigates. */
export function openPendingTab(): Window | null {
  const tab = window.open("", "_blank");
  if (tab) tab.opener = null;
  return tab;
}

/** Shows `url` in the pending tab; if the browser refused the tab, `onBlocked` gets the url
 *  (to offer a link the user can click). */
export function showInTab(tab: Window | null, url: string, onBlocked: (url: string) => void): void {
  if (tab && !tab.closed) tab.location.href = url;
  else onBlocked(url);
}
