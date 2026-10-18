import { cn } from "@/lib/utils";

import { useInstance } from "../instance";
import { InstanceLogo } from "./InstanceLogo";
import { Link } from "./Link";

const BASE =
  "flex min-w-0 items-center rounded-md text-header-foreground outline-none focus-visible:ring-2 focus-visible:ring-header-foreground focus-visible:ring-offset-2 focus-visible:ring-offset-header";

/**
 * Classes of each size: the header bar, or the sign of the sign-in panel. The tile is a key cap (a darker yellow
 * base under the logo) and the title carries the same hard gold shadow, the "slightly 3D" of the portfolio.
 */
const SIZES = {
  header: {
    root: "gap-2.5",
    tile: "size-9 border-b-[3px] p-1.5",
    title: "text-lg [text-shadow:0_2px_0_var(--primary-shade)]",
  },
  panel: {
    root: "gap-3",
    tile: "size-10 border-b-[3px] p-1.5 md:size-12 md:border-b-4 md:p-2",
    title: "text-2xl md:text-3xl [text-shadow:0_2px_0_var(--primary-shade)] md:[text-shadow:0_3px_0_var(--primary-shade)]",
  },
} as const;

type BrandProps = {
  size?: keyof typeof SIZES;
  /** Target of the link. */
  href?: string;
  className?: string;
};

/** Render the instance logo and title as a link to the home page, sized for the header bar or the sign-in panel. */
export function Brand({ size = "header", href = "/", className }: BrandProps) {
  const { title } = useInstance();
  const classes = SIZES[size];
  return (
    <Link href={href} data-slot="brand" className={cn(BASE, classes.root, className)}>
      <span className={cn("pixel-corners flex shrink-0 items-center justify-center border-primary-shade bg-primary text-primary-foreground", classes.tile)}>
        <InstanceLogo className="size-full" />
      </span>
      <span className={cn("text-pixel truncate leading-tight", classes.title)}>{title}</span>
    </Link>
  );
}
