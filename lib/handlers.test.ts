import { describe, it, expect, vi, beforeEach } from "vitest";
import type { ToolResultEvent } from "./builder/events.js";
import {
  handleToolCall,
  handleToolResult,
  handleToolError,
  createHandler,
  composeContexts,
  withFallback,
  createGuardrailsHandler,
} from "./handlers.js";
import { GuardrailContext } from "./builder/context.js";

function makeCall(toolName: string, input: Record<string, unknown>) {
  return { toolCallId: "1", toolName, input };
}

function makeResult(
  toolName: string,
  input: Record<string, unknown>,
  text: string,
  isError = false,
) {
  return {
    toolCallId: "1",
    toolName,
    input,
    content: [{ type: "text" as const, text }],
    isError,
  } as unknown as ToolResultEvent;
}

// ── Helpers to eliminate duplicated context-setup ──────────────────────────────

function makeBashBlockCtx(cmd: string, msg: string): GuardrailContext {
  const ctx = new GuardrailContext();
  ctx
    .tool("bash")
    .input("command", ctx.seq(ctx.bash.word(cmd), ctx.star()))
    .block(msg);
  return ctx;
}

function makeBashErrorCtx(pattern: RegExp, msg: string): GuardrailContext {
  const ctx = new GuardrailContext();
  ctx
    .tool("bash")
    .error(ctx.regex(pattern))
    .block(msg);
  return ctx;
}

async function assertSaveFailure(
  loader: { enabled: boolean; save: ReturnType<typeof vi.fn> },
  ctx: { ui: { notify: ReturnType<typeof vi.fn> } },
  command: "on" | "off",
  rejection: Error | string,
  expectedEnabled: boolean,
  expectedNotifyMessage: string,
) {
  (loader as any).save = vi.fn().mockRejectedValueOnce(rejection);

  const handler = createGuardrailsHandler(loader as any);
  await expect(handler(command, ctx as any)).rejects.toThrow(rejection);
  expect(loader.enabled).toBe(expectedEnabled);
  expect(ctx.ui.notify).toHaveBeenCalledWith(
    expectedNotifyMessage,
    "error",
  );
}

// ──────────────────────────────────────────────────────────────────────────────
// handleToolCall
// ──────────────────────────────────────────────────────────────────────────────

