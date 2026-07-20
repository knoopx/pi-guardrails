import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { configLoader } from "./lib/config/loader.js";
import { createGuardrailsHandler } from "./lib/handlers.js";
import { GuardrailContext } from "./lib/builder/context.js";

export type { GuardrailContext } from "./lib/builder/context.js";
export type { ErrorRule } from "./lib/builder/rules.js";

/**
 * SDK entry point: pass a builder callback and get a configured PI extension.
 *
 * @example
 * ```ts
 * import guardrails from "pi-guardrails";
 *
 * export default guardrails((ctx) => {
 *   ctx.tool("bash")
 *     .input("command", ctx.seq(ctx.bash.word("rm"), ctx.star()))
 *     .block("Use trash instead of rm");
 * });
 * ```
 */
export function guardrails(rules: (ctx: GuardrailContext) => void) {
  return async function extension(pi: ExtensionAPI) {
    await configLoader.load();

    pi.registerCommand("guardrails", {
      description:
        "Toggle guardrails with on|off (usage: /guardrails [on|off])",
      handler: createGuardrailsHandler(configLoader),
    });

    pi.on("tool_call", async (event) => {
      if (!configLoader.enabled) return;

      const ctx = new GuardrailContext();
      rules(ctx);
      return ctx.matchCall(event);
    });

    pi.on("tool_result", async (event) => {
      if (!configLoader.enabled) return;

      const ctx = new GuardrailContext();
      rules(ctx);
      return ctx.matchError(event) ?? ctx.matchResult(event);
    });
  };
}

export default guardrails;
