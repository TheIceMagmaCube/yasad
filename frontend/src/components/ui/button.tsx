import { cva, type VariantProps } from "class-variance-authority";
import { LoaderCircle } from "lucide-react";
import { Slot } from "radix-ui";
import type { ComponentProps, MouseEvent } from "react";

import { cn } from "@/lib/utils";

const variants = cva(
  "inline-flex shrink-0 items-center justify-center gap-2 rounded-md text-sm font-semibold whitespace-nowrap transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:pointer-events-none disabled:opacity-60 aria-disabled:cursor-not-allowed aria-disabled:opacity-60 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  {
    variants: {
      variant: {
        default: "bg-primary text-primary-foreground hover:bg-primary/90",
        secondary: "bg-secondary text-secondary-foreground hover:bg-secondary/80",
        outline: "border border-input bg-background hover:bg-accent hover:text-accent-foreground",
        ghost: "hover:bg-accent hover:text-accent-foreground",
        link: "text-foreground underline underline-offset-4 hover:no-underline",
        destructive: "bg-destructive text-destructive-foreground hover:bg-destructive/90",
        "destructive-ghost": "text-destructive hover:bg-destructive-surface",
      },
      size: {
        default: "h-10 px-4 py-2",
        sm: "h-9 px-3",
        icon: "size-10",
      },
    },
    defaultVariants: { variant: "default", size: "default" },
  },
);

/**
 * Return the button classes, the given `className` merged over the variant's.
 *
 * cva only appends it, and the stylesheet's order would then decide between conflicting utilities.
 */
function buttonVariants(props?: Parameters<typeof variants>[0]): string {
  return cn(variants(props));
}

type ButtonProps = ComponentProps<"button"> &
  VariantProps<typeof variants> & {
    asChild?: boolean;
    /**
     * Mark the action as running: the button keeps focus but ignores clicks and form submission. With
     * `asChild`, the child's own click handler is blocked too, and the children stay in place of `pendingLabel`.
     */
    pending?: boolean;
    /** Text shown with a spinner in place of the children while pending. */
    pendingLabel?: string;
  };

/**
 * Render a button.
 *
 * While `pending`, it carries aria-disabled instead of disabled, so focus stays on it.
 */
function Button({ className, variant, size, asChild = false, pending = false, pendingLabel, onClickCapture, children, ...props }: ButtonProps) {
  const Comp = asChild ? Slot.Root : "button";
  // Stopped in the capture phase, so neither the onClick handlers (a slotted child's included) nor the default action run.
  const handleClickCapture = (event: MouseEvent<HTMLButtonElement>) => {
    if (pending) {
      event.preventDefault();
      event.stopPropagation();
      return;
    }
    onClickCapture?.(event);
  };
  return (
    <Comp
      data-slot="button"
      className={buttonVariants({ variant, size, className })}
      aria-disabled={pending || undefined}
      {...props}
      onClickCapture={handleClickCapture}
    >
      {pending && pendingLabel && !asChild ? (
        <>
          <LoaderCircle aria-hidden="true" className="animate-spin motion-reduce:animate-none" />
          {pendingLabel}
        </>
      ) : (
        children
      )}
    </Comp>
  );
}

export { Button, buttonVariants };
export type { ButtonProps };
