import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { App } from "./App";
import { mockApi } from "./test-utils";

const ADA = { name: "Ada Lovelace", email: "ada@example.org", role: "admin" };

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("App", () => {
  it("shows the setup flow while setup is open and nobody is signed in", async () => {
    mockApi({ "GET /api/setup": { status: 200, body: { open: true } }, "GET /api/auth/get-session": { status: 200, body: null } });
    render(<App />);
    expect(await screen.findByRole("heading", { name: "Set up YASAD" })).toBeInTheDocument();
  });

  it("shows the sign-in screen once setup is closed", async () => {
    mockApi({ "GET /api/setup": { status: 200, body: { open: false } }, "GET /api/auth/get-session": { status: 200, body: null } });
    render(<App />);
    expect(await screen.findByRole("heading", { name: "Sign in" })).toBeInTheDocument();
  });

  it("shows the home page to a signed-in user", async () => {
    mockApi({
      "GET /api/setup": { status: 200, body: { open: false, setupCodeStillSet: false } },
      "GET /api/auth/get-session": { status: 200, body: { user: ADA, session: {} } },
    });
    render(<App />);
    expect(await screen.findByText("Signed in as Ada Lovelace.")).toBeInTheDocument();
  });

  it("says so when the server cannot be reached", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("Failed to fetch")));
    render(<App />);
    expect(await screen.findByRole("alert")).toHaveTextContent("cannot reach its server");
  });
});
