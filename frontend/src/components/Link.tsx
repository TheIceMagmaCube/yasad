import type { ComponentProps, MouseEvent } from "react";

import { navigate } from "../lib/router";

/** Return true when the click should stay in the app: plain left click, same origin, current tab, no download. */
function isClientNavigation(e: MouseEvent<HTMLAnchorElement>): boolean {
  if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return false;
  const a = e.currentTarget;
  if ((a.target && a.target !== "_self") || a.hasAttribute("download")) return false;
  const url = new URL(a.href, location.href);
  if (url.origin !== location.origin) return false;
  return !(url.pathname === location.pathname && url.search === location.search && url.hash !== "");
}

/** Anchor that navigates inside the app on a plain click and keeps the browser behaviour otherwise. */
export function Link({ onClick, ...props }: ComponentProps<"a"> & { href: string }) {
  return (
    <a
      {...props}
      onClick={(e) => {
        onClick?.(e);
        if (!isClientNavigation(e)) return;
        e.preventDefault();
        const url = new URL(e.currentTarget.href, location.href);
        navigate(url.pathname + url.search + url.hash);
      }}
    />
  );
}
