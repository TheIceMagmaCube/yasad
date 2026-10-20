import { Trash2 } from "lucide-react";
import { type FormEvent, useState } from "react";

import { type AdminCategory, type AdminGroup, type AdminLink, api, type EditWarning, type LinkInput } from "../../../api";
import { AdminShell } from "../../../components/admin/AdminShell";
import { ConfirmPanel } from "../../../components/admin/ConfirmPanel";
import { ITEM_WIDTH, listHref, PaneDanger } from "../../../components/admin/DetailPage";
import { ErrorSummary } from "../../../components/form/ErrorSummary";
import { Field } from "../../../components/form/Field";
import { FormActions, FormStack } from "../../../components/form/FormLayout";
import { SubmitButton } from "../../../components/form/PendingButton";
import { SelectField } from "../../../components/form/SelectField";
import { Alert } from "../../../components/ui/alert";
import { Button } from "../../../components/ui/button";
import { CheckboxField } from "../../../components/ui/checkbox";
import { useStrings } from "../../../i18n/LocaleProvider";
import { useFormErrors } from "../../../lib/form-errors";
import { groupRefLabel } from "../../../lib/group-ref";
import { RecentChanges } from "../history/RecentChanges";
import { GroupsChooser, refsWith, sameRefs } from "./GroupsChooser";
import { Current, currentOf, isManagedByFile, LIST, linksErrorText, Warnings } from "./item-edit";

type LinkField = "title" | "url" | "description" | "icon" | "keywords" | "groups" | "categoryId" | "active";
const LINK_FIELDS = ["title", "url", "description", "icon", "keywords", "groups", "categoryId", "active"] as const;

/** Return the keywords typed in the field, comma separated, without empty ones. */
export function keywordsOf(text: string): string[] {
  return text
    .split(",")
    .map((k) => k.trim())
    .filter(Boolean);
}

type LinkPageProps = {
  link: AdminLink;
  categories: AdminCategory[];
  groups: AdminGroup[];
  readOnly: boolean;
  onSaved: (link: AdminLink) => void;
  onDeleted: (link: AdminLink) => void;
  /** The server said CATALOG_FILE manages the catalog: the page turns read only. */
  onManaged: () => void;
  /** Warnings of the creation of this link. */
  warnings?: EditWarning[];
};

/**
 * Page of a link: every field in one form, the warnings of the last save, and after a conflict the stored value under
 * each field that differs. Saving again then replaces the stored version, knowingly. Delete at the bottom.
 */
