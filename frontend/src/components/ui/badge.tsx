import { cva, type VariantProps } from "class-variance-authority";
import type { ComponentProps } from "react";

import { cn } from "@/lib/utils";

const badgeVariants = cva(
  "inline-flex w-fit shrink-0 items-center gap-1 rounded-md border px-2 py-0.5 text-xs font-medium whitespace-nowrap [&_svg]:pointer-events-none [&_svg]:size-3 [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        neutral: "border-transparent bg-muted text-foreground",
        primary: "border-transparent bg-primary text-primary-foreground",
        success: "border-success bg-success-surface text-foreground",
        warning: "border-warning bg-warning-surface text-foreground",
        info: "border-info bg-info-surface text-foreground",
        destructive: "border-destructive bg-destructive-surface text-foreground",
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
