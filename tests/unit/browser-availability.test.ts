import { describe, it, expect } from "vitest";
import {
  friendlyLaunchError,
  pickAvailableEngines,
  type EngineType,
} from "../../src/browser.js";

const ALL_ENGINES: EngineType[] = ["chromium", "firefox", "webkit"];

function state(unavailableReason: string | null, unavailableUntil = 0) {
  return { unavailableUntil, unavailableReason };
}

describe("friendlyLaunchError", () => {
  it("turns the raw 'Executable doesn't exist' error into an install hint", () => {
    const raw = new Error(
      "browserType.launch: Executable doesn't exist at /home/user/.cache/ms-playwright/chromium_headless_shell-1217/chrome-headless-shell-linux64/chrome-headless-shell\n" +
        "Looks like Playwright was just installed or updated. Please run the following command to download new browsers:\n" +
        "npx playwright install",
    );
    const message = friendlyLaunchError("chromium", raw);
    expect(message).toContain("npx playwright install chromium");
    expect(message).not.toContain("browserType.launch");
  });

  it("names the engine that is missing its binaries", () => {
    const message = friendlyLaunchError(
      "firefox",
      new Error("Executable doesn't exist at ~/.cache/ms-playwright/firefox-1234/firefox/firefox"),
    );
    expect(message).toContain("firefox");
    expect(message).toContain("npx playwright install firefox");
  });

  it("wraps unrelated launch failures without swallowing the cause", () => {
    const message = friendlyLaunchError("webkit", new Error("spawn ENOENT"));
    expect(message).toBe("Failed to launch webkit browser: spawn ENOENT");
  });

  it("handles non-Error throws", () => {
    const message = friendlyLaunchError("chromium", "boom");
    expect(message).toContain("boom");
  });
});

describe("pickAvailableEngines", () => {
  it("keeps all engines when none are marked unavailable", () => {
    const picked = pickAvailableEngines(
      ALL_ENGINES,
      ALL_ENGINES.map(() => state(null)),
      1000,
    );
    expect(picked).toEqual(ALL_ENGINES);
  });

  it("skips engines whose cooldown has not expired", () => {
    const picked = pickAvailableEngines(
      ALL_ENGINES,
      [state(null), state("not installed", 5000), state(null)],
      1000,
    );
    expect(picked).toEqual(["chromium", "webkit"]);
  });

  it("lets an engine back in once its cooldown expired", () => {
    const picked = pickAvailableEngines(
      ALL_ENGINES,
      [state(null), state("not installed", 5000), state(null)],
      5000,
    );
    expect(picked).toEqual(ALL_ENGINES);
  });

  it("falls back to every engine when all are cooling down", () => {
    const picked = pickAvailableEngines(
      ALL_ENGINES,
      ALL_ENGINES.map(() => state("not installed", 5000)),
      1000,
    );
    expect(picked).toEqual(ALL_ENGINES);
  });
});
