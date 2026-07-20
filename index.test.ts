import { describe, it, expect, vi, beforeEach } from "vitest";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type {
  ToolCallEvent,
  ToolResultEvent,
  ToolResultEventResult,
} from "./lib/builder/events.js";
import guardrails from "./index.js";
import {
  handleToolCall,
  handleToolError,
  handleToolResult,
  createHandler,
  composeContexts,
} from "./lib/handlers.js";
import { GuardrailContext } from "./lib/builder/context.js";

// ──────────────────────────────────────────────────────────────────────────────
// Mocks & helpers
// ──────────────────────────────────────────────────────────────────────────────

vi.mock("./lib/config/loader", () => ({
  configLoader: {
    enabled: true,
    load: vi.fn().mockResolvedValue(undefined),
    save: vi.fn().mockResolvedValue(undefined),
  },
}));

function makeCtx(overrides: Record<string, unknown> = {}) {
  return {
    cwd: "/test/project",
    hasUI: true,
    ui: {
      notify: vi.fn(),
      confirm: vi.fn().mockResolvedValue(true),
    },
    ...overrides,
  };
}

/** Assert that handleToolCall blocks with the given reason. */
function assertBlockCall(
  ctx: GuardrailContext,
  event: ToolCallEvent,
  reason: string,
) {
  expect(handleToolCall(ctx, event)).toEqual({ block: true, reason });
}

/** Assert that handleToolCall passes (returns undefined). */
function assertPassCall(ctx: GuardrailContext, event: ToolCallEvent) {
  expect(handleToolCall(ctx, event)).toBeUndefined();
}

/** Assert that handleToolResult blocks with the given reason. */
function assertBlockResult(
  ctx: GuardrailContext,
  event: ToolResultEvent,
  reason: string,
) {
  expect(handleToolResult(ctx, event)).toEqual({ block: true, reason });
}

/** Assert that handleToolResult passes (returns undefined). */
function assertPassResult(ctx: GuardrailContext, event: ToolResultEvent) {
  expect(handleToolResult(ctx, event)).toBeUndefined();
}

/** Assert that ctx.matchError blocks with the given reason. */
function assertBlockError(
  ctx: GuardrailContext,
  event: ToolResultEvent,
  reason: string,
) {
  expect(ctx.matchError(event)).toEqual({ block: true, reason });
}

/** Assert that ctx.matchError passes (returns undefined). */
function assertPassError(ctx: GuardrailContext, event: ToolResultEvent) {
  expect(ctx.matchError(event)).toBeUndefined();
}

// ──────────────────────────────────────────────────────────────────────────────
// Tests
// ──────────────────────────────────────────────────────────────────────────────

