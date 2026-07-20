import type { Matcher } from "../matchers/types.js";
import type { ToolResultEvent, ToolResultEventResult, TextContent, ImageContent } from "./events.js";

/** Timing of when a rule fires. */
export type Timing = "before" | "after";

/** Action type for a guardrail rule. */
export type GuardrailAction = "block" | "confirm" | "run" | "rewrite";

/** A rewrite function that transforms a ToolResultEvent and returns a modified result. */
export type RewriteFn = (event: ToolResultEvent) => ToolResultEventResult | undefined;

/** Builder for rewriting PI ToolResultEventResult properties. */
export interface RewriteBuilder {
  /** Transform all text content. */
  text(fn: (text: string) => string): RewriteBuilder;
  /** Transform a specific content index. */
  content(fn: (index: number, content: TextContent | ImageContent) => TextContent | ImageContent): RewriteBuilder;
  /** Set block flag. */
  block(value: boolean): RewriteBuilder;
  /** Set reason string. */
  reason(value: string): RewriteBuilder;
  /** Set details. */
  details(value: unknown): RewriteBuilder;
  /** Execute the rewrite against an event, returning the modified result or undefined. */
  apply(event: ToolResultEvent): ToolResultEventResult | undefined;
}

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
