import { cn } from "@/lib/utils";

/** Tone of the dot: a refusal (disabled, invisible to all), a point to check, or a plain fact (inactive). */
export type StateTone = "destructive" | "warning" | "muted";

const DOTS: Record<StateTone, string> = {
  destructive: "bg-destructive",
  warning: "bg-warning",
  muted: "bg-muted-foreground",
};

/**
 * Mark an abnormal state in a table cell: a dot and a word, never the colour alone. The word keeps the text colour,
 * so its contrast does not depend on the tone. Only for what is not normal: a row where all is well has no mark.
 */
export function StateMark({ tone, children, className }: { tone: StateTone; children: string; className?: string }) {
  return (
    <span data-slot="state-mark" className={cn("inline-flex items-start gap-1.5 text-sm", className)}>
      <span aria-hidden="true" className={cn("mt-1.5 size-2 shrink-0 rounded-full forced-colors:bg-[CanvasText]", DOTS[tone])} />
      <span>{children}</span>
    </span>
  );
}
