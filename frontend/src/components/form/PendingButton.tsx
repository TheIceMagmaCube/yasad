import { type MouseEvent, useLayoutEffect, useRef } from "react";

import { Button, type ButtonProps } from "@/components/ui/button";

import { useAnnounceAfter } from "../../lib/announcer";

type PendingButtonProps = Omit<ButtonProps, "pending" | "pendingLabel" | "asChild"> & {
  pending: boolean;
  /** Progress text shown with a spinner while pending, and announced when the wait lasts over 400 ms. */
  pendingLabel: string;
};

/** Delay before a running action is announced: quicker ones stay silent. */
const ANNOUNCE_AFTER = 400;

/**
 * Render a button for an action that runs a request: it keeps the focus while pending, and ignores a second click
 * that arrives before the parent has marked it pending.
 */
export function PendingButton({ pending, pendingLabel, onClick, ...props }: PendingButtonProps) {
  const guard = useRef(false);
  const pendingNow = useRef(pending);
  useLayoutEffect(() => {
    pendingNow.current = pending;
    if (!pending) guard.current = false;
  }, [pending]);
  useAnnounceAfter(pending, pendingLabel, ANNOUNCE_AFTER);

  const handleClick = (event: MouseEvent<HTMLButtonElement>) => {
    if (guard.current) {
      event.preventDefault();
      return;
    }
    guard.current = true;
    // Released at once when the click started nothing (a local check failed); otherwise when pending ends.
    setTimeout(() => {
      if (!pendingNow.current) guard.current = false;
    }, 0);
    onClick?.(event);
  };
  return <Button {...props} pending={pending} pendingLabel={pendingLabel} onClick={handleClick} />;
}

/** Render the submit button of a form; see {@link PendingButton}. */
export function SubmitButton(props: Omit<PendingButtonProps, "type">) {
  return <PendingButton type="submit" {...props} />;
}