export function LinkPage({ link, categories, groups, readOnly, onSaved, onDeleted, onManaged, warnings: initialWarnings = [] }: LinkPageProps) {
  const m = useStrings();
  const s = m.links;
  const formId = `link-${link.id}-form`;
  const errors = useFormErrors<LinkField>(LINK_FIELDS, formId);
  // The stored link the form compares with and whose revision it sends: as opened, then the current one after a conflict.
  const [base, setBase] = useState(link);
  const [conflict, setConflict] = useState<AdminLink | null>(null);
  const [title, setTitle] = useState(link.title);
  const [url, setUrl] = useState(link.url);
  const [description, setDescription] = useState(link.description);
  const [icon, setIcon] = useState(link.icon ?? "");
  const [keywords, setKeywords] = useState(link.keywords.join(", "));
  const [refs, setRefs] = useState(link.groups);
  const [other, setOther] = useState("");
  const [categoryId, setCategoryId] = useState(link.categoryId);
  const [active, setActive] = useState(link.active);
  const [pending, setPending] = useState(false);
  const [warnings, setWarnings] = useState<EditWarning[]>(initialWarnings);
  const [confirm, setConfirm] = useState(false);

  /** Note a refusal that says the link changed meanwhile: the form now compares with, and overwrites, the stored one. */
  const adopt = (err: unknown) => {
    const current = currentOf<AdminLink>(err);
    if (current) {
      setBase(current);
      setConflict(current);
    }
    if (isManagedByFile(err)) onManaged();
  };

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!errors.check({ title: title.trim() === "" && m.fieldErrors.required, url: url.trim() === "" && m.fieldErrors.required })) return;
    const values = { title, url, description, icon: icon.trim() || null, keywords: keywordsOf(keywords), groups: refsWith(refs, other), categoryId, active };
    // Only what changed is sent: a field someone else changed meanwhile, and this form did not touch, stays theirs.
    const changes: Partial<LinkInput> = {};
    if (values.title.trim() !== base.title) changes.title = values.title;
    if (values.url.trim() !== base.url) changes.url = values.url;
    if (values.description.trim() !== base.description) changes.description = values.description;
    if (values.icon !== base.icon) changes.icon = values.icon;
    if (values.keywords.join("\n") !== base.keywords.join("\n")) changes.keywords = values.keywords;
    if (!sameRefs(values.groups, base.groups)) changes.groups = values.groups;
    if (values.categoryId !== base.categoryId) changes.categoryId = values.categoryId;
    if (values.active !== base.active) changes.active = values.active;
    if (Object.keys(changes).length === 0) {
      errors.reset();
      setConflict(null);
      return;
    }
    setPending(true);
    try {
      const result = await api.updateLink(base.id, base.revision, changes);
      errors.reset();
      setBase(result.link);
      setConflict(null);
      setOther("");
      setRefs(result.link.groups);
      setWarnings(result.warnings);
      onSaved(result.link);
    } catch (err) {
      adopt(err);
      if (currentOf(err)) errors.fail(s.conflict);
      else errors.failWith(err, { fallback: linksErrorText });
    } finally {
      setPending(false);
    }
  }

  const labels = {
    title: s.fields.title,
    url: s.fields.url,
    description: s.fields.description,
    icon: s.fields.icon,
    keywords: s.fields.keywords,
    groups: s.fields.groups,
    categoryId: s.fields.category,
    active: s.fields.active,
  };
  const categoryTitle = (id: string) => categories.find((c) => c.id === id)?.title ?? id;

  return (
    <AdminShell section="links" title={link.title} back={{ href: listHref(LIST), label: m.admin.backTo(s.title) }} subtitle={<p className="wrap-anywhere">{link.url}</p>}>
      <div className={`flex flex-col gap-10 ${ITEM_WIDTH}`}>
        {readOnly && <Alert variant="info">{s.managedByFile}</Alert>}
        <Warnings warnings={warnings} />
        <form id={formId} noValidate aria-label={link.title} onSubmit={submit}>
          <ErrorSummary errors={errors} labels={labels} />
          <div className="grid grid-cols-1 gap-x-12 gap-y-4 lg:grid-cols-2">
            <FormStack className="gap-4">
              <Field {...errors.field("title")} label={s.fields.title} required disabled={readOnly} autoComplete="off" value={title} onChange={(e) => setTitle(e.target.value)} />
              <Current value={conflict?.title} mine={title} />
              <Field {...errors.field("url")} label={s.fields.url} type="url" required disabled={readOnly} autoComplete="off" value={url} onChange={(e) => setUrl(e.target.value)} />
              <Current value={conflict?.url} mine={url} />
              <Field {...errors.field("description")} label={s.fields.description} disabled={readOnly} autoComplete="off" value={description} onChange={(e) => setDescription(e.target.value)} />
              <Current value={conflict?.description} mine={description} />
              <Field
                {...errors.field("icon")}
                label={s.fields.icon}
                hint={s.fields.iconHint}
                disabled={readOnly}
                autoComplete="off"
                spellCheck={false}
                inputClassName="font-mono"
                value={icon}
                onChange={(e) => setIcon(e.target.value)}
              />
              <Current value={conflict ? (conflict.icon ?? "") : undefined} mine={icon} />
              <Field {...errors.field("keywords")} label={s.fields.keywords} hint={s.fields.keywordsHint} disabled={readOnly} autoComplete="off" value={keywords} onChange={(e) => setKeywords(e.target.value)} />
              <Current value={conflict?.keywords.join(", ")} mine={keywordsOf(keywords).join(", ")} />
            </FormStack>
            <FormStack className="gap-4">
              <SelectField {...errors.field("categoryId")} label={s.fields.category} disabled={readOnly} value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
                {categories.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.title}
                  </option>
                ))}
              </SelectField>
              <Current value={conflict ? categoryTitle(conflict.categoryId) : undefined} mine={categoryTitle(categoryId)} />
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
              <CheckboxField id={errors.fieldId("active")} label={s.fields.active} hint={s.fields.activeHint} disabled={readOnly} checked={active} onChange={(e) => setActive(e.target.checked)} />
              {conflict && conflict.active !== active && <Current value={conflict.active ? s.fields.active : s.states.inactive} mine="" />}
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
        <RecentChanges type="link" id={link.id} scoped version={link} />
        {!readOnly && (
          <PaneDanger>
            {confirm ? (
              <ConfirmPanel
                question={s.deleteLinkQuestion(base.title)}
                confirmLabel={m.admin.confirmDelete}
                pendingLabel={m.admin.deleting}
                onConfirm={async () => {
                  try {
                    await api.deleteLink(base.id, base.revision);
                  } catch (err) {
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
