import { Trash2 } from "lucide-react";
import { type FormEvent, type ReactNode, useState } from "react";

import { type AdminCategory, type AdminGroup, type AdminLink, ApiError, api, type EditWarning, type GroupSource, type LinkInput } from "../../../api";
import { ConfirmPanel } from "../../../components/admin/ConfirmPanel";
import { AdminShell } from "../../../components/admin/AdminShell";
import { listHref, PaneDanger } from "../../../components/admin/DetailPage";
import { StateMark } from "../../../components/admin/StateMark";
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
import { groupRefLabel, groupRefOf, neverReceived, parseGroupRef } from "../../../lib/group-ref";
import { adminErrorText } from "../shared";

const LIST = "/admin/links";

/** Return the item an `item_changed` refusal carries, as stored now; null for any other error. */
function currentOf<T>(err: unknown): T | null {
  if (!(err instanceof ApiError) || err.body.code !== "item_changed") return null;
  return ((err.body as unknown as { current?: T }).current ?? null) as T | null;
}

/** Render the stored value of a field under it after a conflict, when it differs from what the form holds. */
function Current({ value, mine }: { value: string | undefined; mine: string }) {
  const m = useStrings();
  if (value === undefined || value === mine) return null;
  return <p className="-mt-2 text-sm text-warning-foreground">{m.links.current(value === "" ? m.links.empty : value)}</p>;
}

/** Render the warnings of a write that went through. */
export function Warnings({ warnings }: { warnings: EditWarning[] }) {
  const m = useStrings();
  if (warnings.length === 0) return null;
  return (
    <Alert variant="warning">
      <ul className="flex flex-col gap-1">
        {warnings.map((w) => (
          <li key={w}>{m.links.warnings[w]}</li>
        ))}
      </ul>
    </Alert>
  );
}

const SOURCES: GroupSource[] = ["system", "local", "oidc"];

/**
 * Choose the groups of a category or a link: the existing groups by origin as check boxes, a reference the form holds
 * that no group matches yet (a provider group nobody has signed in with) checked in its section, and a field for
 * another provider group.
 */
