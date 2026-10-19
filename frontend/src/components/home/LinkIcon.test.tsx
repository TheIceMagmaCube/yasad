import { cleanup, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ICONS_BASE } from "@/icons-base";
import { renderWithProviders } from "@/test-utils";

import { clearIconCache, initialOf, LinkIcon } from "./LinkIcon";

const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });

beforeEach(clearIconCache);
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

/** Render the icon tile and return it. */
function tile(icon: Parameters<typeof LinkIcon>[0]["icon"], title = "Grafana") {
  const { container } = renderWithProviders(<LinkIcon icon={icon} title={title} />);
  return container.querySelector<HTMLElement>('[data-slot="link-icon"]')!;
}

describe("LinkIcon", () => {
  it("draws a Lucide icon from its file, in the current colour", async () => {
    const fetchMock = vi.fn(async () => json({ nodes: [["rect", { width: "20", height: "16", x: "2", y: "4", rx: "2" }], ["path", { d: "m22 7-10 5L2 7" }]] }));
    vi.stubGlobal("fetch", fetchMock);
    const el = tile({ set: "lucide", name: "mail" });
    expect(el).toBeEmptyDOMElement();
    await waitFor(() => expect(el.querySelector("svg")).not.toBeNull());
    expect(fetchMock).toHaveBeenCalledWith(`${ICONS_BASE}/lucide/mail.json`);
    expect(el.querySelector("svg")).toHaveAttribute("stroke", "currentColor");
    expect(el.querySelectorAll("svg > *")).toHaveLength(2);
    expect(el).toHaveAttribute("aria-hidden", "true");
  });

  it("fills a Simple Icons path with the current colour", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => json({ path: "M0 0h24v24H0z" })));
    const el = tile({ set: "si", name: "grafana" });
    await waitFor(() => expect(el.querySelector("path")).not.toBeNull());
    expect(el.querySelector("path")).toHaveAttribute("fill", "currentColor");
    expect(el.querySelector("path")).toHaveAttribute("d", "M0 0h24v24H0z");
  });

  it("drops elements and attributes outside the allow-list", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => json({ nodes: [["script", {}], ["path", { d: "M1 1", onclick: "x()", style: "fill:red" }]] })));
    const el = tile({ set: "lucide", name: "odd" });
    await waitFor(() => expect(el.querySelector("path")).not.toBeNull());
    expect(el.querySelector("script")).toBeNull();
    expect(el.querySelector("path")).not.toHaveAttribute("onclick");
    expect(el.querySelector("path")).not.toHaveAttribute("style");
  });

  it("shows the first letter without an icon, without fetching", () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const el = tile(null);
    expect(el.querySelector("[data-initial]")).toHaveAttribute("data-initial", "G");
    // Drawn as generated content, so it adds no text to a name or label around it.
    expect(el).toHaveTextContent(/^$/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("shows the first letter when the file comes back as HTML with a 200", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("<!doctype html>", { status: 200, headers: { "content-type": "text/html" } })));
    const el = tile({ set: "si", name: "unknown" });
    await waitFor(() => expect(el.querySelector("[data-initial]")).toHaveAttribute("data-initial", "G"));
    expect(el.querySelector("svg")).toBeNull();
  });

  it("shows the first letter on a 404 or a network error, and tries again on the next tile", async () => {
    const fetchMock = vi
      .fn()
      .mockRejectedValueOnce(new TypeError("Failed to fetch"))
      .mockResolvedValueOnce(new Response("", { status: 404 }))
      .mockResolvedValue(json({ path: "M0 0z" }));
    vi.stubGlobal("fetch", fetchMock);
    const first = tile({ set: "si", name: "grafana" });
    await waitFor(() => expect(first.querySelector("[data-initial]")).toHaveAttribute("data-initial", "G"));
    cleanup();
    const second = tile({ set: "si", name: "grafana" });
    await waitFor(() => expect(second.querySelector("[data-initial]")).toHaveAttribute("data-initial", "G"));
    cleanup();
    const third = tile({ set: "si", name: "grafana" });
    await waitFor(() => expect(third.querySelector("svg")).not.toBeNull());
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("fetches an icon once for tiles shown together", async () => {
    const fetchMock = vi.fn(async () => json({ path: "M0 0z" }));
    vi.stubGlobal("fetch", fetchMock);
    const { container } = renderWithProviders(
      <>
        <LinkIcon icon={{ set: "si", name: "jira" }} title="Jira" />
        <LinkIcon icon={{ set: "si", name: "jira" }} title="Jira 2" />
      </>,
    );
    await waitFor(() => expect(container.querySelectorAll("svg")).toHaveLength(2));
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe("initialOf", () => {
  it("returns one upper-case grapheme", () => {
    expect(initialOf("grafana", "en")).toBe("G");
    expect(initialOf("élan", "fr")).toBe("É");
    expect(initialOf("ßtraße", "de")).toBe("S");
    expect(initialOf("👩‍💻 Dev corner", "en")).toBe("👩‍💻");
    expect(initialOf("́accent", "en")).toBe("A");
    expect(initialOf("  spaced", "en")).toBe("S");
    expect(initialOf("istanbul", "tr")).toBe("İ");
    expect(initialOf("", "en")).toBe("");
  });
});
