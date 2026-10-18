import type { ReactNode } from "react";

import { useStrings } from "../i18n/LocaleProvider";
import { Brand } from "./Brand";
import { PixelScene } from "./PixelScene";
import { PreferenceSelects } from "./PreferenceSelects";
import { SkipLink } from "./SkipLink";

type AuthLayoutProps = {
  /** Controls placed before the language and appearance choices at the top of the form column (sign-out, for instance). */
  actions?: ReactNode;
  children: ReactNode;
};

/** Solid sign over the pixel scene: text never sits on the artwork itself, so its contrast does not depend on it. */
const PLATE = "pixel-corners border-2 border-header-border bg-header text-header-foreground";

/** Give the small controls at the top of the column a 44 px target. */
const TARGETS = "[&_:is(button,select)]:h-11";

/**
 * Frame of the screens shown before the app opens (setup, sign-in, signed out, temporary password, unreachable
 * server): skip link, a pixel-art panel with the brand and the tagline on solid signs (a short strip on small
 * screens), then a column with the actions and the language and appearance choices at the top, and the content below.
 */
export function AuthLayout({ actions, children }: AuthLayoutProps) {
  const m = useStrings();
  return (
    <div className="min-h-screen md:grid md:grid-cols-[minmax(20rem,55%)_1fr] lg:grid-cols-[60%_1fr]">
      <SkipLink />
      <header className="relative isolate flex h-32 flex-col items-start justify-between overflow-hidden bg-header p-3 md:sticky md:top-0 md:h-screen md:p-8">
        <PixelScene className="absolute inset-0 -z-10" />
        <div className={`${PLATE} max-w-full p-2 pr-3 md:p-3 md:pr-5`}>
          <Brand size="panel" />
        </div>
        <p className={`${PLATE} text-pixel hidden max-w-xs px-4 py-3 text-lg leading-snug md:block`}>{m.tagline}</p>
      </header>
      <div className="flex min-w-0 flex-col">
        <div className={`flex flex-wrap items-center justify-end gap-3 px-4 pt-3 md:px-10 md:pt-6 ${TARGETS}`}>
          {actions}
          <PreferenceSelects />
        </div>
        <main id="content" tabIndex={-1} className="flex-1 px-4 py-6 outline-none md:px-10 md:pt-[8vh]">
          <div className="mx-auto w-full max-w-sm">{children}</div>
        </main>
      </div>
    </div>
  );
}
