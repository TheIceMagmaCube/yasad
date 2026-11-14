/**
 * A small picture of the page in one mode, drawn with the theme's own tokens: the element carries the theme and
 * the mode, so the token values are those of that mode whatever the page shows. Decorative.
 */
export function ThemeVignette({
  mode,
  theme,
}: {
  mode: "light" | "dark";
  theme: string;
}) {
  return (
    <span
      data-theme={theme}
      data-mode={mode}
      aria-hidden="true"
      className="flex h-full flex-1 flex-col gap-1 bg-background p-1.5"
    >
      <span className="h-2 rounded-[2px] bg-header" />
      <span className="flex flex-1 items-start gap-1 rounded-[2px] border border-border bg-card p-1">
        <span className="size-2 rounded-[1px] bg-primary" />
        <span className="mt-0.5 h-1 flex-1 rounded-full bg-muted-foreground opacity-60" />
      </span>
    </span>
  );
}
