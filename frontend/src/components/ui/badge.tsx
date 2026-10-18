import { cva, type VariantProps } from "class-variance-authority";
import type { ComponentProps } from "react";

import { cn } from "@/lib/utils";

// A status badge carries a square marker and a hard base in its colour; its text stays in the foreground colour,
// so the status hue never carries the text contrast.
const badgeVariants = cva(
  "inline-flex w-fit shrink-0 items-center gap-1.5 rounded-[3px] border-[1.5px] px-1.5 py-px font-mono text-xs leading-4 font-medium tracking-wide uppercase whitespace-nowrap [&_svg]:pointer-events-none [&_svg]:size-3 [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        neutral: "border-transparent bg-muted text-foreground",
        primary: "border-primary-shade bg-primary text-primary-foreground shadow-[0_2px_0_var(--primary-shade)]",
        success: "border-success bg-success-surface text-foreground shadow-[0_2px_0_var(--success)] before:size-1.5 before:bg-success before:content-['']",
        warning: "border-warning bg-warning-surface text-foreground shadow-[0_2px_0_var(--warning)] before:size-1.5 before:bg-warning before:content-['']",
        info: "border-info bg-info-surface text-foreground shadow-[0_2px_0_var(--info)] before:size-1.5 before:bg-info before:content-['']",
        destructive:
          "border-destructive bg-destructive-surface text-foreground shadow-[0_2px_0_var(--destructive)] before:size-1.5 before:bg-destructive before:content-['']",
        outline: "border-border bg-transparent text-foreground",
      },
    },
    defaultVariants: { variant: "neutral" },
  },
);

/** Render a short label (status, source, count) inline with text. */
function Badge({ className, variant, ...props }: ComponentProps<"span"> & VariantProps<typeof badgeVariants>) {
  return <span data-slot="badge" className={cn(badgeVariants({ variant }), className)} {...props} />;
}

export { Badge, badgeVariants };
