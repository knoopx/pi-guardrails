import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { GuardrailsConfigLoader } from "./loader.js";

// ── Mock node:fs/promises ──────────────────────────────────────────────────
const mockReadFile = vi.fn();
const mockWriteFile = vi.fn();

vi.mock("node:fs/promises", () => ({
  readFile: vi.fn().mockImplementation((path: string, _opts: string) =>
    mockReadFile(path),
  ),
  writeFile: vi.fn().mockImplementation(
    (path: string, data: string, ...rest: string[]) => mockWriteFile(path, data, ...rest),
  ),
}));

// ── Mock node:os ───────────────────────────────────────────────────────────
vi.mock("node:os", () => ({
  homedir: () => "/tmp/test-home",
}));

// ── Mock node:path ────────────────────────────────────────────────────────
vi.mock("node:path", () => ({
  resolve: (dir: string, file: string) => `${dir}/${file}`,
}));

// ── Import settings (mocks already applied) ───────────────────────────────
const { loadEnabledSetting, saveEnabledSetting } = await import(
  "./settings.js"
);

// ──────────────────────────────────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────────────────────────────────

async function expectLoadENOENT(key: string, defaults: { enabled: boolean }) {
  mockReadFile.mockRejectedValueOnce({ code: "ENOENT" });
  const result = await loadEnabledSetting(key, defaults);
  expect(result).toEqual(defaults);
}

async function expectLoadResolved(
  inputJson: string,
  key: string,
  defaults: { enabled: boolean },
  expected: { enabled: boolean },
) {
  mockReadFile.mockResolvedValueOnce(inputJson);
  const result = await loadEnabledSetting(key, defaults);
  expect(result).toEqual(expected);
}

async function expectSaveOverwrite(inputValue: unknown, expected: object) {
  mockReadFile.mockResolvedValueOnce(JSON.stringify({ guardrails: inputValue }));
  mockWriteFile.mockResolvedValueOnce(undefined);
  await saveEnabledSetting(
    "guardrails",
    { enabled: false },
    async () => ({ enabled: true }),
  );
  const writeCall = mockWriteFile.mock.calls[0][1] as string;
  const written = JSON.parse(writeCall);
  expect(written.guardrails).toEqual(expected);
}

// ──────────────────────────────────────────────────────────────────────────
// loadEnabledSetting
// ──────────────────────────────────────────────────────────────────────────

describe("loadEnabledSetting", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns defaults when settings file is missing (ENOENT)", () => expectLoadENOENT("guardrails", { enabled: true }));

  it("returns defaults when settings file is missing (ENOENT, different key)", () => expectLoadENOENT("test", { enabled: false }));

  it("returns defaults when key is not in settings", () => expectLoadResolved(JSON.stringify({ other: true }), "guardrails", { enabled: true }, { enabled: true }));

  it("returns defaults when value is an array", () => expectLoadResolved(JSON.stringify({ guardrails: [true] }), "guardrails", { enabled: true }, { enabled: true }));

  it("returns enabled=false when set in settings", () => expectLoadResolved(JSON.stringify({ guardrails: { enabled: false } }), "guardrails", { enabled: true }, { enabled: false }));

  it("returns defaults when enabled is missing in settings value", async () => {
    const input = JSON.stringify({ guardrails: { other: "x" } });
    await expectLoadResolved(input, "guardrails", { enabled: true }, { enabled: true });
  });

  it("throws when settings file cannot be read (non-ENOENT)", async () => {
    mockReadFile.mockRejectedValueOnce(new Error("Permission denied"));
    await expect(
      loadEnabledSetting("guardrails", { enabled: true }),
    ).rejects.toThrow("Unable to read settings.json safely");
  });

  it("throws when settings file contains non-object JSON (array)", async () => {
    // JSON.parse of array succeeds, isValidSettingsObject fails, but the outer
    // catch re-wraps the error into "Unable to read settings.json safely"
    mockReadFile.mockResolvedValueOnce(JSON.stringify([1, 2, 3]));
    await expect(
      loadEnabledSetting("guardrails", { enabled: true }),
    ).rejects.toThrow("Unable to read settings.json safely");
  });

  it("throws when settings value for key is not an object (string)", async () => {
    mockReadFile.mockResolvedValueOnce(JSON.stringify({ guardrails: "invalid" }));
    await expect(
      loadEnabledSetting("guardrails", { enabled: true }),
    ).rejects.toThrow("Invalid guardrails settings format in settings.json");
  });

  it("throws when settings value for key is null", async () => {
    mockReadFile.mockResolvedValueOnce(JSON.stringify({ guardrails: null }));
    await expect(
      loadEnabledSetting("guardrails", { enabled: true }),
    ).rejects.toThrow("Invalid guardrails settings format in settings.json");
  });

  it("includes extra fields from settings via defaults spread", async () => {
    const input = JSON.stringify({ guardrails: { enabled: false, extra: "data" } });
    await expectLoadResolved(input, "guardrails", { enabled: true }, { enabled: false });
  });
});

