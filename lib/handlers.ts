import type { GuardrailsConfigLoader } from "./config/loader.js";
import type { GuardrailContext } from "./builder/context.js";
import type { ToolCallEvent, ToolResultEvent, ToolCallEventResult, ToolResultEventResult } from "./builder/events.js";

/**
 * Create a command handler for the `/guardrails` command.
 * Toggles guardrails on or off via the config loader.
 */
export function createGuardrailsHandler(
  configLoader: GuardrailsConfigLoader,
): (args: string, ctx: unknown) => Promise<void> {
  return async (args: string, _ctx: unknown) => {
    if (args === "on") {
      configLoader.enabled = true;
      await configLoader.save();
    } else if (args === "off") {
      configLoader.enabled = false;
      await configLoader.save();
    }
  };
}

/**
 * Execute guardrail checks on a tool call event.
 * Returns the first matching result, or undefined if no rule triggers.
 */
export function handleToolCall(ctx: GuardrailContext, event: ToolCallEvent): ToolCallEventResult | undefined {
  return ctx.matchCall(event);
}

/**
 * Execute guardrail checks on a tool result event.
 * Returns the first matching result, or undefined if no rule triggers.
 */
export function handleToolResult(ctx: GuardrailContext, event: ToolResultEvent): ToolResultEventResult | undefined {
  return ctx.matchResult(event);
}

/**
 * Create a guardrail handler function for a specific context.
 * Returns a function that handles both tool calls and results.
 */
export function createHandler(ctx: GuardrailContext): {
  handleCall: (event: ToolCallEvent) => ToolCallEventResult | undefined;
  handleResult: (event: ToolResultEvent) => ToolResultEventResult | undefined;
} {
  return {
    handleCall: (event) => ctx.matchCall(event),
    handleResult: (event) => ctx.matchResult(event),
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
export function composeContexts(
  ...contexts: GuardrailContext[]
): {
  handleCall: (event: ToolCallEvent) => ToolCallEventResult | undefined;
  handleResult: (event: ToolResultEvent) => ToolResultEventResult | undefined;
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
  };
}
