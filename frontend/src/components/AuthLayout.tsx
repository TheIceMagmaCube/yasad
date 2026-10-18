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

/**
 * Solid box over the pixel scene: text never sits on the artwork itself, so its contrast does not depend on it. The
 * night sky is as dark as the box, so its edge is drawn in header-active, which keeps 3:1 against the header.
 */
const PLATE = "rounded-lg border-2 border-header-active bg-header text-header-foreground";

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
        <div className={`${PLATE} flex max-w-full flex-col gap-3 p-2 pr-3 md:max-w-sm md:p-4 md:pr-6`}>
          <Brand size="panel" />
          <p className="hidden text-lg leading-snug text-header-muted md:block">{m.tagline}</p>
        </div>
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
