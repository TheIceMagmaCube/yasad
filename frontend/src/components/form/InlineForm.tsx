import { type ComponentProps, type KeyboardEvent, useEffect, useRef } from "react";

import { claimFocus } from "../../lib/focus";

/** First control of a form that can take the focus. */
const FIRST_CONTROL = "input:not([type=hidden]):not([disabled]), select:not([disabled]), textarea:not([disabled])";

type InlineFormProps = Omit<ComponentProps<"form">, "noValidate"> & {
  /** Close the form without saving: Cancel, or Escape when nothing inside handled it. */
  onCancel: () => void;
};

/** Render a form opened inside the page: its first field takes the focus on mount, and Escape cancels it. */
export function InlineForm({ onCancel, onKeyDown, children, ...props }: InlineFormProps) {
  const ref = useRef<HTMLFormElement>(null);
  useEffect(() => {
    const first = ref.current?.querySelector<HTMLElement>(FIRST_CONTROL);
    if (!first) return;
    first.focus();
    claimFocus();
  }, []);
  const handleKeyDown = (event: KeyboardEvent<HTMLFormElement>) => {
    onKeyDown?.(event);
    if (event.key !== "Escape" || event.defaultPrevented) return;
    event.preventDefault();
    onCancel();
  };
  return (
    <form ref={ref} noValidate onKeyDown={handleKeyDown} {...props}>
      {children}
    </form>
  );
}
