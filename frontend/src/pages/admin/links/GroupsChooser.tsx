import type { ReactNode } from "react";

import type { AdminGroup, GroupSource } from "../../../api";
import { StateMark } from "../../../components/admin/StateMark";
import { Field } from "../../../components/form/Field";
import { CheckboxField } from "../../../components/ui/checkbox";
import { useStrings } from "../../../i18n/LocaleProvider";
import { groupRefLabel, groupRefOf, neverReceived, parseGroupRef } from "../../../lib/group-ref";

const SOURCES: GroupSource[] = ["system", "local", "oidc"];

type GroupsChooserProps = {
  id: string;
  groups: AdminGroup[];
  value: string[];
  onChange: (refs: string[]) => void;
  /** The provider group typed in the last field, not one of `value` until saved. */
  other: string;
  onOther: (name: string) => void;
  disabled: boolean;
  /** Shown after the check boxes: the stored groups after a conflict. */
  after?: ReactNode;
};

/**
 * Choose the groups of a category or a link: the existing groups by origin as check boxes, a reference the form holds
 * that no group matches yet (a provider group nobody has signed in with) checked in its section, and a field for
 * another provider group.
 */
export function GroupsChooser({ id, groups, value, onChange, other, onOther, disabled, after }: GroupsChooserProps) {
  const s = useStrings().links;
  const known = groups.map(groupRefOf);
  // A provider group only typed, never received in a sign-in: a typo in its name looks the same, so it is pointed out.
  const unseen = new Set([...groups.filter(neverReceived).map(groupRefOf), ...value.filter((ref) => ref.startsWith("oidc:") && !known.includes(ref))]);
  const refs = [...known, ...value.filter((ref) => !known.includes(ref))];
  return (
    <fieldset id={id} tabIndex={-1} className="flex flex-col gap-2 outline-none" disabled={disabled}>
      <legend className="mb-1 font-heading text-sm font-bold">{s.fields.groups}</legend>
      <p className="text-sm text-muted-foreground">{s.fields.groupsHint}</p>
      {SOURCES.map((source) => {
        const here = refs.filter((ref) => parseGroupRef(ref).source === source);
        if (here.length === 0) return null;
        return (
          <div key={source}>
            <p className="text-caption mt-2 text-muted-foreground">{s.groupSections[source]}</p>
            <ul className="grid grid-cols-1 gap-x-4 sm:grid-cols-2">
              {here.map((ref) => (
                <li key={ref}>
                  <CheckboxField
                    label={
                      unseen.has(ref) ? (
                        <>
                          {groupRefLabel(ref)}{" "}
                          <StateMark tone="warning" className="ml-1 align-top font-sans font-normal">
                            {s.unknownMembers}
                          </StateMark>
                        </>
                      ) : (
                        groupRefLabel(ref)
                      )
                    }
                    checked={value.includes(ref)}
                    onChange={(e) => onChange(e.target.checked ? [...value, ref] : value.filter((r) => r !== ref))}
                  />
                </li>
              ))}
            </ul>
          </div>
        );
      })}
      {after}
      <Field id={`${id}-other`} label={s.fields.otherOidc} autoComplete="off" value={other} onChange={(e) => onOther(e.target.value)} />
    </fieldset>
  );
}

/** Return the references of the chooser and the other provider group typed, without duplicates. */
export function refsWith(groups: string[], other: string): string[] {
  const name = other.trim();
  return name ? [...new Set([...groups, `oidc:${name}`])] : groups;
}

/** Return whether two lists of references hold the same groups, in any order. */
export function sameRefs(a: string[], b: string[]): boolean {
  return [...a].sort().join("\n") === [...b].sort().join("\n");
}
