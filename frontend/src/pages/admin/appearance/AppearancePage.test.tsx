import { cleanup, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { AdminInstance, StoredImage, UploadedImage } from "../../../api";
import { ReloadInstanceContext } from "../../../instance";
import { getAnnouncer, mockApi, renderWithProviders, type Routes, sentBody } from "../../../test-utils";
import { AppearancePage } from "./AppearancePage";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  document.head.querySelector('link[rel="icon"]')?.remove();
});

const DEFAULTS: AdminInstance = { title: null, logo: null, theme: null };
const STORED_LOGO: StoredImage = { id: "0123456789abcdef0123456789abcdef", type: "image/svg+xml", width: 24, height: 24, size: 1536 };
const LOGO: UploadedImage = { ...STORED_LOGO, sanitized: false };

function renderPage(routes: Routes) {
  const fetchMock = mockApi(routes);
  const reload = vi.fn(async () => {});
  renderWithProviders(
    <ReloadInstanceContext value={reload}>
      <AppearancePage />
    </ReloadInstanceContext>,
  );
  return { fetchMock, reload };
}

const block = async (name: string) => screen.findByRole("region", { name });
const calls = (fetchMock: ReturnType<typeof mockApi>, key: string) =>
  fetchMock.mock.calls.flatMap((call, n) => (`${call[1]?.method ?? "GET"} ${call[0]}` === key ? [n] : []));
const png = (bytes: number) => new File([new Uint8Array(bytes)], "logo.png", { type: "image/png" });

describe("AppearancePage: title", () => {
  it("saves the title, announces it without moving the focus, and an empty title goes back to the default", async () => {
    const { fetchMock, reload } = renderPage({
      "GET /api/admin/instance": { status: 200, body: { ...DEFAULTS, title: "Lab" } },
      "PATCH /api/admin/instance": [
        { status: 200, body: { ...DEFAULTS, title: "Home lab" } },
        { status: 200, body: DEFAULTS },
      ],
    });
    const user = userEvent.setup();
    const field = within(await block("Title")).getByLabelText("Instance title");
    expect(field).toHaveValue("Lab");
    await user.clear(field);
    await user.type(field, "  Home lab ");
    const save = screen.getByRole("button", { name: "Save the title" });
    await user.click(save);
    await waitFor(() => expect(getAnnouncer()).toHaveTextContent("Title saved."));
    expect(sentBody(fetchMock, 1)).toEqual({ title: "Home lab" });
    expect(reload).toHaveBeenCalledTimes(1);
    expect(save).toHaveFocus();

    await user.clear(field);
    await user.click(save);
    await waitFor(() => expect(reload).toHaveBeenCalledTimes(2));
    expect(sentBody(fetchMock, 2)).toEqual({ title: null });
  });

  it("puts a refusal of the server on the field", async () => {
    renderPage({
      "GET /api/admin/instance": { status: 200, body: DEFAULTS },
      "PATCH /api/admin/instance": { status: 422, body: { error: { code: "invalid_input", message: "", fields: { title: "invalid_title" } } } },
    });
    const user = userEvent.setup();
    await user.type(within(await block("Title")).getByLabelText("Instance title"), "x");
    await user.click(screen.getByRole("button", { name: "Save the title" }));
    expect(await screen.findAllByText("Enter a title of 1 to 60 characters, or empty it to show YASAD.")).not.toHaveLength(0);
    expect(screen.getByLabelText("Instance title")).toHaveAttribute("aria-invalid", "true");
  });
});