export function GroupsChooser({ id, groups, value, onChange, other, onOther, disabled, after }: {
  id: string;
  groups: AdminGroup[];
  value: string[];
  onChange: (refs: string[]) => void;
  other: string;
  onOther: (name: string) => void;
  disabled: boolean;
  after?: ReactNode;
}) {
  const m = useStrings();
  const s = m.links;
  const known = groups.map(groupRefOf);
  // A provider group only typed, never received in a sign-in: a typo in its name looks the same, so it is pointed out.
  const unseen = new Set([
    ...groups.filter(neverReceived).map(groupRefOf),
    ...value.filter((ref) => ref.startsWith("oidc:") && !known.includes(ref)),
  ]);
  const refs = [...known, ...value.filter((ref) => !known.includes(ref))];
  return (
    <fieldset id={id} className="flex flex-col gap-2" disabled={disabled}>
      <legend className="mb-1 text-sm font-semibold">{s.fields.groups}</legend>
      {s.fields.groupsHint && <p className="text-sm text-muted-foreground">{s.fields.groupsHint}</p>}
      {SOURCES.map((source) => {
        const here = refs.filter((ref) => parseGroupRef(ref).source === source);
        if (here.length === 0) return null;
        return (
          <div key={source}>
            <p className="text-caption mt-2 text-muted-foreground">{s.groupSections[source]}</p>
            <ul className="grid grid-cols-2 gap-x-4">
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
      <Field id={`${id}-other`} label={s.fields.otherOidc} hint={s.fields.otherOidcHint} autoComplete="off" value={other} onChange={(e) => onOther(e.target.value)} />
    </fieldset>
  );
}

/** Return the references of the chooser and the other provider group typed, without duplicates. */
export function refsWith(groups: string[], other: string): string[] {
  const name = other.trim();
  return name ? [...new Set([...groups, `oidc:${name}`])] : groups;
}

type LinkField = "title" | "url" | "description" | "icon" | "keywords" | "groups" | "categoryId" | "active";
const LINK_FIELDS = ["title", "url", "description", "icon", "keywords", "groups", "categoryId", "active"] as const;

type LinkPaneProps = {
  /** The link to change; null to create one. */
  link: AdminLink | null;
  categories: AdminCategory[];
  groups: AdminGroup[];
  readOnly: boolean;
  onClose: () => void;
  onSaved: (link: AdminLink, created: boolean, warnings: EditWarning[]) => void;
  onDeleted: (link: AdminLink) => void;
  /** Warnings of the creation that opened this pane. */
  warnings?: EditWarning[];
};

/** Detail of a link, or the form of a new one: every field, the warnings after a save, a conflict per field, delete at the bottom. */
export function LinkPane({ link, categories, groups, readOnly, onClose, onSaved, onDeleted, warnings: initialWarnings = [] }: LinkPaneProps) {
  const m = useStrings();
  const s = m.links;
  const formId = link ? `link-${link.id}-form` : "links-new-form";
  const errors = useFormErrors<LinkField>(LINK_FIELDS, formId);
  // The stored link the form compares with: as opened, then the current one after a conflict.
  const [base, setBase] = useState(link);
  const [conflict, setConflict] = useState<AdminLink | null>(null);
  const [title, setTitle] = useState(link?.title ?? "");
  const [url, setUrl] = useState(link?.url ?? "https://");
  const [description, setDescription] = useState(link?.description ?? "");
  const [icon, setIcon] = useState(link?.icon ?? "");
  const [keywords, setKeywords] = useState(link?.keywords.join(", ") ?? "");
  const [refs, setRefs] = useState(link?.groups ?? []);
  const [other, setOther] = useState("");
  const [categoryId, setCategoryId] = useState(link?.categoryId ?? categories[0]?.id ?? "");
  const [active, setActive] = useState(link?.active ?? true);
  const [pending, setPending] = useState(false);
  const [warnings, setWarnings] = useState<EditWarning[]>(initialWarnings);
  const [confirm, setConfirm] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!errors.check({ title: title.trim() === "" && m.fieldErrors.required, url: url.trim() === "" && m.fieldErrors.required })) return;
    const values: LinkInput = {
      title,
      url,
      description,
      icon: icon.trim() || null,
      keywords: keywords.split(",").map((k) => k.trim()).filter(Boolean),
      groups: refsWith(refs, other),
      categoryId,
      active,
    };
    setPending(true);
    try {
      if (!base) {
        const { icon: chosen, ...rest } = values;
        const result = await api.createLink(chosen ? { ...rest, icon: chosen } : rest);
        onSaved(result.link, true, result.warnings);
        return;
      }
      const changes: Partial<LinkInput> = {};
      if (values.title.trim() !== base.title) changes.title = values.title;
      if (values.url.trim() !== base.url) changes.url = values.url;
      if (values.description!.trim() !== base.description) changes.description = values.description;
      if (values.icon !== base.icon) changes.icon = values.icon;
      if (values.keywords!.join("\n") !== base.keywords.join("\n")) changes.keywords = values.keywords;
      if ([...values.groups].sort().join("\n") !== [...base.groups].sort().join("\n")) changes.groups = values.groups;
      if (values.categoryId !== base.categoryId) changes.categoryId = values.categoryId;
      if (values.active !== base.active) changes.active = values.active;
      if (Object.keys(changes).length === 0) return;
      const result = await api.updateLink(base.id, base.revision, changes);
      setBase(result.link);
      setConflict(null);
      setOther("");
      setRefs(result.link.groups);
      setWarnings(result.warnings);
      onSaved(result.link, false, result.warnings);
    } catch (err) {
      const current = currentOf<AdminLink>(err);
      if (current) {
        setConflict(current);
        setBase(current);
        errors.fail(s.conflict);
      } else errors.failWith(err, { fallback: adminErrorText });
    } finally {
      setPending(false);
    }
  }

  const labels = { title: s.fields.title, url: s.fields.url, description: s.fields.description, icon: s.fields.icon, keywords: s.fields.keywords, groups: s.fields.groups, categoryId: s.fields.category, active: s.fields.active };

  return (
    <AdminShell
      section="links"
      title={link ? link.title : s.newLink}
      back={{ href: listHref(LIST), label: m.admin.backTo(s.title) }}
      subtitle={link ? <p className="wrap-anywhere">{link.url}</p> : undefined}
    >
      <div className="flex flex-col gap-10">
      {readOnly && <Alert variant="info">{s.managedByFile}</Alert>}
      <Warnings warnings={warnings} />
      <form id={formId} noValidate aria-label={link ? link.title : s.newLink} onSubmit={submit}>
        <ErrorSummary errors={errors} labels={labels} />
        <div className="grid grid-cols-1 gap-x-12 gap-y-4 lg:grid-cols-2">
        <FormStack className="gap-4">
          <Field {...errors.field("title")} label={s.fields.title} required disabled={readOnly} autoComplete="off" value={title} onChange={(e) => setTitle(e.target.value)} />
          <Current value={conflict?.title} mine={title} />
          <Field {...errors.field("url")} label={s.fields.url} type="url" required disabled={readOnly} autoComplete="off" value={url} onChange={(e) => setUrl(e.target.value)} />
          <Current value={conflict?.url} mine={url} />
          <Field {...errors.field("description")} label={s.fields.description} disabled={readOnly} autoComplete="off" value={description} onChange={(e) => setDescription(e.target.value)} />
          <Current value={conflict?.description} mine={description} />
          <Field {...errors.field("icon")} label={s.fields.icon} hint={s.fields.iconHint} disabled={readOnly} autoComplete="off" spellCheck={false} value={icon} onChange={(e) => setIcon(e.target.value)} inputClassName="font-mono" />
          <Current value={conflict ? (conflict.icon ?? "") : undefined} mine={icon} />
          <Field {...errors.field("keywords")} label={s.fields.keywords} hint={s.fields.keywordsHint} disabled={readOnly} autoComplete="off" value={keywords} onChange={(e) => setKeywords(e.target.value)} />
          <Current value={conflict?.keywords.join(", ")} mine={keywords} />
        </FormStack>
        <FormStack className="gap-4">
          <SelectField {...errors.field("categoryId")} label={s.fields.category} disabled={readOnly} value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.title}
              </option>
            ))}
          </SelectField>
          <GroupsChooser
            id={errors.fieldId("groups")}
            groups={groups}
            value={refs}
            onChange={setRefs}
            other={other}
            onOther={setOther}
            disabled={readOnly}
            after={conflict && <Current value={conflict.groups.map(groupRefLabel).join(", ")} mine={refs.map(groupRefLabel).join(", ")} />}
          />
          <CheckboxField id={errors.fieldId("active")} label={s.fields.active} hint={s.fields.activeHint} disabled={readOnly} checked={active} onChange={(e) => setActive(e.target.checked)} />
        </FormStack>
        </div>
          {!readOnly && (
            <FormActions className="mt-6">
              <SubmitButton pending={pending} pendingLabel={link ? m.admin.saving : s.creating}>
                {link ? m.admin.save : s.create}
              </SubmitButton>
              {!link && (
                <Button type="button" variant="outline" onClick={onClose}>
                  {m.admin.cancel}
                </Button>
              )}
            </FormActions>
          )}
      </form>
      {link && base && !readOnly && (
        <PaneDanger>
          {confirm ? (
            <ConfirmPanel
              question={s.deleteLinkQuestion(link.title)}
              confirmLabel={m.admin.confirmDelete}
              pendingLabel={m.admin.deleting}
              onConfirm={async () => {
                try {
                  await api.deleteLink(base.id, base.revision);
                } catch (err) {
                  const current = currentOf<AdminLink>(err);
                  if (current) setBase(current);
                  throw err;
                }
                onDeleted(base);
              }}
              onCancel={() => setConfirm(false)}
              errorText={(err) => (currentOf(err) ? s.conflict : adminErrorText(err, m))}
            >
              {s.deleteLinkDetails && <p>{s.deleteLinkDetails}</p>}
            </ConfirmPanel>
          ) : (
            <div>
              <Button variant="destructive-ghost" onClick={() => setConfirm(true)}>
                <Trash2 aria-hidden="true" />
                {m.groups.deleteLabel(link.title)}
              </Button>
            </div>
          )}
        </PaneDanger>
      )}
      </div>
    </AdminShell>
  );
}

