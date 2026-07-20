import { describe, it, expect, vi, beforeEach } from "vitest";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { ToolCallEvent, ToolResultEvent } from "./lib/builder/events.js";
import guardrails from "./index.js";
import {
  handleToolCall,
  handleToolError,
  handleToolResult,
  createHandler,
  composeContexts,
} from "./lib/handlers.js";
import { GuardrailContext } from "./lib/builder/context.js";

// Mock the config loader before importing anything else
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
    // Get the mocked loader
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

    // Create the extension by calling guardrails with an empty rules callback
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

  describe("pre-execution blocking via matchCall", () => {
    it("blocks rm commands", () => {
      const ctx = new GuardrailContext();
      ctx
        .tool("bash")
        .input("command", ctx.seq(ctx.bash.word("rm"), ctx.star()))
        .block("Use trash");

      const result = handleToolCall(ctx, {
        toolCallId: "1",
        toolName: "bash",
        input: { command: "rm foo.txt" },
      } as unknown as ToolCallEvent);

      expect(result).toEqual({ block: true, reason: "Use trash" });
    });

    it("blocks rm with flags", () => {
      const ctx = new GuardrailContext();
      ctx
        .tool("bash")
        .input("command", ctx.seq(ctx.bash.word("rm"), ctx.star()))
        .block("Use trash");

      const result = handleToolCall(ctx, {
        toolCallId: "1",
        toolName: "bash",
        input: { command: "rm -rf /" },
      } as unknown as ToolCallEvent);

      expect(result).toEqual({ block: true, reason: "Use trash" });
    });

    it("blocks sudo commands", () => {
      const ctx = new GuardrailContext();
      ctx
        .tool("bash")
        .input("command", ctx.seq(ctx.bash.word("sudo"), ctx.star()))
        .block("No sudo");

      const result = handleToolCall(ctx, {
        toolCallId: "1",
        toolName: "bash",
        input: { command: "sudo rm foo" },
      } as unknown as ToolCallEvent);

      expect(result).toEqual({ block: true, reason: "No sudo" });
    });

    it("does not block non-matching commands", () => {
      const ctx = new GuardrailContext();
      ctx
        .tool("bash")
        .input("command", ctx.seq(ctx.bash.word("rm"), ctx.star()))
        .block("Use trash");

      const result = handleToolCall(ctx, {
        toolCallId: "1",
        toolName: "bash",
        input: { command: "ls -la" },
      } as unknown as ToolCallEvent);

      expect(result).toBeUndefined();
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

      const result = handleToolCall(ctx, {
        toolCallId: "1",
        toolName: "bash",
        input: { command: "npm install lodash" },
      } as unknown as ToolCallEvent);

      expect(result).toEqual({ block: true, reason: "No npm install" });
    });

    it("passes non-matching edit commands", () => {
      const ctx = new GuardrailContext();
      ctx
        .tool("bash")
        .input("command", ctx.bash.word("rm"))
        .block("No rm");

      const result = handleToolCall(ctx, {
        toolCallId: "1",
        toolName: "edit",
        input: {
          path: "test.ts",
          oldText: "",
          newText: "",
        },
      } as unknown as ToolCallEvent);

      expect(result).toBeUndefined();
    });
  });

  describe("nu-eval tool_call hook", () => {
    it("blocks nushell ls -R", () => {
      const ctx = new GuardrailContext();
      ctx
        .tool("nu-eval")
        .input(
          "command",
          ctx.contains(ctx.nu.word("ls"), ctx.nu.word("-R")),
        )
        .block("No ls -R");

      const result = handleToolCall(ctx, {
        toolCallId: "1",
        toolName: "nu-eval",
        input: { command: "ls -R" },
      } as unknown as ToolCallEvent);

      expect(result).toEqual({ block: true, reason: "No ls -R" });
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

      const result = handleToolCall(ctx, {
        toolCallId: "1",
        toolName: "nu-eval",
        input: { command: "ls -r" },
      } as unknown as ToolCallEvent);

      expect(result).toEqual({ block: true, reason: "No ls -r" });
    });

    it("blocks nushell sort without column", () => {
      const ctx = new GuardrailContext();
      ctx
        .tool("nu-eval")
        .input("command", ctx.nu.word("sort"))
        .block("No bare sort");

      const result = handleToolCall(ctx, {
        toolCallId: "1",
        toolName: "nu-eval",
        input: { command: "sort" },
      } as unknown as ToolCallEvent);

      expect(result).toEqual({ block: true, reason: "No bare sort" });
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

      const result = handleToolCall(ctx, {
        toolCallId: "1",
        toolName: "nu-eval",
        input: { command: "ls -a" },
      } as unknown as ToolCallEvent);

      expect(result).toBeUndefined();
    });
  });

  describe("duckdb-eval tool_call hook", () => {
    it("blocks read_csv_auto with tilde path", () => {
      const ctx = new GuardrailContext();
      ctx
        .tool("duckdb-eval")
        .input(
          "command",
          ctx.contains(
            ctx.sql.word("read_csv_auto"),
            ctx.regex(/~/),
          ),
        )
        .block("No tilde paths");

      const result = handleToolCall(ctx, {
        toolCallId: "1",
        toolName: "duckdb-eval",
        input: {
          command: "SELECT * FROM read_csv_auto('~/data.csv')",
        },
      } as unknown as ToolCallEvent);

      expect(result).toEqual({ block: true, reason: "No tilde paths" });
    });

    it("blocks AUTO_DETECT ON", () => {
      const ctx = new GuardrailContext();
      ctx
        .tool("duckdb-eval")
        .input("command", ctx.regex(/AUTO_DETECT\s+ON/))
        .block("No AUTO_DETECT");

      const result = handleToolCall(ctx, {
        toolCallId: "1",
        toolName: "duckdb-eval",
        input: {
          command: "read_csv_auto('file.csv', AUTO_DETECT ON)",
        },
      } as unknown as ToolCallEvent);

      expect(result).toEqual({ block: true, reason: "No AUTO_DETECT" });
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

      const result = handleToolCall(ctx, {
        toolCallId: "1",
        toolName: "duckdb-eval",
        input: {
          command: "SELECT string_to_split_to_array(col, ',') FROM t",
        },
      } as unknown as ToolCallEvent);

      expect(result).toEqual({ block: true, reason: "No string_to_split_to_array" });
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

      const result = handleToolCall(ctx, {
        toolCallId: "1",
        toolName: "duckdb-eval",
        input: {
          command: "SELECT name FROM users WHERE active = 1",
        },
      } as unknown as ToolCallEvent);

      expect(result).toBeUndefined();
    });
  });

  describe("nu-eval tool_call hook", () => {
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

  describe("duckdb-eval tool_call hook", () => {
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

  describe("post-execution blocking via matchResult", () => {
    it("blocks results matching output pattern", () => {
      const ctx = new GuardrailContext();
      ctx
        .tool("bash")
        .input("command", ctx.bash.word("echo"))
        .output(ctx.regex(/secret/i))
        .block("No secrets");

      const result = handleToolResult(ctx, {
        toolCallId: "1",
        toolName: "bash",
        input: { command: "echo secret" },
        content: [{ type: "text", text: "SECRET_VALUE" }],
        isError: false,
      } as unknown as ToolResultEvent);

      expect(result).toEqual({ block: true, reason: "No secrets" });
    });

    it("does not block results that do not match output pattern", () => {
      const ctx = new GuardrailContext();
      ctx
        .tool("bash")
        .input("command", ctx.bash.word("echo"))
        .output(ctx.regex(/secret/i))
        .block("No secrets");

      const result = handleToolResult(ctx, {
        toolCallId: "1",
        toolName: "bash",
        input: { command: "echo hello" },
        content: [{ type: "text", text: "hello" }],
        isError: false,
      } as unknown as ToolResultEvent);

      expect(result).toBeUndefined();
    });

    it("does not block results with unmatched input", () => {
      const ctx = new GuardrailContext();
      ctx
        .tool("bash")
        .input("command", ctx.bash.word("echo"))
        .output(ctx.regex(/secret/i))
        .block("No secrets");

      const result = handleToolResult(ctx, {
        toolCallId: "1",
        toolName: "bash",
        input: { command: "cat file.txt" },
        content: [{ type: "text", text: "SECRET_VALUE" }],
        isError: false,
      } as unknown as ToolResultEvent);

      expect(result).toBeUndefined();
    });
  });

  describe("sed/awk blocking", () => {
    it("blocks sed in bash", () => {
      const ctx = new GuardrailContext();
      ctx
        .tool("bash")
        .input("command", ctx.bash.word("sed"))
        .block("No sed");

      const result = handleToolCall(ctx, {
        toolCallId: "1",
        toolName: "bash",
        input: { command: "sed -n '/error/p' file.log" },
      } as unknown as ToolCallEvent);

      expect(result).toEqual({ block: true, reason: "No sed" });
    });

    it("blocks awk in bash", () => {
      const ctx = new GuardrailContext();
      ctx
        .tool("bash")
        .input("command", ctx.bash.word("awk"))
        .block("No awk");

      const result = handleToolCall(ctx, {
        toolCallId: "1",
        toolName: "bash",
        input: { command: "awk '{print $1}' file.txt" },
      } as unknown as ToolCallEvent);

      expect(result).toEqual({ block: true, reason: "No awk" });
    });

    it("allows non-sed/awk bash commands", () => {
      const ctx = new GuardrailContext();
      ctx
        .tool("bash")
        .input("command", ctx.bash.word("sed"))
        .block("No sed");

      const result = handleToolCall(ctx, {
        toolCallId: "1",
        toolName: "bash",
        input: { command: "cat file.txt" },
      } as unknown as ToolCallEvent);

      expect(result).toBeUndefined();
    });
  });

  describe("web-fetch github search blocking", () => {
    it("blocks web-fetch on github.com/search", () => {
      const ctx = new GuardrailContext();
      ctx
        .tool("web-fetch")
        .input("source", ctx.regex(/\/search\?/))
        .block("No github search");

      const result = handleToolCall(ctx, {
        toolCallId: "1",
        toolName: "web-fetch",
        input: {
          source: "https://github.com/search?q=guardrails",
        },
      } as unknown as ToolCallEvent);

      expect(result).toEqual({ block: true, reason: "No github search" });
    });

    it("allows web-fetch on regular github URLs", () => {
      const ctx = new GuardrailContext();
      ctx
        .tool("web-fetch")
        .input("source", ctx.regex(/\/search\?/))
        .block("No github search");

      const result = handleToolCall(ctx, {
        toolCallId: "1",
        toolName: "web-fetch",
        input: {
          source: "https://github.com/user/repo",
        },
      } as unknown as ToolCallEvent);

      expect(result).toBeUndefined();
    });
  });

  describe("Bun API blocking in edit/write", () => {
    it("blocks write with Bun.file()", () => {
      const ctx = new GuardrailContext();
      ctx
        .tool("write")
        .input("content", ctx.regex(/Bun\.file/))
        .block("No Bun.file");

      const result = handleToolCall(ctx, {
        toolCallId: "1",
        toolName: "write",
        input: {
          path: "test.ts",
          content: "Bun.file('x')",
        },
      } as unknown as ToolCallEvent);

      expect(result).toEqual({ block: true, reason: "No Bun.file" });
    });

    it("blocks write with Bun.spawn()", () => {
      const ctx = new GuardrailContext();
      ctx
        .tool("write")
        .input("content", ctx.regex(/Bun\.spawn/))
        .block("No Bun.spawn");

      const result = handleToolCall(ctx, {
        toolCallId: "1",
        toolName: "write",
        input: {
          path: "test.ts",
          content: "Bun.spawn('cmd')",
        },
      } as unknown as ToolCallEvent);

      expect(result).toEqual({ block: true, reason: "No Bun.spawn" });
    });

    it("blocks edit with Bun.spawn() in newText", () => {
      const ctx = new GuardrailContext();
      ctx
        .tool("edit")
        .input("newText", ctx.regex(/Bun\.spawn/))
        .block("No Bun.spawn");

      const result = handleToolCall(ctx, {
        toolCallId: "1",
        toolName: "edit",
        input: {
          path: "test.ts",
          oldText: "",
          newText: "Bun.spawn('cmd')",
        },
      } as unknown as ToolCallEvent);

      expect(result).toEqual({ block: true, reason: "No Bun.spawn" });
    });

    it("blocks write with bun: builtin import", () => {
      const ctx = new GuardrailContext();
      ctx
        .tool("write")
        .input("content", ctx.regex(/bun:/))
        .block("No bun: imports");

      const result = handleToolCall(ctx, {
        toolCallId: "1",
        toolName: "write",
        input: {
          path: "test.ts",
          content: 'import { spawn } from "bun:fs"',
        },
      } as unknown as ToolCallEvent);

      expect(result).toEqual({ block: true, reason: "No bun: imports" });
    });

    it("blocks edit with bun: builtin import in newText", () => {
      const ctx = new GuardrailContext();
      ctx
        .tool("edit")
        .input("newText", ctx.regex(/bun:/))
        .block("No bun: imports");

      const result = handleToolCall(ctx, {
        toolCallId: "1",
        toolName: "edit",
        input: {
          path: "test.ts",
          oldText: "",
          newText: 'import { spawn } from "bun:fs"',
        },
      } as unknown as ToolCallEvent);

      expect(result).toEqual({ block: true, reason: "No bun: imports" });
    });

    it("allows write with non-Bun content", () => {
      const ctx = new GuardrailContext();
      ctx
        .tool("write")
        .input("content", ctx.regex(/Bun\./))
        .block("No Bun APIs");

      const result = handleToolCall(ctx, {
        toolCallId: "1",
        toolName: "write",
        input: {
          path: "test.ts",
          content: "console.log('hello')",
        },
      } as unknown as ToolCallEvent);

      expect(result).toBeUndefined();
    });

    it("allows edit with non-Bun content", () => {
      const ctx = new GuardrailContext();
      ctx
        .tool("edit")
        .input("newText", ctx.regex(/Bun\./))
        .block("No Bun APIs");

      const result = handleToolCall(ctx, {
        toolCallId: "1",
        toolName: "edit",
        input: {
          path: "test.ts",
          oldText: "",
          newText: "const x = 1;",
        },
      } as unknown as ToolCallEvent);

      expect(result).toBeUndefined();
    });
  });

  describe("TSV safety", () => {
    it("blocks write on .tsv files", () => {
      const ctx = new GuardrailContext();
      ctx
        .tool("write")
        .input("path", ctx.glob("**/*.tsv"))
        .block("No direct .tsv writes");

      const result = handleToolCall(ctx, {
        toolCallId: "1",
        toolName: "write",
        input: {
          path: "data.tsv",
          content: "col1\tcol2\n1\t2",
        },
      } as unknown as ToolCallEvent);

      expect(result).toEqual({ block: true, reason: "No direct .tsv writes" });
    });

    it("blocks edit on .tsv files", () => {
      const ctx = new GuardrailContext();
      ctx
        .tool("edit")
        .input("path", ctx.glob("**/*.tsv"))
        .block("No direct .tsv edits");

      const result = handleToolCall(ctx, {
        toolCallId: "1",
        toolName: "edit",
        input: {
          path: "data.tsv",
          oldText: "col1\tcol2",
          newText: "col1\tcol2\tcol3",
        },
      } as unknown as ToolCallEvent);

      expect(result).toEqual({ block: true, reason: "No direct .tsv edits" });
    });

    it("allows write on non-.tsv files", () => {
      const ctx = new GuardrailContext();
      ctx
        .tool("write")
        .input("path", ctx.glob("**/*.tsv"))
        .block("No direct .tsv writes");

      const result = handleToolCall(ctx, {
        toolCallId: "1",
        toolName: "write",
        input: {
          path: "data.json",
          content: '{"a": 1}',
        },
      } as unknown as ToolCallEvent);

      expect(result).toBeUndefined();
    });

    it("allows edit on non-.tsv files", () => {
      const ctx = new GuardrailContext();
      ctx
        .tool("edit")
        .input("path", ctx.glob("**/*.tsv"))
        .block("No direct .tsv edits");

      const result = handleToolCall(ctx, {
        toolCallId: "1",
        toolName: "edit",
        input: {
          path: "data.json",
          oldText: '{"a": 1}',
          newText: '{"a": 2}',
        },
      } as unknown as ToolCallEvent);

      expect(result).toBeUndefined();
    });
  });

  describe("full extension handler integration", () => {
    it("blocks tool_call when a rule matches", async () => {
      const mockPi: {
        on: ReturnType<typeof vi.fn>;
        registerCommand: ReturnType<typeof vi.fn>;
      } = {
        on: vi.fn().mockImplementation((event, handler) => {
          if (event === "tool_call")
            toolCallHandler = handler as (
              event: ToolCallEvent,
              ctx: unknown,
            ) => Promise<unknown>;
        }),
        registerCommand: vi.fn(),
      };

      const extension = guardrails((ctx) => {
        ctx
          .tool("bash")
          .input("command", ctx.seq(ctx.bash.word("rm"), ctx.star()))
          .block("Use trash");
      });
      await extension(mockPi as unknown as ExtensionAPI);

      const result = await callBash("rm foo.txt");
      expect(result).toEqual({ block: true, reason: "Use trash" });
    });

    it("passes tool_call when no rule matches", async () => {
      const mockPi: {
        on: ReturnType<typeof vi.fn>;
        registerCommand: ReturnType<typeof vi.fn>;
      } = {
        on: vi.fn().mockImplementation((event, handler) => {
          if (event === "tool_call")
            toolCallHandler = handler as (
              event: ToolCallEvent,
              ctx: unknown,
            ) => Promise<unknown>;
        }),
        registerCommand: vi.fn(),
      };

      const extension = guardrails((ctx) => {
        ctx
          .tool("bash")
          .input("command", ctx.seq(ctx.bash.word("rm"), ctx.star()))
          .block("Use trash");
      });
      await extension(mockPi as unknown as ExtensionAPI);

      const result = await callBash("ls -la");
      expect(result).toBeUndefined();
    });

    it("blocks chained rm after &&", async () => {
      const mockPi: {
        on: ReturnType<typeof vi.fn>;
        registerCommand: ReturnType<typeof vi.fn>;
      } = {
        on: vi.fn().mockImplementation((event, handler) => {
          if (event === "tool_call")
            toolCallHandler = handler as (
              event: ToolCallEvent,
              ctx: unknown,
            ) => Promise<unknown>;
        }),
        registerCommand: vi.fn(),
      };

      const extension = guardrails((ctx) => {
        ctx
          .tool("bash")
          .input("command", ctx.seq(ctx.bash.word("rm"), ctx.star()))
          .block("Use trash");
      });
      await extension(mockPi as unknown as ExtensionAPI);

      const result = await callBash("cd /tmp && rm -rf .");
      expect(result).toEqual({ block: true, reason: "Use trash" });
    });

    it("blocks chained rm after ;", async () => {
      const mockPi: {
        on: ReturnType<typeof vi.fn>;
        registerCommand: ReturnType<typeof vi.fn>;
      } = {
        on: vi.fn().mockImplementation((event, handler) => {
          if (event === "tool_call")
            toolCallHandler = handler as (
              event: ToolCallEvent,
              ctx: unknown,
            ) => Promise<unknown>;
        }),
        registerCommand: vi.fn(),
      };

      const extension = guardrails((ctx) => {
        ctx
          .tool("bash")
          .input("command", ctx.seq(ctx.bash.word("rm"), ctx.star()))
          .block("Use trash");
      });
      await extension(mockPi as unknown as ExtensionAPI);

      const result = await callBash("echo hello; rm -rf /");
      expect(result).toEqual({ block: true, reason: "Use trash" });
    });

    it("blocks chained rm after ||", async () => {
      const mockPi: {
        on: ReturnType<typeof vi.fn>;
        registerCommand: ReturnType<typeof vi.fn>;
      } = {
        on: vi.fn().mockImplementation((event, handler) => {
          if (event === "tool_call")
            toolCallHandler = handler as (
              event: ToolCallEvent,
              ctx: unknown,
            ) => Promise<unknown>;
        }),
        registerCommand: vi.fn(),
      };

      const extension = guardrails((ctx) => {
        ctx
          .tool("bash")
          .input("command", ctx.seq(ctx.bash.word("rm"), ctx.star()))
          .block("Use trash");
      });
      await extension(mockPi as unknown as ExtensionAPI);

      const result = await callBash("ls || rm -rf .");
      expect(result).toEqual({ block: true, reason: "Use trash" });
    });

    it("blocks tool_result when a post-execution rule matches", async () => {
      const mockPi: {
        on: ReturnType<typeof vi.fn>;
        registerCommand: ReturnType<typeof vi.fn>;
      } = {
        on: vi.fn().mockImplementation((event, handler) => {
          if (event === "tool_result")
            toolResultHandler = handler as (
              event: ToolResultEvent,
              ctx: unknown,
            ) => Promise<unknown>;
        }),
        registerCommand: vi.fn(),
      };

      const extension = guardrails((ctx) => {
        ctx
          .tool("bash")
          .input("command", ctx.bash.word("echo"))
          .output(ctx.regex(/secret/i))
          .block("No secrets in output");
      });
      await extension(mockPi as unknown as ExtensionAPI);

      const result = await toolResultHandler!(
        {
          toolCallId: "1",
          toolName: "bash",
          input: { command: "echo secret" },
          content: [{ type: "text", text: "SECRET_VALUE" }],
          isError: false,
        },
        makeCtx(),
      );
      expect(result).toEqual({
        block: true,
        reason: "No secrets in output",
      });
    });

    it("passes tool_result when no post-execution rule matches", async () => {
      const mockPi: {
        on: ReturnType<typeof vi.fn>;
        registerCommand: ReturnType<typeof vi.fn>;
      } = {
        on: vi.fn().mockImplementation((event, handler) => {
          if (event === "tool_result")
            toolResultHandler = handler as (
              event: ToolResultEvent,
              ctx: unknown,
            ) => Promise<unknown>;
        }),
        registerCommand: vi.fn(),
      };

      const extension = guardrails((ctx) => {
        ctx
          .tool("bash")
          .input("command", ctx.bash.word("echo"))
          .output(ctx.regex(/secret/i))
          .block("No secrets");
      });
      await extension(mockPi as unknown as ExtensionAPI);

      const result = await toolResultHandler!(
        {
          toolCallId: "1",
          toolName: "bash",
          input: { command: "echo hello" },
          content: [{ type: "text", text: "hello" }],
          isError: false,
        },
        makeCtx(),
      );
      expect(result).toBeUndefined();
    });

    it("blocks error result when an error rule matches", async () => {
      const mockPi: {
        on: ReturnType<typeof vi.fn>;
        registerCommand: ReturnType<typeof vi.fn>;
      } = {
        on: vi.fn().mockImplementation((event, handler) => {
          if (event === "tool_result")
            toolResultHandler = handler as (
              event: ToolResultEvent,
              ctx: unknown,
            ) => Promise<unknown>;
        }),
        registerCommand: vi.fn(),
      };

      const extension = guardrails((ctx) => {
        ctx
          .tool("bash")
          .error(ctx.regex(/fault|dump/i))
          .block("Tool crashed");
      });
      await extension(mockPi as unknown as ExtensionAPI);

      const result = await toolResultHandler!(
        {
          toolCallId: "1",
          toolName: "bash",
          input: { command: "./crashy" },
          content: [{ type: "text", text: "Segmentation fault (core dumped)" }],
          isError: true,
        },
        makeCtx(),
      );
      expect(result).toEqual({ block: true, reason: "Tool crashed" });
    });

    it("does not block non-error results even with error rules", async () => {
      const mockPi: {
        on: ReturnType<typeof vi.fn>;
        registerCommand: ReturnType<typeof vi.fn>;
      } = {
        on: vi.fn().mockImplementation((event, handler) => {
          if (event === "tool_result")
            toolResultHandler = handler as (
              event: ToolResultEvent,
              ctx: unknown,
            ) => Promise<unknown>;
        }),
        registerCommand: vi.fn(),
      };

      const extension = guardrails((ctx) => {
        ctx
          .tool("bash")
          .error(ctx.regex(/segfault/i))
          .block("Tool crashed");
      });
      await extension(mockPi as unknown as ExtensionAPI);

      const result = await toolResultHandler!(
        {
          toolCallId: "1",
          toolName: "bash",
          input: { command: "ls" },
          content: [{ type: "text", text: "file.txt" }],
          isError: false,
        },
        makeCtx(),
      );
      expect(result).toBeUndefined();
    });

    it("rewrites tool_result when rewrite rule matches", async () => {
      const mockPi: {
        on: ReturnType<typeof vi.fn>;
        registerCommand: ReturnType<typeof vi.fn>;
      } = {
        on: vi.fn().mockImplementation((event, handler) => {
          if (event === "tool_result")
            toolResultHandler = handler as (
              event: ToolResultEvent,
              ctx: unknown,
            ) => Promise<unknown>;
        }),
        registerCommand: vi.fn(),
      };

      const extension = guardrails((ctx) => {
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
      await extension(mockPi as unknown as ExtensionAPI);

      const result = await toolResultHandler!(
        {
          toolCallId: "1",
          toolName: "bash",
          input: { command: "echo password123" },
          content: [{ type: "text", text: "mypassword is secret" }],
          isError: false,
        },
        makeCtx(),
      );
      expect(result?.content).toEqual([
        { type: "text", text: "my*** is secret" },
      ]);
    });
  });

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

  describe("error capture", () => {
    it("fires error rules when isError is true", async () => {
      const ctx = new GuardrailContext();
      ctx
        .tool("bash")
        .error(ctx.regex(/fault|dump/i))
        .block("Tool crashed");

      const result = ctx.matchError({
        toolCallId: "1",
        toolName: "bash",
        input: { command: "./crashy" },
        content: [{ type: "text", text: "Segmentation fault (core dumped)" }],
        isError: true,
      } as unknown as ToolResultEvent);

      expect(result).toEqual({ block: true, reason: "Tool crashed" });
    });

    it("does not fire error rules when isError is false", async () => {
      const ctx = new GuardrailContext();
      ctx
        .tool("bash")
        .error(ctx.regex(/segfault/i))
        .block("Tool crashed");

      const result = ctx.matchError({
        toolCallId: "1",
        toolName: "bash",
        input: { command: "ls" },
        content: [{ type: "text", text: "file.txt" }],
        isError: false,
      } as unknown as ToolResultEvent);

      expect(result).toBeUndefined();
    });

    it("matches error content against regex", async () => {
      const ctx = new GuardrailContext();
      ctx
        .tool("bash")
        .error(ctx.regex(/permission|Operation/i))
        .block("Permission denied");

      const result = ctx.matchError({
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
      } as unknown as ToolResultEvent);

      expect(result).toEqual({ block: true, reason: "Permission denied" });
    });

    it("matches error content with nu tokenizer", async () => {
      const ctx = new GuardrailContext();
      ctx
        .tool("python-eval")
        .error(ctx.seq(ctx.nu.word("Traceback")))
        .block("Python traceback");

      const result = ctx.matchError({
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
      } as unknown as ToolResultEvent);

      expect(result).toEqual({ block: true, reason: "Python traceback" });
    });

    it("passes non-matching error content", async () => {
      const ctx = new GuardrailContext();
      ctx
        .tool("bash")
        .error(ctx.regex(/segfault/i))
        .block("Tool crashed");

      const result = ctx.matchError({
        toolCallId: "1",
        toolName: "bash",
        input: { command: "ls" },
        content: [{ type: "text", text: "file.txt" }],
        isError: true,
      } as unknown as ToolResultEvent);

      expect(result).toBeUndefined();
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

  describe("handler functions", () => {
    it("handleToolError returns error rule result", () => {
      const ctx = new GuardrailContext();
      ctx
        .tool("bash")
        .error(ctx.regex(/fault|dump/i))
        .block("Tool crashed");

      const result = handleToolError(ctx, {
        toolCallId: "1",
        toolName: "bash",
        input: { command: "./crashy" },
        content: [{ type: "text", text: "Segmentation fault (core dumped)" }],
        isError: true,
      } as unknown as ToolResultEvent);

      expect(result).toEqual({ block: true, reason: "Tool crashed" });
    });

    it("handleToolError returns undefined when no error rule matches", () => {
      const ctx = new GuardrailContext();
      ctx
        .tool("bash")
        .error(ctx.regex(/segfault/i))
        .block("Tool crashed");

      const result = handleToolError(ctx, {
        toolCallId: "1",
        toolName: "bash",
        input: { command: "ls" },
        content: [{ type: "text", text: "file.txt" }],
        isError: true,
      } as unknown as ToolResultEvent);

      expect(result).toBeUndefined();
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

      const result = handler.handleError({
        toolCallId: "1",
        toolName: "bash",
        input: { command: "./crashy" },
        content: [{ type: "text", text: "Segmentation fault (core dumped)" }],
        isError: true,
      } as unknown as ToolResultEvent);

      expect(result).toEqual({ block: true, reason: "Tool crashed" });
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

      const result = composed.handleError({
        toolCallId: "1",
        toolName: "bash",
        input: { command: "./crashy" },
        content: [{ type: "text", text: "Segmentation fault (core dumped)" }],
        isError: true,
      } as unknown as ToolResultEvent);

      expect(result).toEqual({ block: true, reason: "Segfault" });
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

      const result = ctx.matchError({
        toolCallId: "1",
        toolName: "bash",
        input: { command: "./crashy" },
        content: [{ type: "text", text: "Segmentation fault (core dumped)" }],
        isError: true,
      } as unknown as ToolResultEvent);

      expect(result).toEqual({ block: true, reason: "Error blocked" });
    });
  });
});
