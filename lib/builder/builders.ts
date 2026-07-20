import type { Matcher, Tokenizer } from "../matchers/types.js";
import type { ToolResultEvent, ToolResultEventResult, TextContent, ImageContent } from "./events.js";
import type { GuardrailAction, Timing, PreExecutionRule, PostExecutionRule, InputCondition, RewriteFn, RewriteBuilder } from "./rules.js";
import { word } from "../matchers/index.js";

/** Builder context after `.tool(name)`. */
export interface ToolMatcherBuilder {
  /** Add an input condition; chains back to self for more inputs or to .output/.block/.confirm/.run. */
  input(key: string, matcher: Matcher): ToolMatcherBuilder;
  /** Switch to post-execution mode with an output matcher. */
  output(matcher: Matcher): PostExecutionActionBuilder;
}

/** Builder context after `.output(...)`. */
export interface PostExecutionActionBuilder {
  /** Block the result. */
  block(reason: string): void;
  /** Require confirmation for the result. */
  confirm(reason: string): void;
  /** Run a command on matching result. */
  run(command: string): void;
  /** Rewrite the result. */
  rewrite(fn: RewriteFn): void;
  /** Add another input condition before finalizing. */
  input(key: string, matcher: Matcher): PostExecutionActionBuilder;
}

/** Timing builder for pre/post rules. */
export interface TimingBuilder {
  before: ActionBuilder;
  after: ActionBuilder;
}

/** Action builder for pre/post rules. */
export interface ActionBuilder {
  block(reason: string): void;
  confirm(reason: string): void;
  input(key: string, matcher: Matcher): ActionBuilder;
}

/** Builder for tokenized matchers (bash/nu/sql). */
export interface MatcherBuilder {
  word: (...words: string[]) => Matcher;
}

/** Rewrite builder for transforming properties. */
export interface RewriteBuilder {
  command: (fn: RewriteFn) => RewriteBuilder;
  output: (fn: RewriteFn) => RewriteBuilder;
  file_path: (fn: RewriteFn) => RewriteBuilder;
  path: (fn: RewriteFn) => RewriteBuilder;
}

// ── Helper functions ──────────────────────────────────────────────────────────

/** Tag a matcher with a tokenizer for evaluation. */
export function tagged(matcher: Matcher, tokenizer: Tokenizer): Matcher {
  return Object.assign(matcher, { __tokenizer: tokenizer } as Matcher & { __tokenizer: Tokenizer });
}

/** Create a rewrite builder. */
export function createRewriteBuilder(): RewriteBuilder {
  const builders: Map<string, RewriteFn> = new Map();

  const builder: RewriteBuilder = {
    command: (fn: RewriteFn) => {
      builders.set("command", fn);
      return builder;
    },
    output: (fn: RewriteFn) => {
      builders.set("output", fn);
      return builder;
    },
    file_path: (fn: RewriteFn) => {
      builders.set("file_path", fn);
      return builder;
    },
    path: (fn: RewriteFn) => {
      builders.set("path", fn);
      return builder;
    },
  };

  return builder;
}

/** Create a matcher builder for a tokenizer. */
export function createMatcherBuilder(tokenizer: Tokenizer): MatcherBuilder {
  return {
    word: (...words: string[]) => tagged(word(...words), tokenizer),
  };
}

/** Create a timing builder. */
export function createTimingBuilder({
  preRules,
  postRules,
  conditions,
  toolName,
  isPost = false,
}: {
  preRules: PreExecutionRule[];
  postRules: PostExecutionRule[];
  conditions: InputCondition[];
  toolName: string;
  isPost?: boolean;
}): TimingBuilder {
  const addRule = (action: GuardrailAction, reason?: string, command?: string, rewriteFn?: RewriteFn, outputMatcher?: Matcher) => {
    if (isPost) {
      postRules.push({
        toolName,
        inputConditions: [...conditions],
        outputMatcher,
        timing: "after",
        action,
        reason,
        command,
        rewriteFn,
      });
    } else {
      preRules.push({
        toolName,
        inputConditions: [...conditions],
        timing: "before",
        action,
        reason,
        command,
        rewriteFn,
      });
    }
  };

  return {
    before: createActionBuilder({ addRule, isPost: false }),
    after: createActionBuilder({ addRule, isPost: true }),
  };
}

function createActionBuilder({
  addRule,
  isPost,
}: {
  addRule: (action: GuardrailAction, reason?: string, command?: string, rewriteFn?: RewriteFn, outputMatcher?: Matcher) => void;
  isPost: boolean;
}): ActionBuilder {
  const conditions: InputCondition[] = [];
  let outputMatcher: Matcher | undefined;

  return {
    block(reason: string) {
      addRule("block", reason);
    },
    confirm(reason: string) {
      addRule("confirm", reason);
    },
    input(key: string, matcher: Matcher) {
      conditions.push({ key, matcher });
      return this;
    },
  };
}

/** Extract text content from tool result content array. */
export function extractTextFromContent(content: (TextContent | ImageContent)[]): string {
  return content
    .filter((c): c is TextContent => c.type === "text")
    .map((c) => c.text)
    .join("\n");
}

/** Interpolate {key} placeholders from matched input values. */
export function interpolateCommand(
  cmd: string,
  input: Record<string, unknown>,
): string {
  return cmd.replace(/\{(\w+)\}/g, (_match, key) => {
    const value = input[key];
    if (value === undefined || value === null) return `{${key}}`;
    return String(value);
  });
}