type CategoryPaneProps = {
  category: AdminCategory | null;
  groups: AdminGroup[];
  readOnly: boolean;
  onClose: () => void;
  onSaved: (category: AdminCategory, created: boolean, warnings: EditWarning[]) => void;
  onDeleted: (category: AdminCategory) => void;
  /** Warnings of the creation that opened this pane. */
  warnings?: EditWarning[];
};

/** Detail of a category, or the form of a new one: title and groups; delete at the bottom with its link count. */
export function CategoryPane({ category, groups, readOnly, onClose, onSaved, onDeleted, warnings: initialWarnings = [] }: CategoryPaneProps) {
  const m = useStrings();
  const s = m.links;
  const formId = category ? `category-${category.id}-form` : "categories-new-form";
  const errors = useFormErrors<"title" | "groups">(["title", "groups"], formId);
  const [base, setBase] = useState(category);
  const [conflict, setConflict] = useState<AdminCategory | null>(null);
  const [title, setTitle] = useState(category?.title ?? "");
  const [refs, setRefs] = useState(category?.groups ?? []);
  const [other, setOther] = useState("");
  const [pending, setPending] = useState(false);
  const [warnings, setWarnings] = useState<EditWarning[]>(initialWarnings);
  const [confirm, setConfirm] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!errors.check({ title: title.trim() === "" && m.fieldErrors.required })) return;
    const groupsNow = refsWith(refs, other);
    setPending(true);
    try {
      if (!base) {
        const result = await api.createCategory({ title, groups: groupsNow });
        onSaved(result.category, true, result.warnings);
        return;
      }
      const changes: { title?: string; groups?: string[] } = {};
      if (title.trim() !== base.title) changes.title = title;
      if ([...groupsNow].sort().join("\n") !== [...base.groups].sort().join("\n")) changes.groups = groupsNow;
      if (Object.keys(changes).length === 0) return;
      const result = await api.updateCategory(base.id, base.revision, changes);
      setBase(result.category);
      setConflict(null);
      setOther("");
      setRefs(result.category.groups);
      setWarnings(result.warnings);
      onSaved(result.category, false, result.warnings);
    } catch (err) {
      const current = currentOf<AdminCategory>(err);
      if (current) {
        setConflict(current);
        setBase(current);
        errors.fail(s.conflict);
      } else errors.failWith(err, { fallback: adminErrorText });
    } finally {
      setPending(false);
    }
  }

  const links = base?.links.length ?? 0;
  return (
    <AdminShell
      section="links"
      title={category ? category.title : s.newCategory}
      back={{ href: listHref(LIST), label: m.admin.backTo(s.title) }}
      subtitle={category ? <p>{s.linkCount(links)}</p> : undefined}
    >
      <div className="flex flex-col gap-10">
      {readOnly && <Alert variant="info">{s.managedByFile}</Alert>}
      <Warnings warnings={warnings} />
      <form id={formId} noValidate aria-label={category ? category.title : s.newCategory} onSubmit={submit}>
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
            after={conflict && <Current value={conflict.groups.map(groupRefLabel).join(", ")} mine={refs.map(groupRefLabel).join(", ")} />}
          />
        </FormStack>
        </div>
          {!readOnly && (
            <FormActions className="mt-6">
              <SubmitButton pending={pending} pendingLabel={category ? m.admin.saving : s.creating}>
                {category ? m.admin.save : s.create}
              </SubmitButton>
              {!category && (
                <Button type="button" variant="outline" onClick={onClose}>
                  {m.admin.cancel}
                </Button>
              )}
            </FormActions>
          )}
      </form>
      {category && base && !readOnly && (
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
                  const current = currentOf<AdminCategory>(err);
                  if (current) setBase(current);
                  throw err;
                }
                onDeleted(base);
              }}
              onCancel={() => setConfirm(false)}
              errorText={(err) => (currentOf(err) ? s.conflict : adminErrorText(err, m))}
            >
              {s.deleteCategoryDetails && <p>{s.deleteCategoryDetails}</p>}
            </ConfirmPanel>
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
