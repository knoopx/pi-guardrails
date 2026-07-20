import { describe, it, expect, vi, beforeEach } from "vitest";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { ToolCallEvent, ToolResultEvent } from "./lib/builder/events.js";
import guardrails from "./index.js";
import {
  handleToolError,
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

  describe("bash tool_call hook", () => {
    it("blocks rm commands", async () => {
      const result = await callBash("rm foo.txt");
      expect(result).toBeUndefined();
    });

    it("blocks rm with flags", async () => {
      const result = await callBash("rm -rf /");
      expect(result).toBeUndefined();
    });

    it("blocks sudo commands", async () => {
      const result = await callBash("sudo rm foo");
      expect(result).toBeUndefined();
    });

    it("does not block non-rm commands", async () => {
      const result = await callBash("ls -la");
      expect(result).toBeUndefined();
    });

    it("blocks npm install", async () => {
      const result = await callBash("npm install lodash");
      expect(result).toBeUndefined();
    });

    it("passes non-matching edit commands", async () => {
      const result = await callTool("edit", {
        path: "test.ts",
        oldText: "",
        newText: "",
      });
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

  describe("tool_result hook", () => {
    it("returns undefined when no rules match", async () => {
      const result = await toolResultHandler!(
        {
          toolCallId: "1",
          toolName: "bash",
          input: { command: "ls" },
          content: [{ type: "text", text: "file.txt" }],
          details: undefined,
          type: "tool_result",
          isError: false,
        },
        makeCtx(),
      );
      expect(result).toBeUndefined();
    });
  });

  describe("sed/awk blocking", () => {
    it("blocks sed in bash", async () => {
      const result = await callBash("sed -n '/error/p' file.log");
      expect(result).toBeUndefined();
    });

    it("blocks awk in bash", async () => {
      const result = await callBash("awk '{print $1}' file.txt");
      expect(result).toBeUndefined();
    });

    it("allows non-sed/awk bash commands", async () => {
      const result = await callBash("cat file.txt");
      expect(result).toBeUndefined();
    });
  });

  describe("web-fetch github search blocking", () => {
    it("blocks web-fetch on github.com/search", async () => {
      const result = await callTool("web-fetch", {
        source: "https://github.com/search?q=guardrails",
      });
      expect(result).toBeUndefined();
    });

    it("allows web-fetch on regular github URLs", async () => {
      const result = await callTool("web-fetch", {
        source: "https://github.com/user/repo",
      });
      expect(result).toBeUndefined();
    });
  });

  describe("Bun API blocking in edit/write", () => {
    it("blocks write with Bun.file()", async () => {
      const result = await callTool("write", {
        path: "test.ts",
        content: "Bun.file('x')",
      });
      expect(result).toBeUndefined();
    });

    it("blocks write with Bun.spawn()", async () => {
      const result = await callTool("write", {
        path: "test.ts",
        content: "Bun.spawn('cmd')",
      });
      expect(result).toBeUndefined();
    });

    it("blocks edit with Bun.spawn() in newText", async () => {
      const result = await callTool("edit", {
        path: "test.ts",
        oldText: "",
        newText: "Bun.spawn('cmd')",
      });
      expect(result).toBeUndefined();
    });

    it("blocks write with bun: builtin import", async () => {
      const result = await callTool("write", {
        path: "test.ts",
        content: 'import { spawn } from "bun:fs"',
      });
      expect(result).toBeUndefined();
    });

    it("blocks edit with bun: builtin import in newText", async () => {
      const result = await callTool("edit", {
        path: "test.ts",
        oldText: "",
        newText: 'import { spawn } from "bun:fs"',
      });
      expect(result).toBeUndefined();
    });

    it("allows write with non-Bun content", async () => {
      const result = await callTool("write", {
        path: "test.ts",
        content: "console.log('hello')",
      });
      expect(result).toBeUndefined();
    });

    it("allows edit with non-Bun content", async () => {
      const result = await callTool("edit", {
        path: "test.ts",
        oldText: "",
        newText: "const x = 1;",
      });
      expect(result).toBeUndefined();
    });
  });

  describe("TSV safety", () => {
    it("blocks write on .tsv files", async () => {
      const result = await callTool("write", {
        path: "data.tsv",
        content: "col1\tcol2\n1\t2",
      });
      expect(result).toBeUndefined();
    });

    it("blocks edit on .tsv files", async () => {
      const result = await callTool("edit", {
        path: "data.tsv",
        oldText: "col1\tcol2",
        newText: "col1\tcol2\tcol3",
      });
      expect(result).toBeUndefined();
    });

    it("allows write on non-.tsv files", async () => {
      const result = await callTool("write", {
        path: "data.json",
        content: '{"a": 1}',
      });
      expect(result).toBeUndefined();
    });

    it("allows edit on non-.tsv files", async () => {
      const result = await callTool("edit", {
        path: "data.json",
        oldText: '{"a": 1}',
        newText: '{"a": 2}',
      });
      expect(result).toBeUndefined();
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
