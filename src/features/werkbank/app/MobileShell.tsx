import type { ReactNode } from "react";
import { ChevronLeft, LogOut } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/features/auth/AuthContext";
import { useMyProfile } from "@/hooks/useMyProfile";
import { useCompanyProfile, useLogoUrl } from "../hooks/useCompanyProfile";

/** Phone-first frame of the technician app: company logo, user name and sign out on top, one
 *  narrow column below. No sidebar and no org switcher. `back` is the path of the parent page. */
export function MobileShell({ title, back, children }: { title?: string; back?: string; children: ReactNode }) {
  const { t } = useTranslation("werkbank");
  const { user, signOut } = useAuth();
  const company = useCompanyProfile();
  const logo = useLogoUrl(company.data?.logo_path);
  const profile = useMyProfile();
  const name = profile.data?.display_name || user?.email || t("app.unnamedUser");

  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="sticky top-0 z-10 border-b border-border bg-background">
        <div className="mx-auto flex max-w-screen-sm items-center gap-3 px-4 py-2">
          {logo.data && <img src={logo.data} alt="" className="h-8 w-auto max-w-[96px] object-contain" />}
          <span className="min-w-0 flex-1 truncate text-body">{name}</span>
          <Button variant="secondary" size="touch" onClick={() => void signOut()}>
            <LogOut aria-hidden="true" />
            {t("app.signOut")}
          </Button>
        </div>
      </header>
      <main className="mx-auto max-w-screen-sm px-4 pb-24 pt-4">
        {(back || title) && (
          <div className="mb-4 flex items-center gap-2">
            {back && (
              <Button asChild variant="secondary" size="touch">
                <Link to={back}>
                  <ChevronLeft aria-hidden="true" />
                  {t("app.back")}
                </Link>
              </Button>
            )}
            {title && <h1 className="m-0 text-title font-semibold">{title}</h1>}
          </div>
        )}
        {children}
      </main>
    </div>
  );
}
