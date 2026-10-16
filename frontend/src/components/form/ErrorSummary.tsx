import type { MouseEvent } from "react";

import { Alert } from "@/components/ui/alert";

import { useStrings } from "../../i18n/LocaleProvider";
import type { FormErrors } from "../../lib/form-errors";

/** Focus a field from the summary: scroll it into view, and select its text when it asks for it. */
function goToField(event: MouseEvent<HTMLAnchorElement>, id: string): void {
  event.preventDefault();
  const field = document.getElementById(id);
  if (!field) return;
  field.focus();
  field.scrollIntoView({ block: "center" });
  if (field instanceof HTMLInputElement && field.hasAttribute("data-select-on-error")) field.select();
}

/**
 * Render the error summary of a form: a focused alert titled with the problem, then a link to each field in
 * display order and the problems that belong to no field. Place it inside the form, before the first field.
 *
 * It takes the focus on every failure, even with the same text, since each one gives it a new key. With `labels`,
 * each field problem starts with the label of its field, so two links with the same problem still say where they
 * go.
 */
export function ErrorSummary<F extends string>({
  errors,
  labels,
  className,
}: {
  errors: FormErrors<F>;
  labels?: Partial<Record<F, string>>;
  className?: string;
}) {
  const m = useStrings();
  const { state, titleId, fieldId } = errors;
  if (!state) return null;
  const linked = [
    ...state.order.flatMap((f) => {
      const message = state.fields[f];
      if (!message) return [];
      return [{ field: f, message: labels?.[f] ? m.forms.fieldProblem(labels[f], message) : message }];
    }),
    // A link of its own already says which field it goes to.
    ...state.links,
  ];
  const hasItems = linked.length > 0 || state.extra.length > 0;
  return (
    <Alert key={state.key} variant="destructive" autoFocus title={state.title} titleId={titleId} className={className}>
      {hasItems && (
        <ul className="list-disc space-y-1 pl-5">
          {linked.map(({ field, message }) => (
            <li key={`${field}-${message}`}>
              <a href={`#${fieldId(field)}`} onClick={(e) => goToField(e, fieldId(field))} className="underline underline-offset-4 hover:no-underline">
                {message}
              </a>
            </li>
          ))}
          {state.extra.map((message) => (
            <li key={message}>{message}</li>
          ))}
        </ul>
      )}
    </Alert>
  );
}
