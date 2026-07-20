import type { Matcher, Token, Tokenizer } from "../matchers/types.js";
import type {
  TextContent,
  ImageContent,
  ToolCallEvent,
  ToolCallEventResult,
  ToolResultEvent,
  ToolResultEventResult,
} from "./events.js";
import type {
  InputCondition,
  PreExecutionRule,
  PostExecutionRule,
  ErrorRule,
  RewriteFn,
} from "./rules.js";
import type {
  ToolMatcherBuilder,
  PostExecutionActionBuilder,
  MatcherBuilder,
  ErrorActionBuilder,
} from "./builders.js";
import {
  createMatcherBuilder,
  tagged,
  extractTextFromContent,
  interpolateCommand,
} from "./builders.js";
import {
  word,
  seq,
  star,
  spread,
  contains,
  regex as regexMatcher,
  anyOf,
  repeat,
  repeat1,
  opt,
  exact,
  prefixed,
  anyToken,
  path,
} from "../matchers/index.js";
import { tokenizeBash } from "../matchers/tokenizers/bash.js";
import { tokenizeSql } from "../matchers/tokenizers/sql.js";
import { tokenizeNushell } from "../matchers/tokenizers/nushell.js";

/**
 * Pre-execution builder after .input() — supports .block, .confirm, .run, .output, .error
 */
interface PreExecutionInputBuilder extends ToolMatcherBuilder {
  /** Block the call. */
  block(reason: string): void;
  /** Require confirmation. */
  confirm(reason: string): void;
  /** Run a command. */
  run(command: string): void;
  /** Switch to post-execution with an output matcher. */
  output(matcher: Matcher): PostExecutionInputBuilder;
}

/**
 * Post-execution input builder after .output() — supports .block, .confirm, .run, .rewrite
 */
interface PostExecutionInputBuilder {
  /** Block the result. */
  block(reason: string): void;
  /** Require confirmation. */
  confirm(reason: string): void;
  /** Run a command. */
  run(command: string): void;
  /** Rewrite the result. */
  rewrite(fn: RewriteFn): void;
  /** Add another input condition. */
  input(key: string, matcher: Matcher): PostExecutionInputBuilder;
}

/**
 * Root guardrail context — the main builder API entry point.
 */
export class GuardrailContext {
  readonly preRules: PreExecutionRule[] = [];
  readonly postRules: PostExecutionRule[] = [];
  readonly errorRules: ErrorRule[] = [];

  readonly bash: MatcherBuilder;
  readonly nu: MatcherBuilder;
  readonly sql: MatcherBuilder;

  constructor() {
    this.bash = createMatcherBuilder(tokenizeBash);
    this.nu = createMatcherBuilder(tokenizeNushell);
    this.sql = createMatcherBuilder(tokenizeSql);
  }

  regex(pattern: RegExp): Matcher {
    return regexMatcher(pattern);
  }

  glob(pattern: string): Matcher {
    const picomatch = require("picomatch");
    const pm = picomatch(pattern, { matchBase: true, dot: true });
    return {
      match: (tokens: Token[]) => tokens.some((t) => pm(t.value)),
      tryMatch: (tokens: Token[], from: number) => {
        for (let i = from; i < tokens.length; i++) {
          if (pm(tokens[i].value)) return { ok: true, consumed: i - from + 1 };
        }
        return { ok: false };
      },
    };
  }

  anyToken(): Matcher {
    return anyToken();
  }
  seq(...matchers: Matcher[]): Matcher {
    return seq(...matchers);
  }
  star(): Matcher {
    return star();
  }
  spread(): Matcher {
    return spread();
  }
  contains(...inner: Matcher[]): Matcher {
    return contains(...inner);
  }
  anyOf(...matchers: Matcher[]): Matcher {
    return anyOf(...matchers);
  }

