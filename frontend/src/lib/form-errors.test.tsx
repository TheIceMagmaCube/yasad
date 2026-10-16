import { act, cleanup, renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it } from "vitest";

import { ApiError } from "../api";
import { en } from "../i18n/en";
import { LocaleProvider } from "../i18n/LocaleProvider";
import { apiFormError, confirmationProblem, newPasswordProblem, useFormErrors } from "./form-errors";

afterEach(cleanup);

const FIELDS = ["current", "new", "confirm"] as const;
const invalidInput = (fields: Record<string, string>) => new ApiError(422, { code: "invalid_input", message: "", fields });

describe("apiFormError", () => {
  it("puts invalid_input codes on their fields, renamed when needed, and keeps unknown keys as entries", () => {
    const failure = apiFormError(invalidInput({ newPassword: "password_unchanged", current: "invalid_password", extra: "invalid_value" }), en, {
      fields: FIELDS,
      rename: { newPassword: "new" },
    });
    expect(failure).toEqual({
      title: "Check the highlighted fields.",
      fields: { new: "Choose a new password, different from the old one.", current: "Use 12 to 128 characters." },
      invalid: [],
      links: [],
      extra: ["This value is not valid."],
    });
  });

  it("gives a known code its message on its field, with the default title", () => {
    const err = new ApiError(403, { code: "invalid_password", message: "" });
    expect(apiFormError(err, en, { fields: FIELDS, codes: { invalid_password: { message: "Wrong.", field: "current" } } })).toMatchObject({
      title: "Check the highlighted fields.",
      fields: { current: "Wrong." },
    });
  });

  it("titles a known code without a field with its message, and marks other fields invalid", () => {
    const err = new ApiError(401, { code: "INVALID_EMAIL_OR_PASSWORD", message: "" });
    const failure = apiFormError(err, en, {
      fields: ["email", "password"] as const,
      codes: { INVALID_EMAIL_OR_PASSWORD: { message: "Wrong e-mail or password.", invalid: ["email", "password"], link: { field: "password", message: "Again" } } },
    });
    expect(failure).toEqual({ title: "Wrong e-mail or password.", fields: {}, invalid: ["email", "password"], links: [{ field: "password", message: "Again" }], extra: [] });
  });

  it("uses a given title and a message built from the error", () => {
    const err = new ApiError(403, { code: "invalid_code", message: "", attemptsLeft: 2 });
    const failure = apiFormError(err, en, {
      fields: ["code"] as const,
      codes: { invalid_code: { field: "code", title: "Nope", message: (e) => `${e.body.attemptsLeft} left` } },
    });
    expect(failure).toMatchObject({ title: "Nope", fields: { code: "2 left" } });
  });

  it("falls back for a network error and a 429", () => {
    expect(apiFormError(new TypeError("Failed to fetch"), en, { fields: FIELDS }).title).toBe(en.errors.unreachable);
    expect(apiFormError(new ApiError(429, { code: "unknown", message: "" }), en, { fields: FIELDS }).title).toBe(en.errors.rateLimited);
    expect(apiFormError(new ApiError(500, { code: "internal_error", message: "" }), en, { fields: FIELDS, fallback: () => "Admin text" }).title).toBe("Admin text");
  });

  it("falls back for invalid_input without fields", () => {
    expect(apiFormError(invalidInput({}), en, { fields: FIELDS })).toMatchObject({ title: en.errors.generic, fields: {}, extra: [] });
  });
});

describe("password checks", () => {
  it("requires 12 to 128 characters and a matching confirmation", () => {
    expect(newPasswordProblem("", en)).toBe(en.fieldErrors.required);
    expect(newPasswordProblem("a".repeat(11), en)).toBe(en.fieldErrors.invalid_password);
    expect(newPasswordProblem("a".repeat(129), en)).toBe(en.fieldErrors.invalid_password);
    expect(newPasswordProblem("a".repeat(12), en)).toBeNull();
    expect(confirmationProblem("a", "", en)).toBe(en.fieldErrors.required);
    expect(confirmationProblem("a", "b", en)).toBe(en.fieldErrors.password_mismatch);
    expect(confirmationProblem("a", "a", en)).toBeNull();
  });
});

const wrapper = ({ children }: { children: ReactNode }) => <LocaleProvider defaultLanguage="en">{children}</LocaleProvider>;

describe("useFormErrors", () => {
  it("reports every local rule in one pass, in field order, and clears when they pass", () => {
    const { result } = renderHook(() => useFormErrors(FIELDS, "pw"), { wrapper });
    let ok = true;
    act(() => {
      ok = result.current.check({ confirm: "Mismatch", current: "Required", new: false });
    });
    expect(ok).toBe(false);
    expect(result.current.state).toMatchObject({ title: "Check the highlighted fields.", fields: { current: "Required", confirm: "Mismatch" }, order: FIELDS });
    expect(result.current.field("current")).toEqual({ id: "pw-current", name: "current", error: "Required", invalid: undefined, describedBy: "pw-summary-title" });
    act(() => {
      ok = result.current.check({ current: null, new: "", confirm: undefined });
    });
    expect(ok).toBe(true);
    expect(result.current.state).toBeNull();
  });

  it("gives a stable summary title id and field ids", () => {
    const { result } = renderHook(() => useFormErrors(FIELDS, "pw"), { wrapper });
    expect(result.current.titleId).toBe("pw-summary-title");
    expect(result.current.fieldId("new")).toBe("pw-new");
    expect(result.current.field("new")).toEqual({ id: "pw-new", name: "new", error: undefined, invalid: undefined, describedBy: undefined });
  });

  it("changes the key on every failure, even with the same text", () => {
    const { result } = renderHook(() => useFormErrors(FIELDS), { wrapper });
    act(() => result.current.fail("Same"));
    const first = result.current.state!.key;
    act(() => result.current.fail("Same"));
    expect(result.current.state!.key).not.toBe(first);
  });

  it("maps an API error with failWith and marks invalid fields", () => {
    const { result } = renderHook(() => useFormErrors(["email", "password"] as const), { wrapper });
    act(() =>
      result.current.failWith(new ApiError(401, { code: "BAD", message: "" }), { codes: { BAD: { message: "Wrong.", invalid: ["email", "password"] } } }),
    );
    expect(result.current.field("password")).toMatchObject({ invalid: true, error: undefined });
    act(() => result.current.reset());
    expect(result.current.state).toBeNull();
  });
});
