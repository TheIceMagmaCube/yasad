import { type FormEvent, useMemo, useState } from "react";

import { type AdminCategory, type AdminGroup, type AdminLink, ApiError, api, type CheckSettings, type EditWarning } from "../../../api";
import { Recap, StepTitle, TypeChoice, WizardSteps } from "../../../components/admin/Wizard";
import { ErrorSummary } from "../../../components/form/ErrorSummary";
import { Field } from "../../../components/form/Field";
import { FormActions, FormStack } from "../../../components/form/FormLayout";
import { SubmitButton } from "../../../components/form/PendingButton";
import { SelectField } from "../../../components/form/SelectField";
import { Button } from "../../../components/ui/button";
import { CheckboxField } from "../../../components/ui/checkbox";
import { useStrings } from "../../../i18n/LocaleProvider";
import { useFormErrors } from "../../../lib/form-errors";
import { groupRefLabel } from "../../../lib/group-ref";
import { GroupsChooser, refsWith } from "./GroupsChooser";
import { freeId, idFromTitle, isManagedByFile, isReservedId, linksErrorText } from "./item-edit";
import { keywordsOf } from "./LinkPage";

type Kind = "link" | "category";
type FieldName = "url" | "title" | "id" | "categoryId" | "groups" | "icon" | "keywords" | "check";
const FIELDS = ["url", "title", "id", "categoryId", "groups", "icon", "keywords", "check"] as const;
const ID_PATTERN = /^[a-z0-9][a-z0-9-]*$/;

type AddLinksProps = {
  categories: AdminCategory[];
  groups: AdminGroup[];
  initialType: Kind;
  /** How the instance checks links, for the hint of the check box; null while unknown. */
  checks: CheckSettings | null;
  onLinkCreated: (link: AdminLink, warnings: EditWarning[]) => void;
  onCategoryCreated: (category: AdminCategory, warnings: EditWarning[]) => void;
  /** The server said CATALOG_FILE manages the catalog. */
  onManaged: () => void;
};

/**
 * Wizard adding a link or a category, one question per step as on the setup screen. A link: address, title and id,
 * category, groups, icon, keywords and availability check (skippable), summary. A category: title and id, groups, summary.
 *
 * The id follows the title until it is edited, as the server would derive it, moved past the ids already used and
 * the words of other page addresses; it cannot change once created.
 */
