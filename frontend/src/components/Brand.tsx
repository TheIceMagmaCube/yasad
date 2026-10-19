import { cn } from "@/lib/utils";

import { useInstance } from "../instance";
import { InstanceLogo } from "./InstanceLogo";
import { Link } from "./Link";

// An outline rather than a ring, so the focus stays visible in forced colors mode, which drops box shadows.
const BASE =
  "flex min-w-0 items-center rounded-md text-header-foreground outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-solid focus-visible:outline-header-foreground";

/**
 * Classes of each size: the header bar, or the sign over the pixel panel of the sign-in screens. In the header the
 * logo sits on a yellow key cap with a darker base, and the title carries the same hard gold step.
 */
const SIZES = {
  header: {
    root: "gap-2.5",
    tile: "pixel-corners flex size-9 shrink-0 items-center justify-center border-b-[3px] border-primary-shade bg-primary p-1.5 text-primary-foreground",
    logo: "size-full",
    title: "text-pixel text-lg leading-tight [text-shadow:0_2px_0_var(--primary-shade)]",
  },
  panel: { root: "gap-3 font-bold md:gap-4", tile: null, logo: "shrink-0 size-11 md:size-16", title: "wordmark text-3xl md:text-5xl" },
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
  const logo = <InstanceLogo className={classes.logo} />;
  return (
    <Link href={href} data-slot="brand" className={cn(BASE, classes.root, className)}>
      {classes.tile ? <span className={classes.tile}>{logo}</span> : logo}
      <span className={cn("truncate", classes.title)}>{title}</span>
    </Link>
  );
}
