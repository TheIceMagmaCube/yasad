import { type FormEvent, useState } from "react";

import { type AdminCategory, type AdminGroup, type AdminLink, api, type EditWarning } from "../../../api";
import { Recap, StepTitle, TypeChoice, WizardSteps } from "../../../components/admin/Wizard";
import { ErrorSummary } from "../../../components/form/ErrorSummary";
import { Field } from "../../../components/form/Field";
import { FormActions, FormStack } from "../../../components/form/FormLayout";
import { SubmitButton } from "../../../components/form/PendingButton";
import { SelectField } from "../../../components/form/SelectField";
import { Button } from "../../../components/ui/button";
import { useStrings } from "../../../i18n/LocaleProvider";
import { useFormErrors } from "../../../lib/form-errors";
import { groupRefLabel } from "../../../lib/group-ref";
import { adminErrorText } from "../shared";
import { GroupsChooser, refsWith } from "./LinkPane";

type Kind = "link" | "category";
type FieldName = "url" | "title" | "categoryId" | "groups" | "icon" | "keywords";
const FIELDS = ["url", "title", "categoryId", "groups", "icon", "keywords"] as const;

type AddLinksProps = {
  categories: AdminCategory[];
  groups: AdminGroup[];
  initialType: Kind;
  onLinkCreated: (link: AdminLink, warnings: EditWarning[]) => void;
  onCategoryCreated: (category: AdminCategory, warnings: EditWarning[]) => void;
};

/**
 * Wizard adding a link or a category, one question per step as on the setup screen. A link: address and title,
 * category, groups, icon and keywords (skippable), summary. A category: title, groups, summary.
 */
export function AddLinks({ categories, groups, initialType, onLinkCreated, onCategoryCreated }: AddLinksProps) {
  const m = useStrings();
  const s = m.links;
  const w = m.admin.wizard;
  const [kind, setKind] = useState<Kind>(categories.length === 0 ? "category" : initialType);
  const [step, setStep] = useState(0);
  const errors = useFormErrors<FieldName>(FIELDS, "links-add-form");
  const [url, setUrl] = useState("https://");
  const [title, setTitle] = useState("");
  const [categoryId, setCategoryId] = useState(categories[0]?.id ?? "");
  const [refs, setRefs] = useState<string[]>([]);
  const [other, setOther] = useState("");
  const [icon, setIcon] = useState("");
  const [keywords, setKeywords] = useState("");
  const [pending, setPending] = useState(false);

  const labels =
    kind === "link"
      ? [s.steps.type, s.steps.address, s.steps.category, s.steps.groups, s.steps.extras, s.steps.recap]
      : [s.steps.type, s.steps.title, s.steps.groups, s.steps.recap];
  const last = labels.length - 1;
  const current = labels[step];
  const groupRefs = refsWith(refs, other);

  /** Go back to the step that holds a field the server refused. */
  const stepOf = (field: string) => (field === "url" || field === "title" ? 1 : field === "categoryId" ? 2 : field === "groups" ? (kind === "link" ? 3 : 2) : 4);

  async function create() {
    const keywordList = keywords.split(",").map((k) => k.trim()).filter(Boolean);
    try {
      if (kind === "link") {
        const { link, warnings } = await api.createLink({ title, url, groups: groupRefs, categoryId, keywords: keywordList, ...(icon.trim() ? { icon: icon.trim() } : {}) });
        onLinkCreated(link, warnings);
      } else {
        const { category, warnings } = await api.createCategory({ title, groups: groupRefs });
        onCategoryCreated({ ...category, links: category.links ?? [] }, warnings);
      }
    } catch (err) {
      const fields = (err as { body?: { fields?: Record<string, string> } }).body?.fields;
      const first = fields && Object.keys(fields)[0];
      if (first) setStep(stepOf(first));
      errors.failWith(err, { fallback: adminErrorText });
    }
  }

  async function next(e: FormEvent) {
    e.preventDefault();
    if (current === s.steps.address && !errors.check({ url: !/^https?:\/\/\S+$/.test(url.trim()) && m.fieldErrors.invalid_value, title: title.trim() === "" && m.fieldErrors.required })) return;
    if (current === s.steps.title && !errors.check({ title: title.trim() === "" && m.fieldErrors.required })) return;
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
            labels={{ url: s.fields.url, title: s.fields.title, categoryId: s.fields.category, groups: s.fields.groups, icon: s.fields.icon, keywords: s.fields.keywords }}
          />
          {step === 0 && (
            <TypeChoice
              name="add-link-type"
              value={kind}
              onChange={setKind}
              options={[
                ...(categories.length > 0 ? [{ value: "link" as const, label: s.types.link, hint: s.typeHints.link }] : []),
                { value: "category", label: s.types.category, hint: s.typeHints.category },
              ]}
            />
          )}
          {current === s.steps.address && (
            <div className="flex max-w-md flex-col gap-4">
              <Field {...errors.field("url")} label={s.fields.url} type="url" required autoComplete="off" value={url} onChange={(e) => setUrl(e.target.value)} />
              <Field {...errors.field("title")} label={s.fields.title} required autoComplete="off" value={title} onChange={(e) => setTitle(e.target.value)} />
            </div>
          )}
          {current === s.steps.title && (
            <div className="max-w-md">
              <Field {...errors.field("title")} label={s.fields.title} required autoComplete="off" value={title} onChange={(e) => setTitle(e.target.value)} />
            </div>
          )}
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
              <Field {...errors.field("icon")} label={s.fields.icon} hint={s.fields.iconHint} autoComplete="off" spellCheck={false} inputClassName="font-mono" value={icon} onChange={(e) => setIcon(e.target.value)} />
              <Field {...errors.field("keywords")} label={s.fields.keywords} hint={s.fields.keywordsHint} autoComplete="off" value={keywords} onChange={(e) => setKeywords(e.target.value)} />
            </div>
          )}
          {step === last && (
            <Recap
              rows={
                kind === "link"
                  ? [
                      [s.fields.title, title],
                      [s.fields.url, url],
                      [s.fields.category, categoryTitle],
                      [s.fields.groups, groupsText],
                      [s.fields.icon, icon.trim() || w.none],
                      [s.fields.keywords, keywords.trim() || w.none],
                    ]
                  : [
                      [s.fields.title, title],
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
