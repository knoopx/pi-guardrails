import type { GuardrailsConfigLoader } from "./config/loader.js";
import type { GuardrailContext } from "./builder/context.js";
import type {
  ToolCallEvent,
  ToolResultEvent,
  ToolCallEventResult,
  ToolResultEventResult,
} from "./builder/events.js";
import type { ExtensionCommandContext } from "@earendil-works/pi-coding-agent";

/**
 * Create a command handler for the `/guardrails` command.
 * Toggles guardrails on or off via the config loader.
 */
export function createGuardrailsHandler(
  configLoader: GuardrailsConfigLoader,
): (args: string, ctx: ExtensionCommandContext) => Promise<void> {
  return async (args: string, ctx) => {
    if (args === "on") {
      configLoader.enabled = true;
      try {
        await configLoader.save();
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        ctx.ui.notify(
          `Failed to persist guardrails state: ${message}`,
          "error",
        );
        throw err;
      }
      ctx.ui.notify("Guardrails enabled", "info");
    } else if (args === "off") {
      configLoader.enabled = false;
      try {
        await configLoader.save();
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        ctx.ui.notify(
          `Failed to persist guardrails state: ${message}`,
          "error",
        );
        throw err;
      }
      ctx.ui.notify("Guardrails disabled", "info");
    } else {
      throw new Error(
        `Invalid guardrails command: "${args}". Use /guardrails [on|off]`,
      );
    }
  };
}

/**
 * Execute guardrail checks on a tool call event.
 * Returns the first matching result, or undefined if no rule triggers.
 */
export function handleToolCall(
  ctx: GuardrailContext,
  event: ToolCallEvent,
): ToolCallEventResult | undefined {
  return ctx.matchCall(event);
}

/**
 * Execute guardrail checks on a tool result event.
 * Returns the first matching result, or undefined if no rule triggers.
 */
export function handleToolResult(
  ctx: GuardrailContext,
  event: ToolResultEvent,
): ToolResultEventResult | undefined {
  return ctx.matchResult(event);
}

/**
 * Execute guardrail checks on a tool error event.
 * Returns the first matching error rule result, or undefined if no rule triggers.
 */
export function handleToolError(
  ctx: GuardrailContext,
  event: ToolResultEvent,
): ToolResultEventResult | undefined {
  return ctx.matchError(event);
}

/**
 * Create a guardrail handler function for a specific context.
 * Returns a function that handles tool calls, results, and errors.
 */
export function createHandler(ctx: GuardrailContext): {
  handleCall: (event: ToolCallEvent) => ToolCallEventResult | undefined;
  handleResult: (event: ToolResultEvent) => ToolResultEventResult | undefined;
  handleError: (event: ToolResultEvent) => ToolResultEventResult | undefined;
} {
  return {
    handleCall: (event) => ctx.matchCall(event),
    handleResult: (event) => ctx.matchResult(event),
    handleError: (event) => ctx.matchError(event),
  };
}

/**
 * Run guardrail checks with fallback.
 * If the primary handler returns a result, use it; otherwise apply the fallback.
 */
export function withFallback<T>(primary: () => T | undefined, fallback: T): T {
  const result = primary();
  return result ?? fallback;
}

/**
 * Compose multiple guardrail contexts.
 * Returns a context-like handler that checks all contexts in order.
 */
export function composeContexts(...contexts: GuardrailContext[]): {
  handleCall: (event: ToolCallEvent) => ToolCallEventResult | undefined;
  handleResult: (event: ToolResultEvent) => ToolResultEventResult | undefined;
  handleError: (event: ToolResultEvent) => ToolResultEventResult | undefined;
} {
  return {
    handleCall: (event) => {
      for (const ctx of contexts) {
        const result = ctx.matchCall(event);
        if (result) return result;
      }
      return undefined;
    },
    handleResult: (event) => {
      for (const ctx of contexts) {
        const result = ctx.matchResult(event);
        if (result) return result;
      }
      return undefined;
    },
    handleError: (event) => {
      for (const ctx of contexts) {
        const result = ctx.matchError(event);
        if (result) return result;
      }
      return undefined;
    },
  };
}
