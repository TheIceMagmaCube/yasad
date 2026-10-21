import { cleanup, fireEvent, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ICONS_BASE } from "../icons-base";
import { InstanceContext } from "../instance";
import { mockApi, renderWithProviders } from "../test-utils";
import { About } from "./About";

const REPO = "https://github.com/TheIceMagmaCube/yasad";
const SOURCE = { repository: REPO, tree: `${REPO}/tree/v0.2.0`, license: `${REPO}/blob/v0.2.0/LICENSE` };
const USER_BODY = { version: "0.2.0", source: SOURCE };
const ADMIN_BODY = { ...USER_BODY, instance: { runtime: "docker", catalogManagedByFile: true } };
const instance = { title: "YASAD", logo: null, theme: "default", defaultLanguage: "en", passwordSignIn: true, oidc: null } as const;

/** Click the element and return true when the browser would follow the link; the following itself is cancelled, jsdom cannot load pages. */
function clickFollows(element: Element, init?: MouseEventInit): boolean {
  let follows = false;
  const listener = (e: Event) => {
    follows = !e.defaultPrevented;
    e.preventDefault();
  };
  document.addEventListener("click", listener);
  fireEvent.click(element, init);
  document.removeEventListener("click", listener);
  return follows;
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  localStorage.removeItem("yasad.language");
  document.documentElement.lang = "en";
});

describe("About", () => {
  it("shows the version, the source and the licence to a user, without the instance section", async () => {
    mockApi({ "GET /api/about": { status: 200, body: USER_BODY } });
    renderWithProviders(<About />);
    expect(await screen.findByText("0.2.0")).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "This instance" })).toBeNull();
    const source = screen.getByRole("link", { name: "TheIceMagmaCube/yasad on GitHub" });
    expect(source).toHaveAttribute("href", SOURCE.tree);
    expect(screen.getByRole("link", { name: "GNU AGPL 3.0" })).toHaveAttribute("href", SOURCE.license);
    expect(screen.queryByText("(build without a version number)")).toBeNull();
    for (const link of screen.getAllByRole("link")) {
      if (link.getAttribute("href")!.startsWith("https://")) expect(link).toHaveAttribute("rel", "noreferrer");
    }
  });

  it("shows the platform and the catalog source to an admin", async () => {
    mockApi({ "GET /api/about": { status: 200, body: ADMIN_BODY } });
    renderWithProviders(<About />);
    const heading = await screen.findByRole("heading", { level: 2, name: "This instance" });
    const section = heading.closest("section")!;
    expect(section).toHaveAccessibleName("This instance");
    expect(within(section).getByText("Docker")).toBeInTheDocument();
    expect(within(section).getByText("Loaded from CATALOG_FILE at startup")).toBeInTheDocument();
  });

  it("names the other platform and catalog state", async () => {
    mockApi({ "GET /api/about": { status: 200, body: { ...USER_BODY, instance: { runtime: "workers", catalogManagedByFile: false } } } });
    renderWithProviders(<About />);
    expect(await screen.findByText("Cloudflare Workers")).toBeInTheDocument();
    expect(screen.getByText("Edited in the administration")).toBeInTheDocument();
  });

  it("says when the build has no version number", async () => {
    mockApi({ "GET /api/about": { status: 200, body: { version: "dev", source: { repository: REPO, tree: REPO, license: `${REPO}/blob/main/LICENSE` } } } });
    renderWithProviders(<About />);
    expect(await screen.findByText("(build without a version number)")).toBeInTheDocument();
    expect(screen.getByText("dev")).toBeInTheDocument();
  });

  it("links the icon notice as a plain link the browser follows", async () => {
    mockApi({ "GET /api/about": { status: 200, body: USER_BODY } });
    renderWithProviders(<About />);
    const notice = await screen.findByRole("link", { name: "Detailed icon licences (text, in English)" });
    expect(notice).toHaveAttribute("href", `${ICONS_BASE}/NOTICE.txt`);
    expect(notice).toHaveAttribute("hreflang", "en");
    const before = location.pathname;
    expect(clickFollows(notice)).toBe(true);
    expect(location.pathname).toBe(before);
  });

  it("orders its headings and marks the licence names as English", async () => {
    mockApi({ "GET /api/about": { status: 200, body: USER_BODY } });
    renderWithProviders(<About />);
    expect(screen.getByRole("heading", { level: 1, name: "About" })).toBeInTheDocument();
    expect(await screen.findByRole("heading", { level: 2, name: "Credits" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 3, name: "Fonts" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 3, name: "Icons" })).toBeInTheDocument();
    const names = screen.getAllByText("SIL Open Font License 1.1");
    expect(names.length).toBeGreaterThan(0);
    for (const name of names) expect(name).toHaveAttribute("lang", "en");
    expect(screen.getByRole("link", { name: "Inter" })).toHaveAttribute("rel", "noreferrer");
    expect(screen.getByRole("link", { name: "Lucide" })).toHaveAttribute("href", "https://lucide.dev");
    expect(screen.getByRole("link", { name: "Simple Icons" })).toHaveAttribute("href", "https://simpleicons.org");
  });

  it("names the instance in its description, and itself when the instance keeps the default title", () => {
    mockApi({ "GET /api/about": { status: 200, body: USER_BODY } });
    const { unmount } = renderWithProviders(
      <InstanceContext value={{ ...instance, title: "Home lab" }}>
        <About />
      </InstanceContext>,
    );
    expect(screen.getByText("Home lab runs on YASAD, a free, self-hosted portal.")).toBeInTheDocument();
    expect(document.title).toBe("About - Home lab");
    unmount();
    renderWithProviders(<About />);
    expect(screen.getByText("YASAD is a free, self-hosted portal.")).toBeInTheDocument();
    expect(document.title).toBe("About - YASAD");
  });

  it("offers a retry after a failed load", async () => {
    mockApi({ "GET /api/about": [{ status: 500 }, { status: 200, body: USER_BODY }] });
    renderWithProviders(<About />);
    expect(await screen.findByRole("alert")).toHaveTextContent("Something went wrong. Try again.");
    await userEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByText("0.2.0")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("speaks French", async () => {
    localStorage.setItem("yasad.language", "fr");
    mockApi({ "GET /api/about": { status: 200, body: ADMIN_BODY } });
    renderWithProviders(<About />);
    expect(screen.getByRole("heading", { level: 1, name: "À propos" })).toBeInTheDocument();
    expect(await screen.findByRole("link", { name: "TheIceMagmaCube/yasad sur GitHub" })).toBeInTheDocument();
    expect(screen.getByText("Chargé depuis CATALOG_FILE au démarrage")).toBeInTheDocument();
    expect(screen.getByText(/ISC ; MIT pour les icônes issues de Feather/)).toBeInTheDocument();
  });
});