  /**
   * Scope to a specific tool by name.
   */
  tool(toolName: string): ToolMatcherBuilder {
    const conditions: InputCondition[] = [];

    // Pre-execution input builder: after .input(), can .block/.confirm/.run/.output/.error
    const preBuilder: PreExecutionInputBuilder = {
      block: (reason) => {
        this.preRules.push({
          toolName,
          inputConditions: [...conditions],
          timing: "before",
          action: "block",
          reason,
        });
      },
      confirm: (reason) => {
        this.preRules.push({
          toolName,
          inputConditions: [...conditions],
          timing: "before",
          action: "confirm",
          reason,
        });
      },
      run: (command) => {
        this.preRules.push({
          toolName,
          inputConditions: [...conditions],
          timing: "before",
          action: "run",
          command,
        });
      },
      output: (matcher: Matcher) => {
        // Return a post-execution input builder
        return createPostInputBuilder(matcher);
      },
      input: (key, matcher) => {
        conditions.push({ key, matcher });
        return preBuilder;
      },
      error: (matcher: Matcher) => {
        return createErrorBuilder(matcher, [...conditions]);
      },
    };

    // Post-execution input builder: after .output(), can .block/.confirm/.run/.rewrite
    const createPostInputBuilder = (
      outputMatcher: Matcher,
    ): PostExecutionInputBuilder => {
      return {
        block: (reason) => {
          this.postRules.push({
            toolName,
            inputConditions: [...conditions],
            outputMatcher,
            timing: "after",
            action: "block",
            reason,
          });
        },
        confirm: (reason) => {
          this.postRules.push({
            toolName,
            inputConditions: [...conditions],
            outputMatcher,
            timing: "after",
            action: "confirm",
            reason,
          });
        },
        run: (command) => {
          this.postRules.push({
            toolName,
            inputConditions: [...conditions],
            outputMatcher,
            timing: "after",
            action: "run",
            command,
          });
        },
        rewrite: (fn) => {
          this.postRules.push({
            toolName,
            inputConditions: [...conditions],
            outputMatcher,
            timing: "after",
            action: "rewrite",
            rewriteFn: fn,
          });
        },
        input: (key, matcher) => {
          conditions.push({ key, matcher });
          return createPostInputBuilder(outputMatcher);
        },
      };
    };

    // Error input builder: after .error(), can .block/.confirm/.run/.rewrite
    const createErrorBuilder = (
      outputMatcher: Matcher,
      initialConditions: InputCondition[] = [],
    ): ErrorActionBuilder => {
      return {
        block: (reason) => {
          this.errorRules.push({
            toolName,
            inputConditions: [...initialConditions],
            outputMatcher,
            timing: "after",
            action: "error_block",
            reason,
          });
        },
        confirm: (reason) => {
          this.errorRules.push({
            toolName,
            inputConditions: [...conditions],
            outputMatcher,
            timing: "after",
            action: "error_confirm",
            reason,
          });
        },
        run: (command) => {
          this.errorRules.push({
            toolName,
            inputConditions: [...conditions],
            outputMatcher,
            timing: "after",
            action: "error_run",
            reason: command,
            command,
          });
        },
        rewrite: (fn) => {
          this.errorRules.push({
            toolName,
            inputConditions: [...conditions],
            outputMatcher,
            timing: "after",
            action: "error_rewrite",
            rewriteFn: fn,
          });
        },
      };
    };

    const toolBuilder: ToolMatcherBuilder = {
      input: (key, matcher) => {
        conditions.push({ key, matcher });
        return preBuilder;
      },
      output: (matcher: Matcher) => {
        return createPostInputBuilder(matcher);
      },
      error: (matcher: Matcher) => {
        return createErrorBuilder(matcher);
      },
    };

    return toolBuilder;
  }

  /** Evaluate pre-execution rules against a tool_call event. */
  matchCall(event: ToolCallEvent): ToolCallEventResult | undefined {
    for (const rule of this.preRules) {
      if (rule.toolName !== event.toolName) continue;
      if (!this.evaluateConditions(rule.inputConditions, event.input)) continue;
      return this.handlePreAction(rule);
    }
    return undefined;
  }

  /** Evaluate error rules against a tool_result event (only when isError is true). */
  matchError(event: ToolResultEvent): ToolResultEventResult | undefined {
    if (!event.isError) return undefined;
    for (const rule of this.errorRules) {
      if (rule.toolName !== event.toolName) continue;
      if (!this.evaluateConditions(rule.inputConditions, event.input)) continue;
      if (!this.matchesOutputRule(rule, event)) continue;
      return this.handleErrorAction(rule, event);
    }
    return undefined;
  }

  private handlePreAction(
    rule: PreExecutionRule,
  ): ToolCallEventResult | undefined {
    switch (rule.action) {
      case "block":
        return {
          block: true,
          reason: rule.reason ?? `Blocked by guardrail [${rule.toolName}]`,
        };
      case "confirm":
        return {
          block: true,
          reason: rule.reason ?? `Confirmation required: ${rule.toolName}`,
        };
      case "run":
        return rule.timing === "before" && rule.command
          ? { block: true, reason: `Command blocked: ${rule.command}` }
          : undefined;
      default:
        return undefined;
    }
  }

