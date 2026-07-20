import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { GuardrailsConfigLoader } from "./loader.js";
import * as settings from "./settings.js";

describe("GuardrailsConfigLoader", () => {
  let loader: GuardrailsConfigLoader;

  beforeEach(() => {
    vi.spyOn(settings, "loadEnabledSetting").mockResolvedValue({
      enabled: true,
    });
    vi.spyOn(settings, "saveEnabledSetting").mockResolvedValue({ enabled: true });
    loader = new GuardrailsConfigLoader();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("starts enabled", () => {
    expect(loader.enabled).toBe(true);
  });

  it("loads enabled state from settings", async () => {
    await loader.load();
    expect(settings.loadEnabledSetting).toHaveBeenCalledWith("guardrails", {
      enabled: true,
    });
    expect(loader.enabled).toBe(true);
  });

  it("loads disabled state from settings", async () => {
    vi.spyOn(settings, "loadEnabledSetting").mockResolvedValue({
      enabled: false,
    });
    await loader.load();
    expect(loader.enabled).toBe(false);
  });

  it("saves enabled state to settings", async () => {
    loader.enabled = false;
    await loader.save();
    expect(settings.saveEnabledSetting).toHaveBeenCalledWith(
      "guardrails",
      { enabled: false },
      expect.any(Function),
    );
  });
});
