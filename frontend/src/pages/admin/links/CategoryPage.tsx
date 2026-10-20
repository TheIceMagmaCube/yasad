import { Trash2 } from "lucide-react";
import { type FormEvent, useState } from "react";

import { type AdminCategory, type AdminGroup, api, type CategoryInput, type EditWarning } from "../../../api";
import { AdminShell } from "../../../components/admin/AdminShell";
import { ConfirmPanel } from "../../../components/admin/ConfirmPanel";
import { ITEM_WIDTH, listHref, PaneDanger } from "../../../components/admin/DetailPage";
import { ErrorSummary } from "../../../components/form/ErrorSummary";
import { Field } from "../../../components/form/Field";
import { FormActions, FormStack } from "../../../components/form/FormLayout";
import { SubmitButton } from "../../../components/form/PendingButton";
import { Alert } from "../../../components/ui/alert";
import { Button } from "../../../components/ui/button";
import { useStrings } from "../../../i18n/LocaleProvider";
import { useFormErrors } from "../../../lib/form-errors";
import { groupRefLabel } from "../../../lib/group-ref";
import { RecentChanges } from "../history/RecentChanges";
import { GroupsChooser, refsWith, sameRefs } from "./GroupsChooser";
import { Current, currentOf, isManagedByFile, LIST, linksErrorText, Warnings } from "./item-edit";

type CategoryPageProps = {
  category: AdminCategory;
  groups: AdminGroup[];
  readOnly: boolean;
  onSaved: (category: AdminCategory) => void;
  onDeleted: (category: AdminCategory) => void;
  /** The server said CATALOG_FILE manages the catalog: the page turns read only. */
  onManaged: () => void;
  /** Warnings of the creation of this category. */
  warnings?: EditWarning[];
};

/**
 * Page of a category: title and groups, the warnings of the last save, the stored values after a conflict; delete at
 * the bottom, which names how many links go with it.
 */
export function CategoryPage({ category, groups, readOnly, onSaved, onDeleted, onManaged, warnings: initialWarnings = [] }: CategoryPageProps) {
  const m = useStrings();
  const s = m.links;
  const formId = `category-${category.id}-form`;
  const errors = useFormErrors<"title" | "groups">(["title", "groups"], formId);
  const [base, setBase] = useState(category);
  const [conflict, setConflict] = useState<AdminCategory | null>(null);
  const [title, setTitle] = useState(category.title);
  const [refs, setRefs] = useState(category.groups);
  const [other, setOther] = useState("");
  const [pending, setPending] = useState(false);
  const [warnings, setWarnings] = useState<EditWarning[]>(initialWarnings);
  const [confirm, setConfirm] = useState(false);

  /** Note a refusal that says the category changed meanwhile: the form now compares with, and overwrites, the stored one. */
  const adopt = (err: unknown) => {
    const current = currentOf<AdminCategory>(err);
    if (current) {
      setBase(current);
      setConflict(current);
    }
    if (isManagedByFile(err)) onManaged();
  };

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!errors.check({ title: title.trim() === "" && m.fieldErrors.required })) return;
    const groupsNow = refsWith(refs, other);
    const changes: Partial<CategoryInput> = {};
    if (title.trim() !== base.title) changes.title = title;
    if (!sameRefs(groupsNow, base.groups)) changes.groups = groupsNow;
    if (Object.keys(changes).length === 0) {
      errors.reset();
      setConflict(null);
      return;
    }
    setPending(true);
    try {
      const result = await api.updateCategory(base.id, base.revision, changes);
      errors.reset();
      setBase(result.category);
      setConflict(null);
      setOther("");
      setRefs(result.category.groups);
      setWarnings(result.warnings);
      onSaved(result.category);
    } catch (err) {
      adopt(err);
      if (currentOf(err)) errors.fail(s.conflict);
      else errors.failWith(err, { fallback: linksErrorText });
    } finally {
      setPending(false);
    }
  }

  const links = base.links.length;
  return (
    <AdminShell section="links" title={category.title} back={{ href: listHref(LIST), label: m.admin.backTo(s.title) }} subtitle={<p>{s.linkCount(links)}</p>}>
      <div className={`flex flex-col gap-10 ${ITEM_WIDTH}`}>
        {readOnly && <Alert variant="info">{s.managedByFile}</Alert>}
        <Warnings warnings={warnings} />
        <form id={formId} noValidate aria-label={category.title} onSubmit={submit}>
          <ErrorSummary errors={errors} labels={{ title: s.fields.title, groups: s.fields.groups }} />
          <div className="grid grid-cols-1 gap-x-12 gap-y-4 lg:grid-cols-2">
            <FormStack className="gap-4">
              <Field {...errors.field("title")} label={s.fields.title} required disabled={readOnly} autoComplete="off" value={title} onChange={(e) => setTitle(e.target.value)} />
              <Current value={conflict?.title} mine={title} />
            </FormStack>
            <FormStack className="gap-4">
              <GroupsChooser
                id={errors.fieldId("groups")}
                groups={groups}
                value={refs}
                onChange={setRefs}
                other={other}
                onOther={setOther}
                disabled={readOnly}
                after={conflict && !sameRefs(conflict.groups, refsWith(refs, other)) && <Current value={conflict.groups.map(groupRefLabel).join(", ") || s.noGroups} mine="" />}
              />
            </FormStack>
          </div>
          {!readOnly && (
            <FormActions className="mt-6">
              <SubmitButton pending={pending} pendingLabel={m.admin.saving}>
                {m.admin.save}
              </SubmitButton>
            </FormActions>
          )}
        </form>
        <RecentChanges type="category" id={category.id} scoped version={category} />
        {!readOnly && (
          <PaneDanger>
            {confirm ? (
              <ConfirmPanel
                question={s.deleteCategoryQuestion(base.title, links)}
                confirmLabel={m.admin.confirmDelete}
                pendingLabel={m.admin.deleting}
                onConfirm={async () => {
                  try {
                    await api.deleteCategory(base.id, base.revision, links);
                  } catch (err) {
                    // The question then names the link count as stored now, for a second confirmation.
                    adopt(err);
                    throw err;
                  }
                  onDeleted(base);
                }}
                onCancel={() => setConfirm(false)}
                errorText={(err) => linksErrorText(err, m)}
              />
            ) : (
              <div>
                <Button variant="destructive-ghost" onClick={() => setConfirm(true)}>
                  <Trash2 aria-hidden="true" />
                  {m.groups.deleteLabel(base.title)}
                </Button>
              </div>
            )}
          </PaneDanger>
        )}
      </div>
    </AdminShell>
  );
}