// ──────────────────────────────────────────────────────────────────────────
// saveEnabledSetting
// ──────────────────────────────────────────────────────────────────────────

describe("saveEnabledSetting", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("writes settings to file", async () => {
    mockReadFile.mockResolvedValueOnce(JSON.stringify({}));
    mockWriteFile.mockResolvedValueOnce(undefined);

    const result = await saveEnabledSetting(
      "guardrails",
      { enabled: false },
      async () => ({ enabled: true }),
    );

    expect(result).toEqual({ enabled: false });
    expect(mockWriteFile).toHaveBeenCalledWith(
      "/tmp/test-home/.pi/agent/settings.json",
      JSON.stringify({ guardrails: { enabled: false } }, null, 2) + "\n",
      "utf-8",
    );
  });

  it("preserves existing settings for other keys", async () => {
    mockReadFile.mockResolvedValueOnce(JSON.stringify({ other: true }));
    mockWriteFile.mockResolvedValueOnce(undefined);

    await saveEnabledSetting(
      "guardrails",
      { enabled: false },
      async () => ({ enabled: true }),
    );

    const writeCall = mockWriteFile.mock.calls[0][1] as string;
    const written = JSON.parse(writeCall);
    expect(written).toHaveProperty("other", true);
    expect(written).toHaveProperty("guardrails");
  });

  it("creates key when it does not exist", async () => {
    mockReadFile.mockResolvedValueOnce(JSON.stringify({}));
    mockWriteFile.mockResolvedValueOnce(undefined);

    await saveEnabledSetting(
      "newkey",
      { enabled: false },
      async () => ({ enabled: true }),
    );

    const writeCall = mockWriteFile.mock.calls[0][1] as string;
    const written = JSON.parse(writeCall);
    expect(written).toHaveProperty("newkey");
  });

  it("updates existing key", async () => {
    mockReadFile.mockResolvedValueOnce(
      JSON.stringify({ guardrails: { enabled: true } }),
    );
    mockWriteFile.mockResolvedValueOnce(undefined);

    await saveEnabledSetting(
      "guardrails",
      { enabled: false },
      async () => ({ enabled: false }),
    );

    const writeCall = mockWriteFile.mock.calls[0][1] as string;
    const written = JSON.parse(writeCall);
    expect(written.guardrails.enabled).toBe(false);
  });

  it("handles missing settings file gracefully", async () => {
    mockReadFile.mockRejectedValueOnce({ code: "ENOENT" });
    mockWriteFile.mockResolvedValueOnce(undefined);

    const result = await saveEnabledSetting(
      "guardrails",
      { enabled: false },
      async () => ({ enabled: true }),
    );

    expect(result).toEqual({ enabled: false });
  });

  it("throws when settings file cannot be read (non-ENOENT)", async () => {
    mockReadFile.mockRejectedValueOnce(new Error("Permission denied"));
    await expect(
      saveEnabledSetting(
        "guardrails",
        { enabled: false },
        async () => ({ enabled: true }),
      ),
    ).rejects.toThrow("Unable to read settings.json safely");
  });

  it("handles existing settings value that is a string", () => expectSaveOverwrite("string", { enabled: false }));

  it("handles existing settings value that is an array", () => expectSaveOverwrite([true], { enabled: false }));
});
