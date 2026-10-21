import { cleanup, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import type { AdminLinkStatus } from "../../../api";
import { renderWithProviders } from "../../../test-utils";
import { LinkStatus } from "./LinkStatus";
import { CHECKS, link } from "./testing";

afterEach(() => {
  cleanup();
  localStorage.removeItem("yasad.language");
});

const NOW = Date.parse("2026-10-21T12:00:00.000Z");
const minutesAgo = (n: number) => new Date(NOW - n * 60_000).toISOString();
const checked = (status: AdminLinkStatus | null) => link({ id: "wiki", title: "Wiki", check: true, status });

const block = () => screen.getByRole("region", { name: "Last check" });
/** Return the text of the definition after the term `term`. */
const value = (term: string) => within(block()).getByText(term).nextElementSibling;

describe("LinkStatus", () => {
  it("shows nothing for an unchecked link", () => {
    renderWithProviders(<LinkStatus link={link({ id: "wiki", title: "Wiki" })} checks={CHECKS} now={NOW} />);
    expect(screen.queryByRole("region", { name: "Last check" })).toBeNull();
  });

  it("says a checked link was not checked yet, with no time", () => {
    renderWithProviders(<LinkStatus link={checked(null)} checks={CHECKS} now={NOW} />);
    expect(value("State")).toHaveTextContent("Status unknown");
    expect(value("Detail")).toHaveTextContent("Not checked yet");
    expect(within(block()).queryByText("Checked")).toBeNull();
  });

  it("reads a fresh down result: word, reason, HTTP code and the time with its exact date", () => {
    renderWithProviders(<LinkStatus link={checked({ state: "down", reason: "http_error", httpStatus: 502, checkedAt: minutesAgo(3) })} checks={CHECKS} now={NOW} />);
    expect(value("State")).toHaveTextContent("Down");
    expect(value("Detail")).toHaveTextContent("HTTP error, HTTP 502");
    const time = within(block()).getByText("3 min. ago");
    expect(time.tagName).toBe("TIME");
    expect(time).toHaveAttribute("dateTime", minutesAgo(3));
    expect(time.getAttribute("title")).toMatch(/2026/);
    for (const svg of block().querySelectorAll("svg")) expect(svg).toHaveAttribute("aria-hidden", "true");
  });

  it("reads an up result with its HTTP code only", () => {
    renderWithProviders(<LinkStatus link={checked({ state: "up", reason: null, httpStatus: 200, checkedAt: minutesAgo(1) })} checks={CHECKS} now={NOW} />);
    expect(value("State")).toHaveTextContent("Up");
    expect(value("Detail")).toHaveTextContent(/^HTTP 200$/);
  });

  it("reads an old result as unknown, its time kept", () => {
    renderWithProviders(<LinkStatus link={checked({ state: "up", reason: null, httpStatus: 200, checkedAt: minutesAgo(16) })} checks={CHECKS} now={NOW} />);
    expect(value("State")).toHaveTextContent("Status unknown");
    expect(value("Detail")).toHaveTextContent("Last result too old, HTTP 200");
    expect(value("Checked")?.querySelector("time")).toHaveAttribute("dateTime", minutesAgo(16));
  });

  it("names a reason it does not know as another reason", () => {
    renderWithProviders(<LinkStatus link={checked({ state: "unknown", reason: "something_new", httpStatus: null, checkedAt: minutesAgo(1) })} checks={CHECKS} now={NOW} />);
    expect(value("Detail")).toHaveTextContent(/^Other reason$/);
  });

  it("reads in French", () => {
    localStorage.setItem("yasad.language", "fr");
    renderWithProviders(<LinkStatus link={checked({ state: "down", reason: "timeout", httpStatus: null, checkedAt: minutesAgo(2) })} checks={CHECKS} now={NOW} />);
    const region = screen.getByRole("region", { name: "Dernier contrôle" });
    expect(within(region).getByText("En panne")).toBeInTheDocument();
    expect(within(region).getByText("Pas de réponse à temps")).toBeInTheDocument();
  });
});