describe("AppearancePage: logo", () => {
  it("uploads a file at once and previews it, then saves it and points the tab icon at it", async () => {
    const icon = document.createElement("link");
    icon.rel = "icon";
    icon.href = "/api/instance/icon";
    document.head.append(icon);
    const { fetchMock, reload } = renderPage({
      "GET /api/admin/instance": [{ status: 200, body: DEFAULTS }],
      "POST /api/admin/images": { status: 201, body: { image: { ...LOGO, sanitized: true } } },
      "PATCH /api/admin/instance": { status: 200, body: { ...DEFAULTS, logo: STORED_LOGO } },
    });
    const user = userEvent.setup();
    const region = await block("Logo");
    expect(within(region).getByText("YASAD logo, by default.")).toBeInTheDocument();
    const input = within(region).getByLabelText("Choose an image");
    await user.upload(input, new File(["<svg/>"], "logo.svg", { type: "image/svg+xml" }));
    expect(await within(region).findByRole("img", { name: "New logo" })).toHaveAttribute("src", `/api/images/${LOGO.id}`);
    expect(within(region).getByText("SVG, 24 × 24 px, 1.5 KiB")).toBeInTheDocument();
    expect(within(region).getByText("Elements that are not allowed were removed.")).toBeInTheDocument();
    expect(getAnnouncer()).toHaveTextContent("Image ready: save the logo to apply it.");
    expect(input).toHaveFocus();
    expect(sentBody(fetchMock, calls(fetchMock, "POST /api/admin/images")[0]!)).toEqual({ data: btoa("<svg/>") });
    expect(calls(fetchMock, "PATCH /api/admin/instance")).toEqual([]);

    await user.click(within(region).getByRole("button", { name: "Save the logo" }));
    await waitFor(() => expect(getAnnouncer()).toHaveTextContent("Logo saved."));
    expect(sentBody(fetchMock, calls(fetchMock, "PATCH /api/admin/instance")[0]!)).toEqual({ logo: LOGO.id });
    expect(reload).toHaveBeenCalledTimes(1);
    expect(icon.getAttribute("href")).toBe(`/api/instance/icon?v=${LOGO.id}`);
    expect(within(region).getByRole("img", { name: "Current logo" })).toBeInTheDocument();
    expect(within(region).getByRole("button", { name: "Remove the logo" })).toBeInTheDocument();
  });

  it("refuses a file too large before sending it, under the field, with the limit in figures", async () => {
    const { fetchMock } = renderPage({ "GET /api/admin/instance": { status: 200, body: DEFAULTS } });
    const user = userEvent.setup();
    const region = await block("Logo");
    const input = within(region).getByLabelText("Choose an image");
    await user.upload(input, png(300 * 1024));
    const error = await within(region).findByText("300 KiB, 256 KiB at most.");
    expect(input).toHaveAttribute("aria-invalid", "true");
    expect(input.getAttribute("aria-describedby")!.split(" ")).toContain(error.closest("p")!.id);
    expect(getAnnouncer()).toHaveTextContent("300 KiB, 256 KiB at most.");
    expect(input).toHaveFocus();
    expect(calls(fetchMock, "POST /api/admin/images")).toEqual([]);
  });

  it.each([
    [{ code: "invalid_image", reason: "dimensions", max: 2048 }, "This image is too large: 2,048 px per side at most."],
    [{ code: "invalid_image", reason: "animated" }, "Animated images are not accepted: use a still image."],
    [{ code: "invalid_image", reason: "too_large", max: 262144 }, "This image is too large: 256 KiB at most."],
    [{ code: "images_full", max: 1000 }, "Too many images are stored. An image no longer used is removed after a day: try again later."],
  ])("explains the server's refusal %o", async (error, text) => {
    renderPage({
      "GET /api/admin/instance": { status: 200, body: DEFAULTS },
      "POST /api/admin/images": { status: error.code === "images_full" ? 409 : 422, body: { error: { message: "", ...error } } },
    });
    const user = userEvent.setup();
    const region = await block("Logo");
    const input = within(region).getByLabelText("Choose an image");
    await user.upload(input, png(64));
    expect(await within(region).findByText(text)).toBeInTheDocument();
    expect(input).toHaveAttribute("aria-invalid", "true");
    expect(screen.queryByRole("button", { name: "Save the logo" })).not.toBeInTheDocument();
  });

  it("removes the logo without confirmation", async () => {
    const { fetchMock } = renderPage({
      "GET /api/admin/instance": { status: 200, body: { ...DEFAULTS, logo: STORED_LOGO } },
      "PATCH /api/admin/instance": { status: 200, body: DEFAULTS },
    });
    const user = userEvent.setup();
    const region = await block("Logo");
    expect(within(region).getByRole("img", { name: "Current logo" })).toHaveAttribute("src", `/api/images/${LOGO.id}`);
    await user.click(within(region).getByRole("button", { name: "Remove the logo" }));
    await waitFor(() => expect(getAnnouncer()).toHaveTextContent("Logo removed: YASAD's shows again."));
    expect(sentBody(fetchMock, 1)).toEqual({ logo: null });
    expect(within(region).getByText("YASAD logo, by default.")).toBeInTheDocument();
    expect(within(region).queryByRole("button", { name: "Remove the logo" })).not.toBeInTheDocument();
  });

  it("says a logo was set outside the application, and offers to remove it", async () => {
    renderPage({ "GET /api/admin/instance": { status: 200, body: { ...DEFAULTS, logo: { legacy: "/logo.svg" } } } });
    const region = await block("Logo");
    expect(within(region).getByText("Logo set outside the application.")).toBeInTheDocument();
    expect(within(region).getByRole("button", { name: "Remove the logo" })).toBeInTheDocument();
  });

  it("asks for the image again when it is no longer stored", async () => {
    renderPage({
      "GET /api/admin/instance": { status: 200, body: DEFAULTS },
      "POST /api/admin/images": { status: 201, body: { image: LOGO } },
      "PATCH /api/admin/instance": { status: 422, body: { error: { code: "unknown_image", message: "" } } },
    });
    const user = userEvent.setup();
    const region = await block("Logo");
    await user.upload(within(region).getByLabelText("Choose an image"), png(64));
    await user.click(await within(region).findByRole("button", { name: "Save the logo" }));
    expect(await within(region).findAllByText("This image is no longer stored: choose it again.")).not.toHaveLength(0);
    expect(within(region).queryByRole("button", { name: "Save the logo" })).not.toBeInTheDocument();
  });
});

describe("AppearancePage: default theme", () => {
  it("applies a theme only once saved, and the default theme clears the setting", async () => {
    const { fetchMock, reload } = renderPage({
      "GET /api/admin/instance": { status: 200, body: DEFAULTS },
      "PATCH /api/admin/instance": [
        { status: 200, body: { ...DEFAULTS, theme: "dusk" } },
        { status: 200, body: DEFAULTS },
      ],
    });
    const user = userEvent.setup();
    const region = await block("Default theme");
    const group = within(region).getByRole("group", { name: "Theme" });
    expect(group).toHaveAccessibleDescription("Everyone keeps their light, dark or system choice.");
    expect(within(group).getByRole("radio", { name: "YASAD" })).toBeChecked();
    await user.click(within(group).getByRole("radio", { name: "Dusk" }));
    expect(calls(fetchMock, "PATCH /api/admin/instance")).toEqual([]);
    await user.click(within(region).getByRole("button", { name: "Save the theme" }));
    await waitFor(() => expect(reload).toHaveBeenCalledTimes(1));
    expect(sentBody(fetchMock, 1)).toEqual({ theme: "dusk" });
    await user.click(within(group).getByRole("radio", { name: "YASAD" }));
    await user.click(within(region).getByRole("button", { name: "Save the theme" }));
    await waitFor(() => expect(reload).toHaveBeenCalledTimes(2));
    expect(sentBody(fetchMock, 2)).toEqual({ theme: null });
  });
});
