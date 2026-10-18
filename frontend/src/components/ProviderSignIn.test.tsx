import { cleanup, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { leavePage } from "../lib/sign-in";
import { getStatus, mockApi, renderWithProviders, sentBody } from "../test-utils";
import { ProviderSignIn } from "./ProviderSignIn";

const OKTA = { name: "Okta" };
const AUTHORIZE = "https://idp.example.invalid/authorize?state=abc";
const START = "POST /api/auth/sign-in/social";

let assign: ReturnType<typeof vi.spyOn>;
let replace: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  assign = vi.spyOn(leavePage, "assign").mockImplementation(() => {});
  replace = vi.spyOn(leavePage, "replace").mockImplementation(() => {});
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

/** Return the requests sent to start the provider sign-in. */
const starts = (fetchMock: ReturnType<typeof mockApi>) => fetchMock.mock.calls.filter(([path]) => path === "/api/auth/sign-in/social");

const errorBody = (code: string) => ({ error: { code, message: "" } });

describe("ProviderSignIn", () => {
  it("starts the sign-in at the provider on click, with the path to come back to", async () => {
    const fetchMock = mockApi({ [START]: { status: 200, body: { url: AUTHORIZE } } });
    renderWithProviders(<ProviderSignIn provider={OKTA} returnTo="/admin/groups" />);
    await userEvent.setup().click(screen.getByRole("button", { name: "Sign in with Okta" }));
    await waitFor(() => expect(assign).toHaveBeenCalledWith(AUTHORIZE));
    expect(replace).not.toHaveBeenCalled();
    expect(sentBody(fetchMock, 0)).toEqual({ returnTo: "/admin/groups" });
  });

  it("sends an empty body without a path to come back to", async () => {
    const fetchMock = mockApi({ [START]: { status: 200, body: { url: AUTHORIZE } } });
    renderWithProviders(<ProviderSignIn provider={OKTA} />);
    await userEvent.setup().click(screen.getByRole("button", { name: "Sign in with Okta" }));
    await waitFor(() => expect(assign).toHaveBeenCalledOnce());
    expect(sentBody(fetchMock, 0)).toEqual({});
  });

  it("never starts by itself unless asked", () => {
    const fetchMock = mockApi({});
    renderWithProviders(<ProviderSignIn provider={OKTA} />);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("starts once on mount when asked, replacing the page, and says where it goes", async () => {
    const fetchMock = mockApi({ [START]: { status: 200, body: { url: AUTHORIZE } } });
    renderWithProviders(<ProviderSignIn provider={OKTA} autoRedirect />, { strict: true });
    expect(getStatus()).toHaveTextContent("Redirecting to Okta…");
    expect(screen.queryByRole("button", { name: "Sign in with Okta" })).toBeNull();
    await waitFor(() => expect(replace).toHaveBeenCalledWith(AUTHORIZE));
    expect(assign).not.toHaveBeenCalled();
    expect(starts(fetchMock)).toHaveLength(1);
  });

  it("does not start by itself over an error from the address, and focuses it", () => {
    const fetchMock = mockApi({});
    renderWithProviders(<ProviderSignIn provider={OKTA} autoRedirect error={{ code: "not_allowed" }} />);
    expect(screen.getByRole("group", { name: "Your account does not have access to this portal." })).toHaveFocus();
    expect(screen.getByRole("button", { name: "Sign in with Okta" })).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("stops after a failed automatic start: the error shows and nothing starts again", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      const fetchMock = mockApi({ [START]: { status: 503, body: errorBody("provider_unavailable") } });
      const { rerender } = renderWithProviders(<ProviderSignIn provider={OKTA} autoRedirect />);
      // The alert takes the focus in an effect, after it is in the document.
      const alert = await screen.findByRole("group", { name: "Okta is not responding. Try again in a moment." });
      await waitFor(() => expect(alert).toHaveFocus());
      rerender(<ProviderSignIn provider={OKTA} autoRedirect returnTo="/account" />);
      await vi.advanceTimersByTimeAsync(60_000);
      expect(starts(fetchMock)).toHaveLength(1);
      expect(replace).not.toHaveBeenCalled();
      expect(screen.getByRole("button", { name: "Sign in with Okta" })).toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });

  it.each([
    ["not_allowed", "Your account does not have access to this portal."],
    ["access_denied", "Your account does not have access to this portal."],
    ["account_not_linked", "Another account already uses this e-mail address. Contact your administrator."],
    ["email_in_use", "Another account already uses this e-mail address. Contact your administrator."],
    ["account_disabled", "This account is disabled. Ask your administrator."],
    ["provider_unavailable", "Okta is not responding. Try again in a moment."],
    ["rate_limited", "Too many sign-in attempts. Try again later."],
  ])("explains %s and keeps the plain button", (code, text) => {
    mockApi({});
    renderWithProviders(<ProviderSignIn provider={OKTA} error={{ code }} />);
    expect(screen.getByRole("group", { name: text })).toHaveFocus();
    expect(screen.getByRole("button", { name: "Sign in with Okta" })).toBeInTheDocument();
  });

  it("drops the error from the address when the parent stops passing it", () => {
    mockApi({});
    const { rerender } = renderWithProviders(<ProviderSignIn provider={OKTA} error={{ code: "not_allowed" }} />);
    expect(screen.getByRole("group", { name: "Your account does not have access to this portal." })).toBeInTheDocument();
    rerender(<ProviderSignIn provider={OKTA} error={null} />);
    expect(screen.queryByRole("group")).toBeNull();
    expect(screen.getByRole("button", { name: "Sign in with Okta" })).toBeInTheDocument();
  });

  it("gives any other code the generic text and a Try again button", async () => {
    const fetchMock = mockApi({ [START]: { status: 200, body: { url: AUTHORIZE } } });
    renderWithProviders(<ProviderSignIn provider={OKTA} error={{ code: "state_mismatch" }} />);
    expect(screen.getByRole("group", { name: "Sign-in failed. Try again." })).toHaveFocus();
    expect(screen.queryByRole("button", { name: "Sign in with Okta" })).toBeNull();
    await userEvent.setup().click(screen.getByRole("button", { name: "Try again" }));
    await waitFor(() => expect(assign).toHaveBeenCalledWith(AUTHORIZE));
    expect(starts(fetchMock)).toHaveLength(1);
  });

  it("says how long to wait when the server refuses with Retry-After, and does not try again by itself", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      const fetchMock = vi.fn(
        async () => new Response(JSON.stringify(errorBody("rate_limited")), { status: 429, headers: { "Retry-After": "120" } }),
      );
      vi.stubGlobal("fetch", fetchMock);
      renderWithProviders(<ProviderSignIn provider={OKTA} autoRedirect />);
      const alert = await screen.findByRole("group", { name: "Too many sign-in attempts. Try again in 2 minutes." });
      await waitFor(() => expect(alert).toHaveFocus());
      await vi.advanceTimersByTimeAsync(180_000);
      expect(fetchMock).toHaveBeenCalledOnce();
    } finally {
      vi.useRealTimers();
    }
  });

  it("focuses the error again when a new attempt fails the same way", async () => {
    const user = userEvent.setup();
    mockApi({ [START]: { status: 503, body: errorBody("provider_unavailable") } });
    renderWithProviders(<ProviderSignIn provider={OKTA} />);
    const button = screen.getByRole("button", { name: "Sign in with Okta" });
    await user.click(button);
    const name = "Okta is not responding. Try again in a moment.";
    expect(await screen.findByRole("group", { name })).toHaveFocus();
    await user.click(screen.getByRole("button", { name: "Sign in with Okta" }));
    await waitFor(() => expect(screen.getByRole("group", { name })).toHaveFocus());
  });
});
