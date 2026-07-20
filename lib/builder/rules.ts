import type { Matcher } from "../matchers/types.js";
import type {
  ToolResultEvent,
  ToolResultEventResult,
  TextContent,
  ImageContent,
} from "./events.js";

/** Timing of when a rule fires. */
export type Timing = "before" | "after";

/** Action type for a guardrail rule. */
export type GuardrailAction =
  | "block"
  | "confirm"
  | "run"
  | "rewrite"
  | "error_block"
  | "error_confirm"
  | "error_run"
  | "error_rewrite";

/** A rewrite function that transforms a ToolResultEvent and returns a modified result. */
export type RewriteFn = (
  event: ToolResultEvent,
) => ToolResultEventResult | undefined;

/** Single input condition for a rule. */
export interface InputCondition {
  key: string;
  matcher: Matcher;
}

/** Rule that fires during tool_call (pre-execution or post-execution). */
export interface PreExecutionRule {
  toolName: string;
  inputConditions: InputCondition[];
  timing: Timing;
  action: "block" | "confirm" | "run";
  reason?: string;
  command?: string;
  /** Tokenizer function for this rule's grammar */
  tokenize?: (text: string) => string[][];
}

/** Rule that fires during tool_result (post-execution). */
export interface PostExecutionRule {
  toolName: string;
  inputConditions: InputCondition[];
  outputMatcher: Matcher | null;
  timing: Timing;
  action: GuardrailAction;
  reason?: string;
  command?: string;
  rewriteFn?: RewriteFn;
}

/** Rule that fires on tool_result events where isError is true. */
export interface ErrorRule {
  toolName: string;
  inputConditions: InputCondition[];
  outputMatcher: Matcher | null;
  timing: Timing;
  action: GuardrailAction;
  reason?: string;
  command?: string;
  rewriteFn?: RewriteFn;
}