  /** Evaluate post-execution rules against a tool_result event. */
  matchResult(event: ToolResultEvent): ToolResultEventResult | undefined {
    for (const rule of this.postRules) {
      if (rule.toolName !== event.toolName) continue;
      if (!this.evaluateConditions(rule.inputConditions, event.input)) continue;
      if (!this.matchesOutputRule(rule, event)) continue;
      return this.handlePostAction(rule, event);
    }
    return undefined;
  }

  private matchesOutputRule(
    rule: PostExecutionRule | ErrorRule,
    event: ToolResultEvent,
  ): boolean {
    const outputMatcher = (rule as PostExecutionRule).outputMatcher;
    if (!outputMatcher || !event.content) return true;
    const text = extractTextFromContent(event.content);
    const m = outputMatcher as Matcher & {
      __tokenizer?: Tokenizer;
      __isRegex?: boolean;
      __patterns?: RegExp[];
    };

    // Regex matchers test against the full text to handle patterns that span
    // token boundaries (e.g. /segfault|signal 11/i matching "signal 11")
    if (m.__isRegex && m.__patterns) {
      return m.__patterns.some((p: RegExp) => {
        p.lastIndex = 0;
        return p.test(text);
      });
    }

    const segments = (m.__tokenizer ?? tokenizeBash)(text);
    if (segments.length === 0) return false;
    // Check all command segments (e.g., "cd dir && rm file" has two segments).
    // Any segment matching is sufficient to trigger the rule.
    return segments.some((seg) => m.match(seg));
  }

  private handlePostAction(
    rule: PostExecutionRule,
    event: ToolResultEvent,
  ): ToolResultEventResult | undefined {
    switch (rule.action) {
      case "block":
        return {
          block: true,
          reason:
            rule.reason ?? `Result blocked by guardrail [${rule.toolName}]`,
        };
      case "confirm":
        return {
          block: true,
          reason:
            rule.reason ??
            `Confirmation required for result [${rule.toolName}]`,
        };
      case "run":
        return this.handlePostRun(rule, event);
      case "rewrite":
        return this.handlePostRewrite(rule, event);
      default:
        return undefined;
    }
  }

  private handlePostRun(
    rule: PostExecutionRule,
    event: ToolResultEvent,
  ): ToolResultEventResult | undefined {
    if (!rule.command) return undefined;
    const interpolated = interpolateCommand(rule.command, event.input);
    const text = extractTextFromContent(event.content);
    return {
      content: [
        {
          type: "text",
          text: `${text}\n\n⚠ Guardrail command: ${interpolated}`,
        },
      ],
    };
  }

  private handlePostRewrite(
    rule: PostExecutionRule,
    event: ToolResultEvent,
  ): ToolResultEventResult | undefined {
    if (!rule.rewriteFn) return undefined;
    return rule.rewriteFn(event);
  }

  private handleErrorAction(
    rule: ErrorRule,
    event: ToolResultEvent,
  ): ToolResultEventResult | undefined {
    switch (rule.action) {
      case "error_block":
        return {
          block: true,
          reason:
            rule.reason ?? `Error blocked by guardrail [${rule.toolName}]`,
        };
      case "error_confirm":
        return {
          block: true,
          reason:
            rule.reason ?? `Confirmation required for error [${rule.toolName}]`,
        };
      case "error_run":
        return this.handlePostRun(rule, event);
      case "error_rewrite":
        return this.handlePostRewriteError(rule, event);
      default:
        return undefined;
    }
  }

  private handlePostRewriteError(
    rule: ErrorRule,
    event: ToolResultEvent,
  ): ToolResultEventResult | undefined {
    if (!rule.rewriteFn) return undefined;
    return rule.rewriteFn(event);
  }

  private evaluateConditions(
    conditions: InputCondition[],
    input: Record<string, unknown>,
  ): boolean {
    if (conditions.length === 0) return true;
    for (const { key, matcher } of conditions) {
      const value = input[key];
      if (value === undefined || value === null) return false;
      const text = typeof value === "string" ? value : String(value);

      // Regex matchers match against the raw string to handle patterns
      // that span token boundaries (e.g. /\bxit\(/ split into ['xit', '(']
      // by the bash tokenizer)
      if (matcher.__isRegex) {
        const patterns = matcher.__patterns!;
        if (
          !patterns.some((p: RegExp) => {
            p.lastIndex = 0;
            return p.test(text);
          })
        ) {
          return false;
        }
        continue;
      }

      const m = matcher as Matcher & { __tokenizer: Tokenizer };
      const segments = (m.__tokenizer ?? tokenizeBash)(text);
      if (segments.length === 0) return false;
      // Check all command segments (e.g., "cd dir && rm file" has two segments).
      // If none match, this condition fails.
      if (!segments.some((seg) => matcher.match(seg))) return false;
    }
    return true;
  }
}
