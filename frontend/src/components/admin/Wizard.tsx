import { Check } from "lucide-react";
import { type ReactNode, useEffect, useId, useMemo, useRef, useState } from "react";

import { cn } from "@/lib/utils";

import { useStrings } from "../../i18n/LocaleProvider";
import { prepareFilter } from "../../lib/filter";
import { claimFocus } from "../../lib/focus";
import { CheckboxField } from "../ui/checkbox";
import { Input } from "../ui/input";
import { Label } from "../ui/label";

/** Ordered list of the steps of a wizard, as on the setup screen: done ones with a check, the current one marked. */
export function WizardSteps({ labels, current }: { labels: string[]; current: number }) {
  const w = useStrings().admin.wizard;
  return (
    <ol aria-label={w.progress} className="mb-8 flex flex-wrap gap-x-5 gap-y-2 text-sm">
      {labels.map((label, i) => (
        <li key={label} aria-current={i === current ? "step" : undefined} className={cn("flex items-center gap-2", i === current ? "font-semibold text-foreground" : "text-muted-foreground")}>
          <span
            aria-hidden="true"
            className={cn(
              "text-pixel pixel-corners flex size-7 shrink-0 items-center justify-center text-sm",
              i < current && "bg-success-surface text-success",
              i === current && "bg-primary text-primary-foreground shadow-[inset_0_0_0_2px_var(--control-primary-ring)]",
              i > current && "bg-muted text-muted-foreground",
            )}
          >
            {i < current ? <Check className="size-4" /> : i + 1}
          </span>
          <span>
            <span className="sr-only">{w.stepOf(i + 1, labels.length)}: </span>
            {label}
            {i < current && <span className="sr-only">, {w.done}</span>}
          </span>
        </li>
      ))}
    </ol>
  );
}

/**
 * Heading of the current step (h2); it takes the focus when the step changes, unless an error summary of the same
 * commit took it. The first step is reached by navigation, which focuses the page title.
 */
export function StepTitle({ step, children }: { step: number; children: ReactNode }) {
  const ref = useRef<HTMLHeadingElement>(null);
  const previous = useRef(step);
  useEffect(() => {
    if (previous.current === step) return;
    previous.current = step;
    ref.current?.focus();
    claimFocus();
  }, [step]);
  return (
    <h2 ref={ref} tabIndex={-1} className="text-title mb-5 outline-none">
      {children}
    </h2>
  );
}

/** Large radio cards for the first step: what to add. */
export function TypeChoice<T extends string>({ name, options, value, onChange }: { name: string; options: { value: T; label: string; hint: string }[]; value: T; onChange: (value: T) => void }) {
  return (
    <div className="grid max-w-xl grid-cols-1 gap-3 sm:grid-cols-2">
      {options.map((option) => (
        <label
          key={option.value}
          className="flex min-h-20 cursor-pointer items-start gap-3 rounded-(--radius-card) border-[1.5px] border-border bg-card p-4 text-card-foreground hover:bg-accent has-checked:border-foreground has-checked:shadow-[0_0_0_2px_var(--selected)] has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring has-[:focus-visible]:ring-offset-2 has-[:focus-visible]:ring-offset-background"
        >
          <input
            type="radio"
            name={name}
            value={option.value}
            checked={value === option.value}
            onChange={() => onChange(option.value)}
            className="mt-1 size-4 shrink-0 cursor-pointer accent-selected outline-none"
          />
          <span>
            <span className="block font-heading text-lg font-bold">{option.label}</span>
            <span className="block text-sm text-muted-foreground">{option.hint}</span>
          </span>
        </label>
      ))}
    </div>
  );
}

/**
 * Every item as a check box, in two columns from sm, with a filter field above it once the list is long. Nothing
 * needs typing: the filter only narrows a list that is shown in full.
 */
export function CheckList<T extends { id: string }>({
  legend,
  items,
  labelOf,
  hintOf,
  checked,
  onToggle,
  busy,
}: {
  legend: string;
  items: T[];
  labelOf: (item: T) => string;
  hintOf?: (item: T) => string;
  checked: ReadonlySet<string>;
  onToggle: (item: T, checked: boolean) => void;
  busy?: ReadonlySet<string>;
}) {
  const w = useStrings().admin.wizard;
  const id = useId();
  const [query, setQuery] = useState("");
  const filter = useMemo(() => prepareFilter(items, (item) => [labelOf(item), hintOf?.(item) ?? ""]), [items, labelOf, hintOf]);
  const shown = filter(query);
  return (
    <fieldset className="flex flex-col gap-2">
      <legend className="sr-only">{legend}</legend>
      {items.length > 8 && (
        <div className="mb-1 flex max-w-sm flex-col gap-1.5">
          <Label htmlFor={`${id}-filter`}>{w.filter}</Label>
          <Input id={`${id}-filter`} type="search" autoComplete="off" value={query} onChange={(e) => setQuery(e.target.value)} />
        </div>
      )}
      {items.length === 0 ? (
        <p className="text-muted-foreground">{w.none}</p>
      ) : (
        <ul className="grid grid-cols-1 gap-x-6 sm:grid-cols-2">
          {shown.map((item) => (
            <li key={item.id}>
              <CheckboxField
                label={labelOf(item)}
                hint={hintOf?.(item)}
                checked={checked.has(item.id)}
                aria-busy={busy?.has(item.id) || undefined}
                onChange={(e) => {
                  if (busy?.has(item.id)) return;
                  onToggle(item, e.target.checked);
                }}
              />
            </li>
          ))}
        </ul>
      )}
    </fieldset>
  );
}

/** Lines of a summary before creating: a label and its value per line. */
export function Recap({ rows }: { rows: [string, ReactNode][] }) {
  return (
    <dl className="mb-6 grid max-w-xl grid-cols-1 gap-x-6 gap-y-1 border-y border-border py-3 sm:grid-cols-[10rem_minmax(0,1fr)] sm:gap-y-3">
      {rows.map(([label, value]) => (
        <div key={label} className="contents">
          <dt className="text-sm text-muted-foreground">{label}</dt>
          <dd className="mb-2 wrap-anywhere sm:mb-0">{value}</dd>
        </div>
      ))}
    </dl>
  );
}
