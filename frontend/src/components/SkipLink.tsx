import { useStrings } from "../i18n/LocaleProvider";

/** Render the "Skip to content" link, hidden until focused, pointing at the element with id `target`. */
export function SkipLink({ target = "content" }: { target?: string }) {
  const m = useStrings();
  return (
    <a
      href={`#${target}`}
      className="sr-only rounded-md bg-background px-4 py-2 text-foreground focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-50 focus:ring-2 focus:ring-ring"
    >
      {m.skipToContent}
    </a>
  );
}
