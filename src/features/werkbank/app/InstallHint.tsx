import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";

const DISMISS_KEY = "werkbank.installHint.dismissed";

interface InstallPromptEvent extends Event { prompt: () => Promise<void> }

const isStandalone = () => {
  try { return window.matchMedia("(display-mode: standalone)").matches; } catch { return false; }
};
const isDismissed = () => {
  try { return localStorage.getItem(DISMISS_KEY) === "1"; } catch { return false; }
};
const isIos = () => /iPad|iPhone|iPod/.test(navigator.userAgent);

/** Dismissible card on the list: iOS gets the Add to Home Screen steps, other browsers the install
 *  prompt they offered through `beforeinstallprompt`. Hidden when installed or dismissed (a
 *  per-device flag; storage that throws just means it shows again). */
export function InstallHint() {
  const { t } = useTranslation("werkbank");
  const [hidden, setHidden] = useState(() => isStandalone() || isDismissed());
  const [prompt, setPrompt] = useState<InstallPromptEvent | null>(null);

  useEffect(() => {
    const onPrompt = (e: Event) => { e.preventDefault(); setPrompt(e as InstallPromptEvent); };
    window.addEventListener("beforeinstallprompt", onPrompt);
    return () => window.removeEventListener("beforeinstallprompt", onPrompt);
  }, []);

  const ios = isIos();
  if (hidden || (!ios && !prompt)) return null;

  const dismiss = () => {
    try { localStorage.setItem(DISMISS_KEY, "1"); } catch { /* storage unavailable: hidden for this visit only */ }
    setHidden(true);
  };
  const install = async () => {
    await prompt?.prompt();
    setPrompt(null);
  };

  return (
    <Card className="mb-4 p-4">
      <p className="m-0 text-body font-medium">{t("app.install.title")}</p>
      <p className="m-0 mt-1 text-control text-muted-foreground">{ios ? t("app.install.iosBody") : t("app.install.body")}</p>
      <div className="mt-3 flex gap-2">
        {!ios && <Button size="touch" onClick={() => void install()}>{t("app.install.button")}</Button>}
        <Button size="touch" variant="secondary" onClick={dismiss}>{t("app.install.dismiss")}</Button>
      </div>
    </Card>
  );
}
