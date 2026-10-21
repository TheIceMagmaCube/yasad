import { CircleCheck, CircleQuestionMark, CircleX } from "lucide-react";
import { describe, expect, it } from "vitest";

import type { AdminLinkStatus, CheckSettings } from "@/api";

import { effectiveStatus, statusIcon } from "./link-status";

const NOW = Date.parse("2026-10-21T12:00:00.000Z");
const CHECKS: CheckSettings = { intervalMinutes: 5, staleAfterMinutes: 15, checked: 1, capacity: null };
const ago = (minutes: number) => new Date(NOW - minutes * 60_000).toISOString();
const checked = (status: AdminLinkStatus | null) => ({ check: true, status });

describe("effectiveStatus", () => {
  it("gives nothing for a link that is not checked", () => {
    expect(effectiveStatus({ check: false, status: null }, CHECKS, NOW)).toBeNull();
    const old = { state: "down" as const, reason: "http_error", httpStatus: 502, checkedAt: ago(1) };
    expect(effectiveStatus({ check: false, status: old }, CHECKS, NOW)).toBeNull();
  });

  it("reads unknown, not checked yet, for a checked link without a result", () => {
    expect(effectiveStatus(checked(null), CHECKS, NOW)).toEqual({ state: "unknown", reason: "not_checked_yet", httpStatus: null, checkedAt: null });
  });

  it("keeps a fresh result as stored", () => {
    const down = { state: "down" as const, reason: "http_error", httpStatus: 502, checkedAt: ago(3) };
    expect(effectiveStatus(checked(down), CHECKS, NOW)).toEqual(down);
  });

  it("turns a result older than the limit into unknown, stale, keeping its time and HTTP status", () => {
    const up = { state: "up" as const, reason: null, httpStatus: 200, checkedAt: ago(16) };
    expect(effectiveStatus(checked(up), CHECKS, NOW)).toEqual({ state: "unknown", reason: "stale", httpStatus: 200, checkedAt: up.checkedAt });
  });

  it("keeps a result exactly at the limit as stored", () => {
    const up = { state: "up" as const, reason: null, httpStatus: 200, checkedAt: ago(15) };
    expect(effectiveStatus(checked(up), CHECKS, NOW)).toEqual(up);
  });

  it("never turns a result stale while the check settings are unknown", () => {
    const up = { state: "up" as const, reason: null, httpStatus: 200, checkedAt: ago(60 * 24) };
    expect(effectiveStatus(checked(up), null, NOW)).toEqual(up);
  });
});

describe("statusIcon", () => {
  it("gives one shape per state", () => {
    expect(statusIcon("up")).toBe(CircleCheck);
    expect(statusIcon("down")).toBe(CircleX);
    expect(statusIcon("unknown")).toBe(CircleQuestionMark);
  });
});