export function AddLinks({ categories, groups, initialType, checks, onLinkCreated, onCategoryCreated, onManaged }: AddLinksProps) {
  const m = useStrings();
  const s = m.links;
  const w = m.admin.wizard;
  // A link needs a category to go in.
  const [kind, setKind] = useState<Kind>(categories.length === 0 ? "category" : initialType);
  const [step, setStep] = useState(0);
  const errors = useFormErrors<FieldName>(FIELDS, "links-add-form");
  const [url, setUrl] = useState("https://");
  const [title, setTitle] = useState("");
  const [typedId, setTypedId] = useState<string | null>(null);
  const [categoryId, setCategoryId] = useState(categories[0]?.id ?? "");
  const [refs, setRefs] = useState<string[]>([]);
  const [other, setOther] = useState("");
  const [icon, setIcon] = useState("");
  const [keywords, setKeywords] = useState("");
  const [check, setCheck] = useState(false);
  const [pending, setPending] = useState(false);

  const taken = useMemo(
    () => new Set(kind === "link" ? categories.flatMap((c) => c.links.map((l) => l.id)) : categories.map((c) => c.id)),
    [categories, kind],
  );
  const id = typedId ?? freeId(idFromTitle(title, kind === "link" ? "lien" : "categorie"), taken, kind);

  const labels =
    kind === "link"
      ? [s.steps.type, s.steps.address, s.steps.category, s.steps.groups, s.steps.extras, s.steps.recap]
      : [s.steps.type, s.steps.title, s.steps.groups, s.steps.recap];
  const last = labels.length - 1;
  const current = labels[step];
  const groupRefs = refsWith(refs, other);

  /** Return the step that holds a field the server refused. */
  const stepOf = (field: string) => {
    if (field === "url" || field === "title" || field === "id") return 1;
    if (field === "categoryId") return 2;
    if (field === "groups") return kind === "link" ? 3 : 2;
    return 4;
  };

  /** Return the problem of the id typed, if any. */
  const idProblem = () => {
    if (id === "") return m.fieldErrors.required;
    if (id.length > 64 || !ID_PATTERN.test(id)) return m.fieldErrors.invalid_id;
    if (isReservedId(id, kind)) return m.fieldErrors.id_reserved;
    return taken.has(id) && m.fieldErrors.id_taken;
  };

  async function create() {
    try {
      if (kind === "link") {
        const { link, warnings } = await api.createLink({
          id,
          title,
          url,
          groups: groupRefs,
          categoryId,
          keywords: keywordsOf(keywords),
          ...(icon.trim() ? { icon: icon.trim() } : {}),
          // Sent only when ticked, so an untouched wizard sends the body it always sent.
          ...(check ? { check: true } : {}),
        });
        onLinkCreated(link, warnings);
      } else {
        const { category, warnings } = await api.createCategory({ id, title, groups: groupRefs });
        onCategoryCreated(category, warnings);
      }
    } catch (err) {
      if (isManagedByFile(err)) onManaged();
      const first = err instanceof ApiError ? Object.keys(err.body.fields ?? {})[0] : undefined;
      if (first) setStep(stepOf(first));
      errors.failWith(err, { fallback: linksErrorText });
    }
  }

  async function next(e: FormEvent) {
    e.preventDefault();
    if (current === s.steps.address && !errors.check({ url: !/^https?:\/\/\S+$/.test(url.trim()) && m.fieldErrors.invalid_url, title: title.trim() === "" && m.fieldErrors.required, id: idProblem() })) return;
    if (current === s.steps.title && !errors.check({ title: title.trim() === "" && m.fieldErrors.required, id: idProblem() })) return;
    if (step < last) {
      errors.reset();
      setStep(step + 1);
      return;
    }
    setPending(true);
    try {
      await create();
    } finally {
      setPending(false);
    }
  }

  const titleAndId = (
    <>
      <Field {...errors.field("title")} label={s.fields.title} required autoComplete="off" value={title} onChange={(e) => setTitle(e.target.value)} />
      <Field
        {...errors.field("id")}
        label={s.fields.id}
        hint={s.fields.idHint}
        required
        autoComplete="off"
        spellCheck={false}
        inputClassName="font-mono"
        value={id}
        onChange={(e) => setTypedId(e.target.value)}
      />
    </>
  );
  const categoryTitle = categories.find((c) => c.id === categoryId)?.title ?? "";
  const groupsText = groupRefs.map(groupRefLabel).join(", ") || w.none;

  return (
    <div>
      <WizardSteps labels={labels} current={step} />
      <form id="links-add-form" noValidate onSubmit={next} aria-labelledby="wizard-step-title">
        <StepTitle step={step}>
          <span id="wizard-step-title">{step === 0 ? w.typeQuestion : current}</span>
        </StepTitle>
        <FormStack className="gap-5">
          <ErrorSummary
            errors={errors}
            labels={{ url: s.fields.url, title: s.fields.title, id: s.fields.id, categoryId: s.fields.category, groups: s.fields.groups, icon: s.fields.icon, keywords: s.fields.keywords, check: s.fields.check }}
          />
          {step === 0 && (
            <TypeChoice
              name="add-link-type"
              value={kind}
              onChange={(next) => {
                setKind(next);
                setTypedId(null);
              }}
              options={[
                ...(categories.length > 0 ? [{ value: "link" as const, label: s.types.link, hint: s.typeHints.link }] : []),
                { value: "category", label: s.types.category, hint: s.typeHints.category },
              ]}
            />
          )}
          {current === s.steps.address && (
            <div className="flex max-w-md flex-col gap-4">
              <Field {...errors.field("url")} label={s.fields.url} type="url" required autoComplete="off" value={url} onChange={(e) => setUrl(e.target.value)} />
              {titleAndId}
            </div>
          )}
          {current === s.steps.title && <div className="flex max-w-md flex-col gap-4">{titleAndId}</div>}
          {current === s.steps.category && (
            <SelectField {...errors.field("categoryId")} label={s.fields.category} className="max-w-md" value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.title}
                </option>
              ))}
            </SelectField>
          )}
          {current === s.steps.groups && (
            <div className="max-w-2xl">
              <GroupsChooser id={errors.fieldId("groups")} groups={groups} value={refs} onChange={setRefs} other={other} onOther={setOther} disabled={false} />
            </div>
          )}
          {current === s.steps.extras && (
            <div className="flex max-w-md flex-col gap-4">
              <Field
                {...errors.field("icon")}
                label={s.fields.icon}
                hint={s.fields.iconHint}
                autoComplete="off"
                spellCheck={false}
                inputClassName="font-mono"
                value={icon}
                onChange={(e) => setIcon(e.target.value)}
              />
              <Field {...errors.field("keywords")} label={s.fields.keywords} hint={s.fields.keywordsHint} autoComplete="off" value={keywords} onChange={(e) => setKeywords(e.target.value)} />
              <CheckboxField
                id={errors.fieldId("check")}
                label={s.fields.check}
                hint={s.check.hint(checks?.intervalMinutes ?? null)}
                checked={check}
                onChange={(e) => setCheck(e.target.checked)}
              />
            </div>
          )}
          {step === last && (
            <Recap
              rows={
                kind === "link"
                  ? [
                      [s.fields.title, title],
                      [s.fields.id, id],
                      [s.fields.url, url],
                      [s.fields.category, categoryTitle],
                      [s.fields.groups, groupsText],
                      [s.fields.icon, icon.trim() || w.none],
                      [s.fields.keywords, keywordsOf(keywords).join(", ") || w.none],
                      ...(check ? [[s.fields.check, m.history.yes] as [string, string]] : []),
                    ]
                  : [
                      [s.fields.title, title],
                      [s.fields.id, id],
                      [s.fields.groups, groupsText],
                    ]
              }
            />
          )}
          <FormActions>
            <SubmitButton pending={pending} pendingLabel={s.creating}>
              {step === last ? s.create : w.next}
            </SubmitButton>
            {current === s.steps.extras && (
              <Button
                type="button"
                variant="ghost"
                onClick={() => {
                  setIcon("");
                  setKeywords("");
                  setCheck(false);
                  errors.reset();
                  setStep(step + 1);
                }}
              >
                {w.skip}
              </Button>
            )}
            {step > 0 && (
              <Button type="button" variant="outline" onClick={() => setStep(step - 1)}>
                {w.back}
              </Button>
            )}
          </FormActions>
        </FormStack>
      </form>
    </div>
  );
}
