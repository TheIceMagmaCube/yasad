import type { ReactNode } from "react";

import { useStrings } from "../i18n/LocaleProvider";
import { Brand } from "./Brand";
import { PreferenceSelects } from "./PreferenceSelects";
import { LanguageSelect } from "./preferences/LanguageSelect";
import { SkipLink } from "./SkipLink";

type AuthLayoutProps = {
  /** Controls placed before the language choice at the top of the form column (sign-out, for instance). */
  actions?: ReactNode;
  children: ReactNode;
};

/**
 * Frame of the screens shown before the app opens (setup, sign-in, temporary password, unreachable server): skip
 * link, a narrow brand panel on the left (a top bar on small screens), then a column with the language choice at
 * the top, the content at a fixed distance from the top, and the appearance choice in the footer.
 */
export function AuthLayout({ actions, children }: AuthLayoutProps) {
  const m = useStrings();
  return (
    <div className="min-h-screen md:flex">
      <SkipLink />
      <header className="flex items-center gap-3 bg-header px-4 py-3 text-header-foreground md:w-72 md:shrink-0 md:flex-col md:items-start md:gap-6 md:p-10 lg:w-80">
        <Brand size="panel" />
        <p className="hidden text-sm text-header-muted md:block">{m.tagline}</p>
      </header>
      <div className="flex min-w-0 flex-1 flex-col">
        <div role="group" aria-label={m.preferences.label} className="flex flex-wrap items-center justify-end gap-2 px-4 pt-3 md:px-10 md:pt-6">
          {actions}
          <LanguageSelect variant="compact" />
        </div>
        <main id="content" tabIndex={-1} className="flex-1 px-4 py-6 outline-none md:px-10 md:pt-[10vh]">
          <div className="mx-auto w-full max-w-sm">{children}</div>
        </main>
        <footer className="px-4 pb-6 md:px-10">
          <div className="mx-auto w-full max-w-sm border-t pt-4">
            <PreferenceSelects language={false} />
          </div>
        </footer>
      </div>
    </div>
  );
}