describe("handleToolCall", () => {
  it("returns undefined when no rule matches", () => {
    const ctx = makeBashBlockCtx("rm", "No rm");
    const result = handleToolCall(ctx, makeCall("bash", { command: "ls" }));
    expect(result).toBeUndefined();
  });

  it("returns block result when rule matches", () => {
    const ctx = makeBashBlockCtx("rm", "No rm");
    const result = handleToolCall(
      ctx,
      makeCall("bash", { command: "rm foo.txt" }),
    );
    expect(result).toMatchObject({ block: true, reason: "No rm" });
  });

  it("returns undefined when wrong tool name", () => {
    const ctx = makeBashBlockCtx("rm", "No rm");
    const result = handleToolCall(
      ctx,
      makeCall("write", { path: "file.txt", content: "rm" }),
    );
    expect(result).toBeUndefined();
  });

  it("returns first match when multiple rules apply", () => {
    const ctx = makeBashBlockCtx("rm", "No rm");
    ctx
      .tool("bash")
      .input("command", ctx.seq(ctx.bash.word("sudo"), ctx.star()))
      .block("No sudo");

    const result = handleToolCall(
      ctx,
      makeCall("bash", { command: "rm foo.txt" }),
    );
    expect(result).toMatchObject({ reason: "No rm" });
  });

  it("handles custom tool names", () => {
    const ctx = new GuardrailContext();
    ctx
      .tool("custom-tool")
      .input("param", ctx.anyToken())
      .block("Custom blocked");

    const result = handleToolCall(
      ctx,
      makeCall("custom-tool", { param: "value" }),
    );
    expect(result).toMatchObject({ block: true, reason: "Custom blocked" });
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// handleToolResult
// ──────────────────────────────────────────────────────────────────────────────

describe("handleToolResult", () => {
  it("returns undefined when no rule matches", () => {
    const ctx = new GuardrailContext();
    ctx
      .tool("bash")
      .input("command", ctx.seq(ctx.bash.word("rm"), ctx.star()))
      .output(ctx.anyToken())
      .block("Blocked");

    const result = handleToolResult(
      ctx,
      makeResult("bash", { command: "ls" }, "output"),
    );
    expect(result).toBeUndefined();
  });

  it("returns block result when output matches", () => {
    const ctx = new GuardrailContext();
    ctx
      .tool("bash")
      .input("command", ctx.seq(ctx.bash.word("rm"), ctx.star()))
      .output(ctx.regex(/error/i))
      .block("Error found");

    const result = handleToolResult(
      ctx,
      makeResult("bash", { command: "rm foo.txt" }, "error occurred"),
    );
    expect(result).toMatchObject({ block: true, reason: "Error found" });
  });

  it("does not match when output does not match", () => {
    const ctx = new GuardrailContext();
    ctx
      .tool("bash")
      .input("command", ctx.seq(ctx.bash.word("rm"), ctx.star()))
      .output(ctx.regex(/error/i))
      .block("Blocked");

    const result = handleToolResult(
      ctx,
      makeResult("bash", { command: "rm foo.txt" }, "success"),
    );
    expect(result).toBeUndefined();
  });

  it("matches multiple post-execution rules with first-match-wins", () => {
    const ctx = new GuardrailContext();
    ctx
      .tool("bash")
      .input("command", ctx.seq(ctx.bash.word("rm"), ctx.star()))
      .output(ctx.regex(/csv/i))
      .block("First: csv");

    ctx
      .tool("bash")
      .input("command", ctx.seq(ctx.bash.word("rm"), ctx.star()))
      .output(ctx.regex(/~/))
      .block("Second: tilde");

    const result = handleToolResult(
      ctx,
      makeResult("bash", { command: "rm ~/data.csv" }, "~/data.csv"),
    );
    expect(result).toMatchObject({ reason: "First: csv" });
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// handleToolError
// ──────────────────────────────────────────────────────────────────────────────

describe("handleToolError", () => {
  it("returns undefined for non-error events", () => {
    const ctx = new GuardrailContext();
    ctx.tool("bash").error(ctx.anyToken()).block("Error blocked");

    const result = handleToolError(
      ctx,
      makeResult("bash", { command: "ls" }, "output", false),
    );
    expect(result).toBeUndefined();
  });

  it("returns block when error matches", () => {
    const ctx = new GuardrailContext();
    ctx
      .tool("bash")
      .error(ctx.regex(/segfault|signal 11/i))
      .block("Crash detected");

    const result = handleToolError(
      ctx,
      makeResult(
        "bash",
        { command: "./crash" },
        "Segmentation fault (signal 11)",
        true,
      ),
    );
    expect(result).toMatchObject({ block: true, reason: "Crash detected" });
  });

  it("returns undefined when error pattern does not match", () => {
    const ctx = new GuardrailContext();
    ctx
      .tool("bash")
      .error(ctx.regex(/segfault/i))
      .block("Crash");

    const result = handleToolError(
      ctx,
      makeResult("bash", { command: "./ok" }, "Exit code 0", true),
    );
    expect(result).toBeUndefined();
  });

  it("does not match on non-matching tool name", () => {
    const ctx = new GuardrailContext();
    ctx.tool("bash").error(ctx.anyToken()).block("Blocked");

    const result = handleToolError(
      ctx,
      makeResult("write", { path: "x" }, "error", true),
    );
    expect(result).toBeUndefined();
  });

  it("matches error when pattern matches", () => {
    const ctx = new GuardrailContext();
    ctx
      .tool("bash")
      .error(ctx.regex(/segfault/i))
      .block("dd error");

    const result = handleToolError(
      ctx,
      makeResult(
        "bash",
        { command: "dd if=/dev/zero" },
        "segfault caught",
        true,
      ),
    );
    expect(result).toMatchObject({ block: true, reason: "dd error" });
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// createHandler
// ──────────────────────────────────────────────────────────────────────────────

describe("createHandler", () => {
  it("provides handleCall, handleResult, handleError", () => {
    const ctx = makeBashBlockCtx("rm", "No rm");
    const handler = createHandler(ctx);
    expect(typeof handler.handleCall).toBe("function");
    expect(typeof handler.handleResult).toBe("function");
    expect(typeof handler.handleError).toBe("function");
  });

  it("handleCall returns block result", () => {
    const ctx = makeBashBlockCtx("rm", "No rm");
    const handler = createHandler(ctx);
    const result = handler.handleCall(
      makeCall("bash", { command: "rm foo.txt" }),
    );
    expect(result).toMatchObject({ block: true, reason: "No rm" });
  });

  it("handleResult returns block on output match", () => {
    const ctx = new GuardrailContext();
    ctx
      .tool("bash")
      .input("command", ctx.seq(ctx.bash.word("rm"), ctx.star()))
      .output(ctx.regex(/error/i))
      .block("Error");

    const handler = createHandler(ctx);
    const result = handler.handleResult(
      makeResult("bash", { command: "rm foo.txt" }, "error"),
    );
    expect(result).toMatchObject({ block: true, reason: "Error" });
  });

  it("handleError returns block on error match", () => {
    const ctx = makeBashErrorCtx(/segfault/i, "Crash");
    const handler = createHandler(ctx);
    const result = handler.handleError(
      makeResult("bash", { command: "x" }, "segfault", true),
    );
    expect(result).toMatchObject({ block: true, reason: "Crash" });
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// composeContexts
// ──────────────────────────────────────────────────────────────────────────────

describe("composeContexts", () => {
  it("checks all contexts in order", () => {
    const ctx1 = makeBashBlockCtx("rm", "No rm");
    const ctx2 = makeBashBlockCtx("sudo", "No sudo");

    const composed = composeContexts(ctx1, ctx2);
    const result = composed.handleCall(
      makeCall("bash", { command: "sudo ls" }),
    );
    expect(result).toMatchObject({ block: true, reason: "No sudo" });
  });

  it("returns first match, skips remaining contexts", () => {
    const ctx1 = makeBashBlockCtx("rm", "No rm");
    const ctx2 = makeBashBlockCtx("rm", "Second rm");

    const composed = composeContexts(ctx1, ctx2);
    const result = composed.handleCall(
      makeCall("bash", { command: "rm foo.txt" }),
    );
    expect(result).toMatchObject({ reason: "No rm" });
    expect(result?.reason).not.toBe("Second rm");
  });

  it("returns undefined when no context matches", () => {
    const ctx1 = makeBashBlockCtx("rm", "No rm");
    const composed = composeContexts(ctx1);
    const result = composed.handleCall(makeCall("bash", { command: "ls" }));
    expect(result).toBeUndefined();
  });

  it("composes error handlers", () => {
    const ctx1 = makeBashErrorCtx(/segfault/i, "Crash");
    const ctx2 = makeBashErrorCtx(/out of memory/i, "OOM");

    const composed = composeContexts(ctx1, ctx2);
    const result = composed.handleError(
      makeResult("bash", { command: "x" }, "out of memory", true),
    );
    expect(result).toMatchObject({ block: true, reason: "OOM" });
  });

  it("composes result handlers", () => {
    const ctx1 = new GuardrailContext();
    ctx1
      .tool("bash")
      .input("command", ctx1.seq(ctx1.bash.word("ls"), ctx1.star()))
      .output(ctx1.regex(/error/i))
      .block("Error");

    const ctx2 = new GuardrailContext();
    ctx2
      .tool("bash")
      .input("command", ctx2.seq(ctx2.bash.word("ls"), ctx2.star()))
      .output(ctx2.regex(/warning/i))
      .block("Warning");

    const composed = composeContexts(ctx1, ctx2);
    const result = composed.handleResult(
      makeResult("bash", { command: "ls ~" }, "warning msg"),
    );
    expect(result).toMatchObject({ block: true, reason: "Warning" });
  });

  it("handles multiple contexts with different tool names", () => {
    const ctx1 = makeBashBlockCtx("rm", "No rm");
    const ctx2 = new GuardrailContext();
    ctx2.tool("write").input("path", ctx2.glob("*.env")).block("No env");

    const composed = composeContexts(ctx1, ctx2);

    expect(
      composed.handleCall(makeCall("bash", { command: "rm foo" })),
    ).toMatchObject({ block: true, reason: "No rm" });
    expect(
      composed.handleCall(makeCall("write", { path: ".env", content: "x" })),
    ).toMatchObject({ block: true, reason: "No env" });
    expect(
      composed.handleCall(makeCall("bash", { command: "ls" })),
    ).toBeUndefined();
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// withFallback
// ──────────────────────────────────────────────────────────────────────────────

describe("withFallback", () => {
  it("returns primary result when available", () => {
    const result = withFallback(() => ({ block: true, reason: "primary" }), {
      block: false,
      reason: "fallback",
    });
    expect(result).toEqual({ block: true, reason: "primary" });
  });

  it("returns fallback when primary returns undefined", () => {
    const result = withFallback(() => undefined, {
      block: false,
      reason: "fallback",
    });
    expect(result).toEqual({ block: false, reason: "fallback" });
  });

  it("returns fallback when primary returns null", () => {
    const result = withFallback(
      () => null as unknown as { block?: boolean; reason?: string } | null,
      { block: false, reason: "fallback" },
    );
    expect(result).toEqual({ block: false, reason: "fallback" });
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// createGuardrailsHandler
// ──────────────────────────────────────────────────────────────────────────────

describe("createGuardrailsHandler", () => {
  let mockLoader: { enabled: boolean; save: ReturnType<typeof vi.fn> };
  let mockCtx: { ui: { notify: ReturnType<typeof vi.fn> } };

  beforeEach(() => {
    mockLoader = {
      enabled: true,
      save: vi.fn(async () => {}),
    };
    mockCtx = {
      ui: { notify: vi.fn() },
    };
  });

  it("is a function that accepts args and context", () => {
    const handler = createGuardrailsHandler(mockLoader as any);
    expect(typeof handler).toBe("function");
  });

  it("enables guardrails when args is 'on'", async () => {
    mockLoader.enabled = false;
    const handler = createGuardrailsHandler(mockLoader as any);
    await handler("on", mockCtx as any);
    expect(mockLoader.enabled).toBe(true);
    expect(mockLoader.save).toHaveBeenCalled();
    expect(mockCtx.ui.notify).toHaveBeenCalledWith(
      "Guardrails enabled",
      "info",
    );
  });

  it("disables guardrails when args is 'off'", async () => {
    mockLoader.enabled = true;
    const handler = createGuardrailsHandler(mockLoader as any);
    await handler("off", mockCtx as any);
    expect(mockLoader.enabled).toBe(false);
    expect(mockLoader.save).toHaveBeenCalled();
    expect(mockCtx.ui.notify).toHaveBeenCalledWith(
      "Guardrails disabled",
      "info",
    );
  });

  it("throws on unknown args", async () => {
    const handler = createGuardrailsHandler(mockLoader as any);
    await expect(handler("foobar", mockCtx as any)).rejects.toThrow(
      /Invalid guardrails command/,
    );
  });

  it("catches Error on save failure (on path)", async () => {
    assertSaveFailure(
      mockLoader,
      mockCtx,
      "on",
      new Error("disk full"),
      true,
      "Failed to persist guardrails state: disk full",
    );
  });

  it("catches non-Error string on save failure (on path)", async () => {
    assertSaveFailure(
      mockLoader,
      mockCtx,
      "on",
      "unknown error",
      true,
      "Failed to persist guardrails state: unknown error",
    );
  });

  it("catches Error on save failure (off path)", async () => {
    assertSaveFailure(
      mockLoader,
      mockCtx,
      "off",
      new Error("IO error"),
      false,
      "Failed to persist guardrails state: IO error",
    );
  });

  it("catches non-Error string on save failure (off path)", async () => {
    assertSaveFailure(
      mockLoader,
      mockCtx,
      "off",
      "network error",
      false,
      "Failed to persist guardrails state: network error",
    );
  });
});
