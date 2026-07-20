export interface TextContent {
  type: "text";
  text: string;
}

export interface ImageContent {
  type: "image";
  data: string;
  mimeType: string;
}

export interface BashToolCallEvent {
  toolName: "bash";
  toolCallId: string;
  input: { command: string };
}

export interface ReadToolCallEvent {
  toolName: "read";
  toolCallId: string;
  input: { path: string };
}

export interface EditToolCallEvent {
  toolName: "edit";
  toolCallId: string;
  input: { path: string; oldText: string; newText: string };
}

export interface WriteToolCallEvent {
  toolName: "write";
  toolCallId: string;
  input: { path: string; content: string };
}

export interface GrepToolCallEvent {
  toolName: "grep";
  toolCallId: string;
  input: { pattern: string; path: string };
}

export interface FindToolCallEvent {
  toolName: "find";
  toolCallId: string;
  input: { path: string };
}

export interface LsToolCallEvent {
  toolName: "ls";
  toolCallId: string;
  input: { path: string };
}

export interface CustomToolCallEvent {
  toolName: string;
  toolCallId: string;
  input: Record<string, unknown>;
}

export type ToolCallEvent =
  | BashToolCallEvent
  | ReadToolCallEvent
  | EditToolCallEvent
  | WriteToolCallEvent
  | GrepToolCallEvent
  | FindToolCallEvent
  | LsToolCallEvent
  | CustomToolCallEvent;

// ── Tool Result Events ────────────────────────────────────────────────────────

export interface ToolResultEventBase {
  type: "tool_result";
  toolCallId: string;
  input: Record<string, unknown>;
  content: (TextContent | ImageContent)[];
  isError: boolean;
}

export interface BashToolResultEvent extends ToolResultEventBase {
  toolName: "bash";
  details: { stdout: string; stderr: string; exitCode: number } | undefined;
}

export interface ReadToolResultEvent extends ToolResultEventBase {
  toolName: "read";
  details: { path: string } | undefined;
}

export interface EditToolResultEvent extends ToolResultEventBase {
  toolName: "edit";
  details: { path: string } | undefined;
}

export interface WriteToolResultEvent extends ToolResultEventBase {
  toolName: "write";
  details: undefined;
}

export interface GrepToolResultEvent extends ToolResultEventBase {
  toolName: "grep";
  details: { matches: number } | undefined;
}

export interface FindToolResultEvent extends ToolResultEventBase {
  toolName: "find";
  details: { matches: number } | undefined;
}

export interface LsToolResultEvent extends ToolResultEventBase {
  toolName: "ls";
  details: { files: string[] } | undefined;
}

export interface CustomToolResultEvent extends ToolResultEventBase {
  toolName: string;
  details: unknown;
}

export type ToolResultEvent =
  | BashToolResultEvent
  | ReadToolResultEvent
  | EditToolResultEvent
  | WriteToolResultEvent
  | GrepToolResultEvent
  | FindToolResultEvent
  | LsToolResultEvent
  | CustomToolResultEvent;

// ── Event Result Types ────────────────────────────────────────────────────────

export interface ToolCallEventResult {
  block?: boolean;
  reason?: string;
}

export interface ToolResultEventResult {
  content?: (TextContent | ImageContent)[];
  details?: unknown;
  block?: boolean;
  reason?: string;
}
