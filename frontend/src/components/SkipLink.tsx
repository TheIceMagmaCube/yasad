import { cn } from "@/lib/utils";

import { useStrings } from "../i18n/LocaleProvider";

/**
 * Render a skip link, hidden until focused, pointing at the element with id `target`. `label` defaults to "Skip to
 * content". `inline` shows the focused link in place, for one inside a section, instead of fixed at the top left.
 */
export function SkipLink({ target = "content", label, inline = false }: { target?: string; label?: string; inline?: boolean }) {
  const m = useStrings();
  return (
    <a
      href={`#${target}`}
      className={cn(
        "sr-only rounded-md bg-background px-4 py-2 text-foreground focus:not-sr-only focus:z-50 focus:ring-2 focus:ring-ring",
        inline ? "focus:mb-3 focus:inline-block" : "focus:fixed focus:top-2 focus:left-2",
      )}
    >
      {label ?? m.skipToContent}
    </a>
  );
}