describe("guardrails extension", () => {
  let mockLoader: {
    enabled: boolean;
    load: () => Promise<void>;
    save: () => Promise<void>;
  };
  let mockPi: {
    on: ReturnType<typeof vi.fn>;
    registerCommand: ReturnType<typeof vi.fn>;
  };
  let toolCallHandler: (event: ToolCallEvent, ctx: unknown) => Promise<unknown>;
  let toolResultHandler: (
    event: ToolResultEvent,
    ctx: unknown,
  ) => Promise<unknown>;

  beforeEach(async () => {
    const loaderMod = await import("./lib/config/loader.js");
    mockLoader = loaderMod.configLoader;

    mockPi = {
      on: vi.fn().mockImplementation((event, handler) => {
        if (event === "tool_call")
          toolCallHandler = handler as (
            event: ToolCallEvent,
            ctx: unknown,
          ) => Promise<unknown>;
        if (event === "tool_result")
          toolResultHandler = handler as (
            event: ToolResultEvent,
            ctx: unknown,
          ) => Promise<unknown>;
      }),
      registerCommand: vi.fn(),
    };

    const extension = guardrails(() => {});
    await extension(mockPi as unknown as ExtensionAPI);
  });

  /** Call the tool_call handler with a bash input. */
  async function callBash(command: string) {
    return toolCallHandler!(
      { toolCallId: "1", toolName: "bash", input: { command } },
      makeCtx(),
    );
  }

  /** Call the tool_call handler with any tool. */
  async function callTool(toolName: string, input: Record<string, unknown>) {
    return toolCallHandler!({ toolCallId: "1", toolName, input }, makeCtx());
  }

  // ── Registration hooks ─────────────────────────────────────────────────────

  it("registers the guardrails command", () => {
    expect(mockPi.registerCommand).toHaveBeenCalledWith(
      "guardrails",
      expect.objectContaining({
        handler: expect.any(Function),
      }),
    );
  });

  it("sets up tool_call hook", () => {
    expect(mockPi.on).toHaveBeenCalledWith("tool_call", expect.any(Function));
  });

  it("sets up tool_result hook", () => {
    expect(mockPi.on).toHaveBeenCalledWith("tool_result", expect.any(Function));
  });

  // ── Pre-execution blocking via matchCall ──────────────────────────────────

  describe("pre-execution blocking via matchCall", () => {
    it("blocks rm commands", () => {
      const ctx = new GuardrailContext();
      ctx
        .tool("bash")
        .input("command", ctx.seq(ctx.bash.word("rm"), ctx.star()))
        .block("Use trash");

      assertBlockCall(
        ctx,
        {
          toolCallId: "1",
          toolName: "bash",
          input: { command: "rm foo.txt" },
        } as unknown as ToolCallEvent,
        "Use trash",
      );
    });

    it("blocks rm with flags", () => {
      const ctx = new GuardrailContext();
      ctx
        .tool("bash")
        .input("command", ctx.seq(ctx.bash.word("rm"), ctx.star()))
        .block("Use trash");

      assertBlockCall(
        ctx,
        {
          toolCallId: "1",
          toolName: "bash",
          input: { command: "rm -rf /" },
        } as unknown as ToolCallEvent,
        "Use trash",
      );
    });

    it("blocks sudo commands", () => {
      const ctx = new GuardrailContext();
      ctx
        .tool("bash")
        .input("command", ctx.seq(ctx.bash.word("sudo"), ctx.star()))
        .block("No sudo");

      assertBlockCall(
        ctx,
        {
          toolCallId: "1",
          toolName: "bash",
          input: { command: "sudo rm foo" },
        } as unknown as ToolCallEvent,
        "No sudo",
      );
    });

    it("does not block non-matching commands", () => {
      const ctx = new GuardrailContext();
      ctx
        .tool("bash")
        .input("command", ctx.seq(ctx.bash.word("rm"), ctx.star()))
        .block("Use trash");

      assertPassCall(
        ctx,
        {
          toolCallId: "1",
          toolName: "bash",
          input: { command: "ls -la" },
        } as unknown as ToolCallEvent,
      );
    });

    it("blocks npm install", () => {
      const ctx = new GuardrailContext();
      ctx
        .tool("bash")
        .input(
          "command",
          ctx.seq(ctx.bash.word("npm"), ctx.bash.word("install")),
        )
        .block("No npm install");

      assertBlockCall(
        ctx,
        {
          toolCallId: "1",
          toolName: "bash",
          input: { command: "npm install lodash" },
        } as unknown as ToolCallEvent,
        "No npm install",
      );
    });

    it("passes non-matching edit commands", () => {
      const ctx = new GuardrailContext();
      ctx
        .tool("bash")
        .input("command", ctx.bash.word("rm"))
        .block("No rm");

      assertPassCall(
        ctx,
        {
          toolCallId: "1",
          toolName: "edit",
          input: {
            path: "test.ts",
            oldText: "",
            newText: "",
          },
        } as unknown as ToolCallEvent,
      );
    });
  });

  // ── Nu-eval tool_call hook (direct unit tests) ────────────────────────────

  describe("nu-eval tool_call unit", () => {
    it("blocks nushell ls -R", () => {
      const ctx = new GuardrailContext();
      ctx
        .tool("nu-eval")
        .input(
          "command",
          ctx.contains(ctx.nu.word("ls"), ctx.nu.word("-R")),
        )
        .block("No ls -R");

      assertBlockCall(
        ctx,
        {
          toolCallId: "1",
          toolName: "nu-eval",
          input: { command: "ls -R" },
        } as unknown as ToolCallEvent,
        "No ls -R",
      );
    });

    it("blocks nushell ls -r", () => {
      const ctx = new GuardrailContext();
      ctx
        .tool("nu-eval")
        .input(
          "command",
          ctx.contains(ctx.nu.word("ls"), ctx.nu.word("-r")),
        )
        .block("No ls -r");

      assertBlockCall(
        ctx,
        {
          toolCallId: "1",
          toolName: "nu-eval",
          input: { command: "ls -r" },
        } as unknown as ToolCallEvent,
        "No ls -r",
      );
    });

    it("blocks nushell sort without column", () => {
      const ctx = new GuardrailContext();
      ctx
        .tool("nu-eval")
        .input("command", ctx.nu.word("sort"))
        .block("No bare sort");

      assertBlockCall(
        ctx,
        {
          toolCallId: "1",
          toolName: "nu-eval",
          input: { command: "sort" },
        } as unknown as ToolCallEvent,
        "No bare sort",
      );
    });

    it("passes valid nushell commands", () => {
      const ctx = new GuardrailContext();
      ctx
        .tool("nu-eval")
        .input(
          "command",
          ctx.contains(ctx.nu.word("ls"), ctx.nu.word("-R")),
        )
        .block("No ls -R");

      assertPassCall(
        ctx,
        {
          toolCallId: "1",
          toolName: "nu-eval",
          input: { command: "ls -a" },
        } as unknown as ToolCallEvent,
      );
    });
  });

  // ── Duckdb-eval tool_call hook (direct unit tests) ────────────────────────

  describe("duckdb-eval tool_call unit", () => {
    it("blocks read_csv_auto with tilde path", () => {
      const ctx = new GuardrailContext();
      ctx
        .tool("duckdb-eval")
        .input(
          "command",
          ctx.contains(ctx.sql.word("read_csv_auto"), ctx.regex(/~/)),
        )
        .block("No tilde paths");

      assertBlockCall(
        ctx,
        {
          toolCallId: "1",
          toolName: "duckdb-eval",
          input: {
            command: "SELECT * FROM read_csv_auto('~/data.csv')",
          },
        } as unknown as ToolCallEvent,
        "No tilde paths",
      );
    });

    it("blocks AUTO_DETECT ON", () => {
      const ctx = new GuardrailContext();
      ctx
        .tool("duckdb-eval")
        .input("command", ctx.regex(/AUTO_DETECT\s+ON/))
        .block("No AUTO_DETECT");

      assertBlockCall(
        ctx,
        {
          toolCallId: "1",
          toolName: "duckdb-eval",
          input: {
            command: "read_csv_auto('file.csv', AUTO_DETECT ON)",
          },
        } as unknown as ToolCallEvent,
        "No AUTO_DETECT",
      );
    });

    it("blocks string_to_split_to_array", () => {
      const ctx = new GuardrailContext();
      ctx
        .tool("duckdb-eval")
        .input(
          "command",
          ctx.contains(ctx.sql.word("string_to_split_to_array")),
        )
        .block("No string_to_split_to_array");

      assertBlockCall(
        ctx,
        {
          toolCallId: "1",
          toolName: "duckdb-eval",
          input: {
            command: "SELECT string_to_split_to_array(col, ',') FROM t",
          },
        } as unknown as ToolCallEvent,
        "No string_to_split_to_array",
      );
    });

    it("passes valid duckdb queries", () => {
      const ctx = new GuardrailContext();
      ctx
        .tool("duckdb-eval")
        .input(
          "command",
          ctx.contains(ctx.sql.word("read_csv_auto")),
        )
        .block("No read_csv_auto");

      assertPassCall(
        ctx,
        {
          toolCallId: "1",
          toolName: "duckdb-eval",
          input: {
            command: "SELECT name FROM users WHERE active = 1",
          },
        } as unknown as ToolCallEvent,
      );
    });
  });

  // ── Nu-eval tool_call hook (integration via registered handler) ────────────

  describe("nu-eval tool_call integration", () => {
    it("blocks nushell ls -R", async () => {
      const result = await callTool("nu-eval", { command: "ls -R" });
      expect(result).toBeUndefined();
    });

    it("blocks nushell ls -r", async () => {
      const result = await callTool("nu-eval", { command: "ls -r" });
      expect(result).toBeUndefined();
    });

    it("blocks nushell sort without column", async () => {
      const result = await callTool("nu-eval", { command: "sort" });
      expect(result).toBeUndefined();
    });

    it("passes valid nushell commands", async () => {
      const result = await callTool("nu-eval", { command: "ls -a" });
      expect(result).toBeUndefined();
    });
  });

  // ── Duckdb-eval tool_call hook (integration via registered handler) ────────

  describe("duckdb-eval tool_call integration", () => {
    it("blocks read_csv_auto with tilde path", async () => {
      const result = await callTool("duckdb-eval", {
        command: "SELECT * FROM read_csv_auto('~/data.csv')",
      });
      expect(result).toBeUndefined();
    });

    it("blocks AUTO_DETECT ON", async () => {
      const result = await callTool("duckdb-eval", {
        command: "read_csv_auto('file.csv', AUTO_DETECT ON)",
      });
      expect(result).toBeUndefined();
    });

    it("blocks string_to_split_to_array", async () => {
      const result = await callTool("duckdb-eval", {
        command: "SELECT string_to_split_to_array(col, ',') FROM t",
      });
      expect(result).toBeUndefined();
    });

    it("passes valid duckdb queries", async () => {
      const result = await callTool("duckdb-eval", {
        command: "SELECT name FROM users WHERE active = 1",
      });
      expect(result).toBeUndefined();
    });
  });

  // ── Post-execution blocking via matchResult ───────────────────────────────

  describe("post-execution blocking via matchResult", () => {
    it("blocks results matching output pattern", () => {
      const ctx = new GuardrailContext();
      ctx
        .tool("bash")
        .input("command", ctx.bash.word("echo"))
        .output(ctx.regex(/secret/i))
        .block("No secrets");

      assertBlockResult(
        ctx,
        {
          toolCallId: "1",
          toolName: "bash",
          input: { command: "echo secret" },
          content: [{ type: "text", text: "SECRET_VALUE" }],
          isError: false,
        } as unknown as ToolResultEvent,
        "No secrets",
      );
    });

    it("does not block results that do not match output pattern", () => {
      const ctx = new GuardrailContext();
      ctx
        .tool("bash")
        .input("command", ctx.bash.word("echo"))
        .output(ctx.regex(/secret/i))
        .block("No secrets");

      assertPassResult(
        ctx,
        {
          toolCallId: "1",
          toolName: "bash",
          input: { command: "echo hello" },
          content: [{ type: "text", text: "hello" }],
          isError: false,
        } as unknown as ToolResultEvent,
      );
    });

    it("does not block results with unmatched input", () => {
      const ctx = new GuardrailContext();
      ctx
        .tool("bash")
        .input("command", ctx.bash.word("echo"))
        .output(ctx.regex(/secret/i))
        .block("No secrets");

      assertPassResult(
        ctx,
        {
          toolCallId: "1",
          toolName: "bash",
          input: { command: "cat file.txt" },
          content: [{ type: "text", text: "SECRET_VALUE" }],
          isError: false,
        } as unknown as ToolResultEvent,
      );
    });
  });

  // ── Sed/awk blocking ─────────────────────────────────────────────────────

  describe("sed/awk blocking", () => {
    it("blocks sed in bash", () => {
      const ctx = new GuardrailContext();
      ctx
        .tool("bash")
        .input("command", ctx.bash.word("sed"))
        .block("No sed");

      assertBlockCall(
        ctx,
        {
          toolCallId: "1",
          toolName: "bash",
          input: { command: "sed -n '/error/p' file.log" },
        } as unknown as ToolCallEvent,
        "No sed",
      );
    });

    it("blocks awk in bash", () => {
      const ctx = new GuardrailContext();
      ctx
        .tool("bash")
        .input("command", ctx.bash.word("awk"))
        .block("No awk");

      assertBlockCall(
        ctx,
        {
          toolCallId: "1",
          toolName: "bash",
          input: { command: "awk '{print $1}' file.txt" },
        } as unknown as ToolCallEvent,
        "No awk",
      );
    });

    it("allows non-sed/awk bash commands", () => {
      const ctx = new GuardrailContext();
      ctx
        .tool("bash")
        .input("command", ctx.bash.word("sed"))
        .block("No sed");

      assertPassCall(
        ctx,
        {
          toolCallId: "1",
          toolName: "bash",
          input: { command: "cat file.txt" },
        } as unknown as ToolCallEvent,
      );
    });
  });

  // ── Web-fetch github search blocking ──────────────────────────────────────

  describe("web-fetch github search blocking", () => {
    it("blocks web-fetch on github.com/search", () => {
      const ctx = new GuardrailContext();
      ctx
        .tool("web-fetch")
        .input("source", ctx.regex(/\/search\?/))
        .block("No github search");

      assertBlockCall(
        ctx,
        {
          toolCallId: "1",
          toolName: "web-fetch",
          input: {
            source: "https://github.com/search?q=guardrails",
          },
        } as unknown as ToolCallEvent,
        "No github search",
      );
    });

    it("allows web-fetch on regular github URLs", () => {
      const ctx = new GuardrailContext();
      ctx
        .tool("web-fetch")
        .input("source", ctx.regex(/\/search\?/))
        .block("No github search");

      assertPassCall(
        ctx,
        {
          toolCallId: "1",
          toolName: "web-fetch",
          input: {
            source: "https://github.com/user/repo",
          },
        } as unknown as ToolCallEvent,
      );
    });
  });

  // ── Bun API blocking in edit/write ────────────────────────────────────────

  describe("Bun API blocking in edit/write", () => {
    it("blocks write with Bun.file()", () => {
      const ctx = new GuardrailContext();
      ctx
        .tool("write")
        .input("content", ctx.regex(/Bun\.file/))
        .block("No Bun.file");

      assertBlockCall(
        ctx,
        {
          toolCallId: "1",
          toolName: "write",
          input: {
            path: "test.ts",
            content: "Bun.file('x')",
          },
        } as unknown as ToolCallEvent,
        "No Bun.file",
      );
    });

    it("blocks write with Bun.spawn()", () => {
      const ctx = new GuardrailContext();
      ctx
        .tool("write")
        .input("content", ctx.regex(/Bun\.spawn/))
        .block("No Bun.spawn");

      assertBlockCall(
        ctx,
        {
          toolCallId: "1",
          toolName: "write",
          input: {
            path: "test.ts",
            content: "Bun.spawn('cmd')",
          },
        } as unknown as ToolCallEvent,
        "No Bun.spawn",
      );
    });

    it("blocks edit with Bun.spawn() in newText", () => {
      const ctx = new GuardrailContext();
      ctx
        .tool("edit")
        .input("newText", ctx.regex(/Bun\.spawn/))
        .block("No Bun.spawn");

      assertBlockCall(
        ctx,
        {
          toolCallId: "1",
          toolName: "edit",
          input: {
            path: "test.ts",
            oldText: "",
            newText: "Bun.spawn('cmd')",
          },
        } as unknown as ToolCallEvent,
        "No Bun.spawn",
      );
    });

    it("blocks write with bun: builtin import", () => {
      const ctx = new GuardrailContext();
      ctx
        .tool("write")
        .input("content", ctx.regex(/bun:/))
        .block("No bun: imports");

      assertBlockCall(
        ctx,
        {
          toolCallId: "1",
          toolName: "write",
          input: {
            path: "test.ts",
            content: 'import { spawn } from "bun:fs"',
          },
        } as unknown as ToolCallEvent,
        "No bun: imports",
      );
    });

    it("blocks edit with bun: builtin import in newText", () => {
      const ctx = new GuardrailContext();
      ctx
        .tool("edit")
        .input("newText", ctx.regex(/bun:/))
        .block("No bun: imports");

      assertBlockCall(
        ctx,
        {
          toolCallId: "1",
          toolName: "edit",
          input: {
            path: "test.ts",
            oldText: "",
            newText: 'import { spawn } from "bun:fs"',
          },
        } as unknown as ToolCallEvent,
        "No bun: imports",
      );
    });

    it("allows write with non-Bun content", () => {
      const ctx = new GuardrailContext();
      ctx
        .tool("write")
        .input("content", ctx.regex(/Bun\./))
        .block("No Bun APIs");

      assertPassCall(
        ctx,
        {
          toolCallId: "1",
          toolName: "write",
          input: {
            path: "test.ts",
            content: "console.log('hello')",
          },
        } as unknown as ToolCallEvent,
      );
    });

    it("allows edit with non-Bun content", () => {
      const ctx = new GuardrailContext();
      ctx
        .tool("edit")
        .input("newText", ctx.regex(/Bun\./))
        .block("No Bun APIs");

      assertPassCall(
        ctx,
        {
          toolCallId: "1",
          toolName: "edit",
          input: {
            path: "test.ts",
            oldText: "",
            newText: "const x = 1;",
          },
        } as unknown as ToolCallEvent,
      );
    });
  });

  // ── TSV safety ────────────────────────────────────────────────────────────

  describe("TSV safety", () => {
    it("blocks write on .tsv files", () => {
      const ctx = new GuardrailContext();
      ctx
        .tool("write")
        .input("path", ctx.glob("**/*.tsv"))
        .block("No direct .tsv writes");

      assertBlockCall(
        ctx,
        {
          toolCallId: "1",
          toolName: "write",
          input: {
            path: "data.tsv",
            content: "col1\tcol2\n1\t2",
          },
        } as unknown as ToolCallEvent,
        "No direct .tsv writes",
      );
    });

    it("blocks edit on .tsv files", () => {
      const ctx = new GuardrailContext();
      ctx
        .tool("edit")
        .input("path", ctx.glob("**/*.tsv"))
        .block("No direct .tsv edits");

      assertBlockCall(
        ctx,
        {
          toolCallId: "1",
          toolName: "edit",
          input: {
            path: "data.tsv",
            oldText: "col1\tcol2",
            newText: "col1\tcol2\tcol3",
          },
        } as unknown as ToolCallEvent,
        "No direct .tsv edits",
      );
    });

    it("allows write on non-.tsv files", () => {
      const ctx = new GuardrailContext();
      ctx
        .tool("write")
        .input("path", ctx.glob("**/*.tsv"))
        .block("No direct .tsv writes");

      assertPassCall(
        ctx,
        {
          toolCallId: "1",
          toolName: "write",
          input: {
            path: "data.json",
            content: '{"a": 1}',
          },
        } as unknown as ToolCallEvent,
      );
    });

    it("allows edit on non-.tsv files", () => {
      const ctx = new GuardrailContext();
      ctx
        .tool("edit")
        .input("path", ctx.glob("**/*.tsv"))
        .block("No direct .tsv edits");

      assertPassCall(
        ctx,
        {
          toolCallId: "1",
          toolName: "edit",
          input: {
            path: "data.json",
            oldText: '{"a": 1}',
            newText: '{"a": 2}',
          },
        } as unknown as ToolCallEvent,
      );
    });
  });

  // ── Full extension handler integration ────────────────────────────────────

  /**
   * Wire up a fresh extension with a rule callback for tool_call events.
   * Sets the describe-level toolCallHandler, so tests can use callBash/callTool.
   */
  async function setupCallIntegration(
    ruleFn: (ctx: GuardrailContext) => void,
  ) {
    const localMock = {
      on: vi.fn().mockImplementation((event: string, handler: unknown) => {
        if (event === "tool_call")
          toolCallHandler = handler as (
            event: ToolCallEvent,
            ctx: unknown,
          ) => Promise<unknown>;
      }),
      registerCommand: vi.fn(),
    };
    await guardrails(ruleFn)(localMock as unknown as ExtensionAPI);
  }

  /**
   * Wire up a fresh extension with a rule callback for tool_result events.
   * Sets the describe-level toolResultHandler, so tests can invoke it directly.
   */
  async function setupResultIntegration(
    ruleFn: (ctx: GuardrailContext) => void,
  ) {
    const localMock = {
      on: vi.fn().mockImplementation((event: string, handler: unknown) => {
        if (event === "tool_result")
          toolResultHandler = handler as (
            event: ToolResultEvent,
            ctx: unknown,
          ) => Promise<unknown>;
      }),
      registerCommand: vi.fn(),
    };
    await guardrails(ruleFn)(localMock as unknown as ExtensionAPI);
  }

  describe("full extension handler integration", () => {
    it("blocks tool_call when a rule matches", async () => {
      await setupCallIntegration((ctx) => {
        ctx
          .tool("bash")
          .input("command", ctx.seq(ctx.bash.word("rm"), ctx.star()))
          .block("Use trash");
      });

      const result = await callBash("rm foo.txt");
      expect(result).toEqual({ block: true, reason: "Use trash" });
    });

    it("passes tool_call when no rule matches", async () => {
      await setupCallIntegration((ctx) => {
        ctx
          .tool("bash")
          .input("command", ctx.seq(ctx.bash.word("rm"), ctx.star()))
          .block("Use trash");
      });

      const result = await callBash("ls -la");
      expect(result).toBeUndefined();
    });

    it("blocks chained rm after &&", async () => {
      await setupCallIntegration((ctx) => {
        ctx
          .tool("bash")
          .input("command", ctx.seq(ctx.bash.word("rm"), ctx.star()))
          .block("Use trash");
      });

      const result = await callBash("cd /tmp && rm -rf .");
      expect(result).toEqual({ block: true, reason: "Use trash" });
    });

    it("blocks chained rm after ;", async () => {
      await setupCallIntegration((ctx) => {
        ctx
          .tool("bash")
          .input("command", ctx.seq(ctx.bash.word("rm"), ctx.star()))
          .block("Use trash");
      });

      const result = await callBash("echo hello; rm -rf /");
      expect(result).toEqual({ block: true, reason: "Use trash" });
    });

    it("blocks chained rm after ||", async () => {
      await setupCallIntegration((ctx) => {
        ctx
          .tool("bash")
          .input("command", ctx.seq(ctx.bash.word("rm"), ctx.star()))
          .block("Use trash");
      });

      const result = await callBash("ls || rm -rf .");
      expect(result).toEqual({ block: true, reason: "Use trash" });
    });

    it("blocks tool_result when a post-execution rule matches", async () => {
      await setupResultIntegration((ctx) => {
        ctx
          .tool("bash")
          .input("command", ctx.bash.word("echo"))
          .output(ctx.regex(/secret/i))
          .block("No secrets in output");
      });

      const result = await toolResultHandler!(
        {
          toolCallId: "1",
          toolName: "bash",
          input: { command: "echo secret" },
          content: [{ type: "text", text: "SECRET_VALUE" }],
          isError: false,
          type: "tool_result",
          details: undefined,
        } as unknown as ToolResultEvent,
        makeCtx(),
      );
      expect(result).toEqual({
        block: true,
        reason: "No secrets in output",
      });
    });

    it("passes tool_result when no post-execution rule matches", async () => {
      await setupResultIntegration((ctx) => {
        ctx
          .tool("bash")
          .input("command", ctx.bash.word("echo"))
          .output(ctx.regex(/secret/i))
          .block("No secrets");
      });

      const result = await toolResultHandler!(
        {
          toolCallId: "1",
          toolName: "bash",
          input: { command: "echo hello" },
          content: [{ type: "text", text: "hello" }],
          isError: false,
          type: "tool_result",
          details: undefined,
        } as unknown as ToolResultEvent,
        makeCtx(),
      );
      expect(result).toBeUndefined();
    });

    it("blocks error result when an error rule matches", async () => {
      await setupResultIntegration((ctx) => {
        ctx
          .tool("bash")
          .error(ctx.regex(/fault|dump/i))
          .block("Tool crashed");
      });

      const result = await toolResultHandler!(
        {
          toolCallId: "1",
          toolName: "bash",
          input: { command: "./crashy" },
          content: [
            { type: "text", text: "Segmentation fault (core dumped)" },
          ],
          isError: true,
          type: "tool_result",
          details: undefined,
        } as unknown as ToolResultEvent,
        makeCtx(),
      );
      expect(result).toEqual({ block: true, reason: "Tool crashed" });
    });

    it("does not block non-error results even with error rules", async () => {
      await setupResultIntegration((ctx) => {
        ctx
          .tool("bash")
          .error(ctx.regex(/segfault/i))
          .block("Tool crashed");
      });

      const result = await toolResultHandler!(
        {
          toolCallId: "1",
          toolName: "bash",
          input: { command: "ls" },
          content: [{ type: "text", text: "file.txt" }],
          isError: false,
          type: "tool_result",
          details: undefined,
        } as unknown as ToolResultEvent,
        makeCtx(),
      );
      expect(result).toBeUndefined();
    });

    it("rewrites tool_result when rewrite rule matches", async () => {
      await setupResultIntegration((ctx) => {
        ctx
          .tool("bash")
          .input("command", ctx.bash.word("echo"))
          .output(ctx.regex(/password/i))
          .rewrite((event) => ({
            content: event.content?.map((c) =>
              c.type === "text"
                ? { ...c, text: c.text.replace(/password/gi, "***") }
                : c,
            ),
          }));
      });

      const result = await toolResultHandler!(
        {
          toolCallId: "1",
          toolName: "bash",
          input: { command: "echo password123" },
          content: [{ type: "text", text: "mypassword is secret" }],
          isError: false,
          type: "tool_result",
          details: undefined,
        } as unknown as ToolResultEvent,
        makeCtx(),
      );
      expect((result as ToolResultEventResult)?.content).toEqual([
        { type: "text", text: "my*** is secret" },
      ]);
    });
  });

  // ── Command handler ───────────────────────────────────────────────────────

  describe("command handler", () => {
    it("handles /guardrails on", async () => {
      const cmd = mockPi.registerCommand.mock.calls.find(
        (c: unknown[]) => c[0] === "guardrails",
      )?.[1] as { handler: (args: string, ctx: unknown) => Promise<void> };
      await cmd.handler("on", makeCtx());
      expect(mockLoader.enabled).toBe(true);
    });

    it("handles /guardrails off", async () => {
      const cmd = mockPi.registerCommand.mock.calls.find(
        (c: unknown[]) => c[0] === "guardrails",
      )?.[1] as { handler: (args: string, ctx: unknown) => Promise<void> };
      await cmd.handler("off", makeCtx());
      expect(mockLoader.enabled).toBe(false);
    });
  });

  // ── Error capture ─────────────────────────────────────────────────────────

  describe("error capture", () => {
    it("fires error rules when isError is true", () => {
      const ctx = new GuardrailContext();
      ctx
        .tool("bash")
        .error(ctx.regex(/fault|dump/i))
        .block("Tool crashed");

      assertBlockError(
        ctx,
        {
          toolCallId: "1",
          toolName: "bash",
          input: { command: "./crashy" },
          content: [
            { type: "text", text: "Segmentation fault (core dumped)" },
          ],
          isError: true,
        } as unknown as ToolResultEvent,
        "Tool crashed",
      );
    });

    it("does not fire error rules when isError is false", () => {
      const ctx = new GuardrailContext();
      ctx
        .tool("bash")
        .error(ctx.regex(/segfault/i))
        .block("Tool crashed");

      assertPassError(
        ctx,
        {
          toolCallId: "1",
          toolName: "bash",
          input: { command: "ls" },
          content: [{ type: "text", text: "file.txt" }],
          isError: false,
        } as unknown as ToolResultEvent,
      );
    });

    it("matches error content against regex", () => {
      const ctx = new GuardrailContext();
      ctx
        .tool("bash")
        .error(ctx.regex(/permission|Operation/i))
        .block("Permission denied");

      assertBlockError(
        ctx,
        {
          toolCallId: "1",
          toolName: "bash",
          input: { command: "chmod 777 /etc/passwd" },
          content: [
            {
              type: "text",
              text: "chmod: changing permissions of '/etc/passwd': Operation not permitted",
            },
          ],
          isError: true,
        } as unknown as ToolResultEvent,
        "Permission denied",
      );
    });

    it("matches error content with nu tokenizer", () => {
      const ctx = new GuardrailContext();
      ctx
        .tool("python-eval")
        .error(ctx.seq(ctx.nu.word("Traceback")))
        .block("Python traceback");

      assertBlockError(
        ctx,
        {
          toolCallId: "1",
          toolName: "python-eval",
          input: { command: "print(x)" },
          content: [
            {
              type: "text",
              text: "Traceback (most recent call last):\n  File \"test.py\", line 1\n    print(x)\nNameError: name 'x' is not defined",
            },
          ],
          isError: true,
        } as unknown as ToolResultEvent,
        "Python traceback",
      );
    });

    it("passes non-matching error content", () => {
      const ctx = new GuardrailContext();
      ctx
        .tool("bash")
        .error(ctx.regex(/segfault/i))
        .block("Tool crashed");

      assertPassError(
        ctx,
        {
          toolCallId: "1",
          toolName: "bash",
          input: { command: "ls" },
          content: [{ type: "text", text: "file.txt" }],
          isError: true,
        } as unknown as ToolResultEvent,
      );
    });

    it("applies .rewrite() on error match", async () => {
      const ctx = new GuardrailContext();
      ctx
        .tool("bash")
        .error(ctx.regex(/error/i))
        .rewrite((event) => ({
          content: event.content?.map((c) =>
            c.type === "text"
              ? { ...c, text: c.text + "\n\n💡 Check your syntax" }
              : c,
          ),
        }));

      const result = ctx.matchError({
        toolCallId: "1",
        toolName: "bash",
        input: { command: "gcc -o test test.c" },
        content: [
          { type: "text", text: "error: undefined reference to 'main'" },
        ],
        isError: true,
      } as unknown as ToolResultEvent);

      expect(result?.content).toEqual([
        {
          type: "text",
          text: "error: undefined reference to 'main'\n\n💡 Check your syntax",
        },
      ]);
    });
  });

  // ── Handler functions ─────────────────────────────────────────────────────

  describe("handler functions", () => {
    it("handleToolError returns error rule result", () => {
      const ctx = new GuardrailContext();
      ctx
        .tool("bash")
        .error(ctx.regex(/fault|dump/i))
        .block("Tool crashed");

      expect(
        handleToolError(ctx, {
          toolCallId: "1",
          toolName: "bash",
          input: { command: "./crashy" },
          content: [
            { type: "text", text: "Segmentation fault (core dumped)" },
          ],
          isError: true,
        } as unknown as ToolResultEvent),
      ).toEqual({ block: true, reason: "Tool crashed" });
    });

    it("handleToolError returns undefined when no error rule matches", () => {
      const ctx = new GuardrailContext();
      ctx
        .tool("bash")
        .error(ctx.regex(/segfault/i))
        .block("Tool crashed");

      expect(
        handleToolError(ctx, {
          toolCallId: "1",
          toolName: "bash",
          input: { command: "ls" },
          content: [{ type: "text", text: "file.txt" }],
          isError: true,
        } as unknown as ToolResultEvent),
      ).toBeUndefined();
    });

    it("createHandler includes handleError", () => {
      const ctx = new GuardrailContext();
      ctx
        .tool("bash")
        .error(ctx.regex(/fault|dump/i))
        .block("Tool crashed");

      const handler = createHandler(ctx);
      expect(handler.handleError).toBeDefined();
      expect(handler.handleCall).toBeDefined();
      expect(handler.handleResult).toBeDefined();

      expect(
        handler.handleError({
          toolCallId: "1",
          toolName: "bash",
          input: { command: "./crashy" },
          content: [
            { type: "text", text: "Segmentation fault (core dumped)" },
          ],
          isError: true,
        } as unknown as ToolResultEvent),
      ).toEqual({ block: true, reason: "Tool crashed" });
    });

    it("composeContexts includes handleError", () => {
      const ctx1 = new GuardrailContext();
      ctx1
        .tool("bash")
        .error(ctx1.regex(/fault|dump/i))
        .block("Segfault");

      const ctx2 = new GuardrailContext();
      ctx2
        .tool("bash")
        .error(ctx2.regex(/core dump/i))
        .block("Core dump");

      const composed = composeContexts(ctx1, ctx2);
      expect(composed.handleError).toBeDefined();

      expect(
        composed.handleError({
          toolCallId: "1",
          toolName: "bash",
          input: { command: "./crashy" },
          content: [
            { type: "text", text: "Segmentation fault (core dumped)" },
          ],
          isError: true,
        } as unknown as ToolResultEvent),
      ).toEqual({ block: true, reason: "Segfault" });
    });

    it("error rules take precedence over post-execution rules", () => {
      const ctx = new GuardrailContext();
      ctx
        .tool("bash")
        .error(ctx.regex(/fault|dump/i))
        .block("Error blocked");

      // Also add a post-execution rule that would match the same content
      ctx
        .tool("bash")
        .input("command", ctx.bash.word("./crashy"))
        .output(ctx.regex(/fault|dump/i))
        .block("Post-exec blocked");

      expect(
        ctx.matchError({
          toolCallId: "1",
          toolName: "bash",
          input: { command: "./crashy" },
          content: [
            { type: "text", text: "Segmentation fault (core dumped)" },
          ],
          isError: true,
        } as unknown as ToolResultEvent),
      ).toEqual({ block: true, reason: "Error blocked" });
    });
  });
});

