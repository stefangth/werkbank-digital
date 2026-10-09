/** Stand-in for `virtual:pwa-register` under vitest, which runs without the PWA plugin. */
export function registerSW(): (reloadPage?: boolean) => Promise<void> {
  return async () => undefined;
}
