# Pi Guardrails

Library for building guardrails in the PI coding agent. Import `guardrails`, pass a builder callback, and get a configured extension.

## Usage

### 1. Create your guardrails extension

```bash
mkdir ~/.pi/agent/extensions/my-guardrails/
cd ~/.pi/agent/extensions/my-guardrails/
bun add knoopx/pi-guardrails
```

### 2. Write your rules in `~/.pi/agent/extensions/my-guardrails/index.ts`

```ts
import guardrails from "pi-guardrails";

export default guardrails((ctx) => {
  ctx.tool("bash")
    .input("command", ctx.seq(ctx.bash.word("rm"), ctx.star()))
    .block("Use trash instead of rm");
});
```

Each rule: `ctx.tool("toolName").input(key, matcher).action("reason")`

### 3. Verify it loads

Run `pi` — if the directory exists under `~/.pi/agent/extensions/`, it auto-loads.

### 4. Toggle guardrails on/off

```
/guardrails off   # disable all rules
/guardrails on    # re-enable
```

Or in code:
```ts
import { configLoader } from "pi-guardrails";
configLoader.enabled = false;
await configLoader.save();
```

## Builder API

The callback receives a `GuardrailContext` with tokenizer-aware namespaces (`ctx.bash`, `ctx.nu`, `ctx.sql`) and combinators (`ctx.seq`, `ctx.contains`, etc.). Rules are defined via a fluent builder chain:

```
ctx → .tool(name) → .input(key, matcher) → [action | .output(matcher) | .error(matcher)]
```

### Pre-execution actions (before a tool runs)

Call `.block()`, `.confirm()`, or `.run()` to act on the tool call:

```ts
ctx.tool("bash")
  .input("command", ctx.seq(ctx.bash.word("dd"), ctx.star()))
  .block("Use disk management tools, not dd");
```

```ts
ctx.tool("bash")
  .input("command", ctx.seq(ctx.bash.word("sudo"), ctx.star()))
  .confirm("Elevated privileges needed?");
```

```ts
ctx.tool("bash")
  .input("command", ctx.seq(ctx.bash.word("bun"), ctx.bash.word("add"), ctx.bash.word("-g"), ctx.star()))
  .run("echo 'Global install blocked!'");
```

`.run()` executes a shell command (conceptually). The original call is blocked. Commands support `{key}` interpolation from matched input values.

### Post-execution actions (after a tool returns)

Use `.output()` to switch to post-execution mode, then call `.block()`, `.confirm()`, `.run()`, or `.rewrite()`:

```ts
ctx.tool("bash")
  .input("command", ctx.seq(ctx.bash.word("rm"), ctx.star()))
  .output(ctx.regex(/~/))
  .block("Result contains ~ — should expand to full path");
```

```ts
ctx.tool("bash")
  .input("command", ctx.seq(ctx.bash.word("rm"), ctx.star()))
  .output(ctx.regex(/~/))
  .rewrite((event) => ({
    content: event.content?.map(c =>
      c.type === "text" ? { ...c, text: c.text.replace(/~/g, "/home/user") } : c
    ),
  }));
```

### Multiple input conditions

Chain `.input()` calls — all conditions must match:

```ts
ctx.tool("write")
  .input("path", ctx.glob("**/.env*"))
  .input("content", ctx.regex(/API_KEY/))
  .block("No API keys in env files");
```

### Post-execution with output + input conditions

Combine `.output()` and `.input()` to guard on both the tool's input and its result:

```ts
ctx.tool("bash")
  .input("command", ctx.seq(ctx.bash.word("rm"), ctx.star()))
  .input("file", ctx.bash.word("DELETE_ME"))
  .output(ctx.regex(/~/))
  .block("Result contains ~ — should expand to full path");
```

### Error-capture actions (on tool errors)

Use `.error()` to match on `tool_result` events where `isError` is `true`. The matcher operates on the result content text (same as `.output()`):

```ts
ctx.tool("bash")
  .error(ctx.regex(/segfault|core dump|signal 11/i))
  .block("Tool crashed with a segfault");
```

```ts
ctx.tool("python-eval")
  .error(ctx.seq(ctx.nu.word("Traceback")))
  .rewrite((event) => ({
    content: event.content?.map(c =>
      c.type === "text" ? { ...c, text: c.text + "\n\n💡 Check your variable types" } : c
    ),
  }));
```

```ts
ctx.tool("bash")
  .error(ctx.regex(/permission denied/i))
  .confirm("Permission error — was this expected?");
```

```ts
ctx.tool("write")
  .error(ctx.anyToken())
  .run("echo 'Write failed — check file permissions'");
```

Chain: `ctx.tool(name) → .error(matcher) → [action]`

The `.error()` matcher matches against `event.content` text, tokenized with the default bash tokenizer. Error rules fire before post-execution rules — if an error rule matches and acts, the post-execution rules are skipped.

## RewriteBuilder

`ctx.rewrite` provides a fluent builder for transforming `tool_result` content:

```ts
ctx.tool("bash")
  .input("command", ctx.seq(ctx.bash.word("rm"), ctx.star()))
  .output(ctx.regex(/password/))
  .rewrite((event) => {
    return ctx.rewrite
      .text((text) => text.replace(/password/gi, "***"))
      .reason("Redacted secrets")
      .apply(event);
  });
```

| Method | Description |
|--------|-------------|
| `.text(fn)` | Transform all text content with `(text: string) => string` |
| `.content(fn)` | Transform specific content items by `(index, content) => content` |
| `.block(value)` | Set the block flag |
| `.reason(value)` | Set a reason string |
| `.details(value)` | Set result details |
| `.apply(event)` | Apply all transforms and return `ToolResultEventResult | undefined` |

## Matcher Primitives

### Tokenizer namespaces

Each grammar tokenizer splits input into segments, then each segment into typed tokens. `word()` matchers operate on token values.

**`ctx.bash` — Bash/shell tokenization**

Uses `shell-quote` for proper shell parsing. Splits into segments on `||`, `&&`, `;`.

| Token type | Description | Example |
|------------|-------------|---------|
| `word` | Regular token | `rm`, `-rf`, `foo.txt`, `*` |
| `env` | Variable assignment (stripped) | `PATH=foo` → stripped as env |
| `wrapper` | Command wrapper (stripped) | `env`, `command`, `exec`, `nohup`, `nice`, `time` |
| `operator` | Shell operator | `>`, `<`, `>>`, `&`, `!` |
| `paren` | Parenthesis | `(`, `)` |

- Quotes preserved: `'pattern with spaces'` → single token
- Glob characters `?` and `*` kept as single tokens

```ts
// Match rm -rf /path
ctx.seq(ctx.bash.word("rm"), ctx.bash.word("-rf"), ctx.bash.word("/path"))

// Match any git commit with --amend
ctx.contains(ctx.bash.word("--amend"))
```

**`ctx.nu` — Nushell tokenization**

Splits into segments on single pipe `|`. Operators like `||`, `&&`, `;;` split segments but remain as tokens.

| Token type | Description | Example |
|------------|-------------|---------|
| `word` | Regular token | `ls`, `-R`, `foo` |
| `string` | Double-quoted, single-quoted, or backtick strings | `"hello"`, `'world'`, `` `raw` `` |
| `variable` | Variable references | `$in`, `$env.HOME`, `$var` |
| `operator` | Pipe (double) or other operators | `\|\|`, `&&`, `;;` |
| `paren` | Parenthesis | `(`, `)` |

```ts
// Match nushell ls -R
ctx.contains(ctx.nu.word("ls"), ctx.nu.word("-R"))

// Match str replace --pattern
ctx.contains(ctx.nu.word("str"), ctx.nu.word("replace"), ctx.nu.word("--pattern"))
```

**`ctx.sql` — SQL tokenization**

Single segment (no splitting). Splits on SQL grammar with quote handling.

| Token type | Description | Example |
|------------|-------------|---------|
| `word` | Identifiers, numbers, and unclassified tokens | `SELECT`, `42`, `read_csv_auto`, `*` |
| `string` | Single-quoted strings | `'hello'` |
| `identifier` | Double-quoted identifiers | `"my_table"` |
| `rawstring` | Raw strings (r'...') | `r'\n\t'` |
| `operator` | Single-char operators | `(`, `,`, `;`, `=`, `:`, `<`, `>`, `!` |
| `paren` | Closing parenthesis | `)` |

```ts
// Match read_csv_auto anywhere in SQL
ctx.contains(ctx.sql.word("read_csv_auto"))

// Match CASE WHEN type mismatch
ctx.contains(ctx.sql.word("CASE"), ctx.sql.word("THEN"), ctx.sql.word("0"))
```

### Combinators

Combinators live on `ctx` and compose matchers:

| Combinator | Description | Example |
|------------|-------------|---------|
| `seq(...)` | Sequence matchers in order | `ctx.seq(ctx.bash.word("rm"), ctx.star())` |
| `anyOf(...)` | Match any one | `ctx.anyOf(ctx.bash.word("block"), ctx.bash.word("confirm"))` |
| `star()` | Always matches, consumes all remaining | `ctx.star()` |
| `spread()` | Backtracking wildcard (greedy) | `ctx.seq(ctx.bash.word("dd"), ctx.spread(), ctx.bash.word("if="), ctx.star())` |
| `contains(...)` | Match appears anywhere in tokens | `ctx.contains(ctx.bash.word("rm"))` |
| `repeat(m)` | Zero-or-more of matcher `m` | `ctx.repeat(ctx.bash.word("foo"))` |
| `repeat1(m)` | One-or-more of matcher `m` | `ctx.repeat1(ctx.bash.word("foo"))` |
| `opt(m)` | Optional (0 or 1) | `ctx.opt(ctx.bash.word("--verbose"))` |
| `exact(n)` | Exactly N tokens | `ctx.exact(2)` |
| `prefixed(prefix)` | Token must start with prefix | `ctx.prefixed("--")` |

### Standalone matchers

| Matcher | Description | Example |
|---------|-------------|---------|
| `ctx.regex(re)` | Regex with RegExp literal | `ctx.regex(/^https:\/\//)` |
| `ctx.glob(pattern)` | Glob path matching (picomatch) | `ctx.glob("~/.config/**")` |
| `ctx.anyToken()` | Matches any single token | `ctx.anyToken()` |
| `ctx.path()` | Token starts with `/` | `ctx.path()` |

**Note:** `word()` uses case-insensitive *exact* matching — `word("rm")` matches the token `rm` but does NOT match `form` or `armor`. Use `contains()` for substring-like search across tokens, or `regex()` for full pattern matching.

### Command matching examples

```ts
// "npm install lodash"
ctx.seq(ctx.bash.word("npm"), ctx.bash.word("install"))

// "dd if=/dev/zero of=/dev/sda bs=1M"
ctx.seq(ctx.bash.word("dd"), ctx.spread(), ctx.bash.word("if="))

// "sudo rm foo.txt"
ctx.seq(ctx.bash.word("sudo"), ctx.star())

// Any command containing "read_csv_auto"
ctx.contains(ctx.sql.word("read_csv_auto"))

// Commands starting with "git" (prefixed: exact match on first word)
ctx.prefixed("git")
```

### File path matching examples

```ts
// Match edit/write to .git/ directory
ctx.tool("edit").input("path", ctx.regex(/^\.git\//))

// Match any lock file
ctx.tool("write").input("path", ctx.glob("{package-lock.json,bun.lockb,yarn.lock}"))

// Match files containing a pattern in content
ctx.tool("write").input("content", ctx.regex(/eslint-disable/))
```

## Extension Registration

The guardrails system integrates with the PI coding agent via `tool_call` and `tool_result` event hooks. The builder callback receives a `GuardrailContext` typed automatically:

```ts
import guardrails from "pi-guardrails";

export default guardrails((ctx) => {
  // Define rules here
  ctx.tool("bash")
    .input("command", ctx.seq(ctx.bash.word("rm"), ctx.star()))
    .block("Use trash instead of rm");
});
```

The extension auto-loads guardrails settings (enabled/disabled state) on startup and registers the `/guardrails [on\|off]` command.

---

## Standalone Functions

All guardrail checks can be executed outside of the extension context via standalone handler functions. These are useful for testing, custom integrations, or building custom tool wrappers.

### Handler Functions

```ts
import {
  handleToolCall,
  handleToolResult,
  handleToolError,
  createHandler,
  composeContexts,
  withFallback,
  type GuardrailContext,
} from "pi-guardrails";
```

| Function | Signature | Description |
|----------|-----------|-------------|
| `handleToolCall` | `(ctx: GuardrailContext, event: ToolCallEvent) => ToolCallEventResult \| undefined` | Evaluate pre-execution rules against a tool call event |
| `handleToolResult` | `(ctx: GuardrailContext, event: ToolResultEvent) => ToolResultEventResult \| undefined` | Evaluate post-execution rules against a tool result event |
| `handleToolError` | `(ctx: GuardrailContext, event: ToolResultEvent) => ToolResultEventResult \| undefined` | Evaluate error rules against a tool result event (only when isError is true) |
| `createHandler` | `(ctx: GuardrailContext) => { handleCall, handleResult, handleError }` | Create a handler object for call, result, and error events |
| `composeContexts` | `(...ctxs: GuardrailContext[]) => { handleCall, handleResult, handleError }` | Chain multiple contexts; first match wins |
| `withFallback` | `<T>(primary: () => T \| undefined, fallback: T) => T` | Return primary result or fallback value |

**Example — standalone handler:**

```ts
import { createHandler, GuardrailContext } from "pi-guardrails";

const ctx = new GuardrailContext();
// Define rules...
ctx.tool("bash").input("command", ctx.bash.word("rm")).block("No rm");

const handler = createHandler(ctx);

// Later, evaluate an event:
const result = handler.handleCall({ toolName: "bash", toolCallId: "1", input: { command: "rm foo.txt" } });
// { block: true, reason: "No rm" }
```

**Example — composing contexts:**

```ts
import { composeContexts, GuardrailContext } from "pi-guardrails";

const ctx1 = new GuardrailContext();
ctx1.tool("bash").input("command", ctx1.bash.word("rm")).block("No rm");

const ctx2 = new GuardrailContext();
ctx2.tool("bash").input("command", ctx2.bash.word("sudo")).block("No sudo");

const composed = composeContexts(ctx1, ctx2);
// Any bash call with "rm" or "sudo" will be blocked
```

**Example — error handler:**

```ts
import { handleToolError, GuardrailContext } from "pi-guardrails";

const ctx = new GuardrailContext();
ctx.tool("bash").error(ctx.regex(/segfault|core dump/i)).block("Tool crashed");

// Evaluate an error event:
const result = handleToolError(ctx, {
  toolName: "bash",
  toolCallId: "1",
  input: { command: "./crashy_program" },
  content: [{ type: "text", text: "Segmentation fault (core dumped)" }],
  isError: true,
});
// { block: true, reason: "Tool crashed" }
```

### Config Loader

```ts
import { configLoader, type GuardrailsConfigLoader } from "pi-guardrails";
```

| Member | Type | Description |
|--------|------|-------------|
| `configLoader` | `GuardrailsConfigLoader` | Singleton instance, auto-loaded by the extension |
| `configLoader.enabled` | `boolean` (getter/setter) | Toggle guardrails on/off |
| `configLoader.load()` | `Promise<void>` | Load persisted settings |
| `configLoader.save()` | `Promise<void>` | Persist settings |

```ts
import { configLoader } from "pi-guardrails";

// Check current state
console.log(configLoader.enabled); // true

// Toggle
configLoader.enabled = false;
await configLoader.save();
```

The `/guardrails on` and `/guardrails off` commands registered by the extension use `configLoader` under the hood via `createGuardrailsHandler`.

---

## Pattern Utilities

Convenience functions for matching commands and files using a compact pattern syntax without writing full matcher chains.

```ts
import {
  parsePattern,
  matchCommandPattern,
  matchFileNamePattern,
  matchContentPattern,
} from "pi-guardrails";
```

### `parsePattern(pattern: string): PatternToken[]`

Parses a compact command pattern string into an array of `PatternToken` objects. The pattern syntax supports:

| Token | Meaning | Example |
|-------|---------|---------|
| `*` (spread) | Zero or more tokens | `dd * if=*` matches `dd if=/dev/zero of=/dev/sda` |
| `?` (single) | Exactly one token | `dd ? of=*` matches `dd if=/dev/zero of=/dev/sda` |
| `literal` | Exact token match | `git commit` → matches `["git", "commit"]` |
| `{a, b, c}` (or) | Match any of | `npm {install, i}` matches `npm install` or `npm i` |

```ts
const tokens = parsePattern("{npm, npx} {install, i} lodash");
// [{ kind: "or", options: [["npm"], ["npx"]], [{ kind: "or", options: [["install"], ["i"]]], { kind: "literal", value: "lodash" }]
```

### `matchCommandPattern(command: string, pattern: string): boolean`

Tokenizes the command with the Bash tokenizer and checks if it matches the parsed pattern.

```ts
matchCommandPattern("dd if=/dev/zero of=/dev/sda bs=1M", "dd * if=");
// true

matchCommandPattern("sudo rm -rf /", "{sudo,}, rm *");
// true
```

### `matchFileNamePattern(filePath: string, pattern: string): boolean`

Matches a file path against a glob pattern (via picomatch). Uses the basename for simple patterns and full path for patterns containing `/` or `\`.

```ts
matchFileNamePattern("/home/user/.env", "*.env");
// true

matchFileNamePattern("/home/user/.config/app/.env", "**/.env*");
// true
```

### `matchContentPattern(content: string, pattern: string): boolean`

Checks if any alternative (pipe-separated) substring exists in the content.

```ts
matchContentPattern("API_KEY=abc123\nDB_HOST=localhost", "API_KEY|DB_PASS");
// true

matchContentPattern("hello world", "API_KEY|DB_PASS");
// false
```

---

## Event Types

The library defines strongly-typed event interfaces for all supported tool calls and results. Import these for standalone handlers, custom integrations, or testing.

```ts
import {
  type ToolCallEvent,
  type ToolResultEvent,
  type ToolCallEventResult,
  type ToolResultEventResult,
  type TextContent,
  type ImageContent,
} from "pi-guardrails";
```

### Tool Call Events

| Type | `toolName` | `input` shape | Description |
|------|------------|---------------|-------------|
| `BashToolCallEvent` | `"bash"` | `{ command: string }` | Shell command execution |
| `ReadToolCallEvent` | `"read"` | `{ path: string }` | Read file contents |
| `EditToolCallEvent` | `"edit"` | `{ path, oldText, newText }` | Edit file in place |
| `WriteToolCallEvent` | `"write"` | `{ path, content }` | Write/overwrite file |
| `GrepToolCallEvent` | `"grep"` | `{ pattern, path }` | Search files for content |
| `FindToolCallEvent` | `"find"` | `{ path }` | Find files by path |
| `LsToolCallEvent` | `"ls"` | `{ path }` | List directory contents |
| `CustomToolCallEvent` | `string` | `Record<string, unknown>` | Any other tool |

**Union type:**

```ts
type ToolCallEvent =
  | BashToolCallEvent
  | ReadToolCallEvent
  | EditToolCallEvent
  | WriteToolCallEvent
  | GrepToolCallEvent
  | FindToolCallEvent
  | LsToolCallEvent
  | CustomToolCallEvent;
```

### Tool Result Events

All result events share a common base:

```ts
interface ToolResultEventBase {
  type: "tool_result";
  toolCallId: string;
  input: Record<string, unknown>;
  content: (TextContent | ImageContent)[];
  isError: boolean;
}
```

| Type | `toolName` | `details` shape | Description |
|------|------------|-----------------|-------------|
| `BashToolResultEvent` | `"bash"` | `{ stdout, stderr, exitCode } \| undefined` | Command output |
| `ReadToolResultEvent` | `"read"` | `{ path } \| undefined` | File read result |
| `EditToolResultEvent` | `"edit"` | `{ path } \| undefined` | Edit result |
| `WriteToolResultEvent` | `"write"` | `undefined` | Write result |
| `GrepToolResultEvent` | `"grep"` | `{ matches: number } \| undefined` | Match count |
| `FindToolResultEvent` | `"find"` | `{ matches: number } \| undefined` | Match count |
| `LsToolResultEvent` | `"ls"` | `{ files: string[] } \| undefined` | File list |
| `CustomToolResultEvent` | `string` | `unknown` | Generic result |

**Union type:**

```ts
type ToolResultEvent =
  | BashToolResultEvent
  | ReadToolResultEvent
  | EditToolResultEvent
  | WriteToolResultEvent
  | GrepToolResultEvent
  | FindToolResultEvent
  | LsToolResultEvent
  | CustomToolResultEvent;
```

### Event Result Types

```ts
interface ToolCallEventResult {
  block?: boolean;
  reason?: string;
}

interface ToolResultEventResult {
  content?: (TextContent | ImageContent)[];
  details?: unknown;
  block?: boolean;
  reason?: string;
}
```

When `block: true`, the tool call or result is prevented from proceeding. The `reason` field is displayed to the user. For `ToolResultEventResult`, returning modified `content` transforms the result.

---

## Rule Types

Underlying types for guardrail rule definitions. Useful for programmatic rule creation, testing, and custom rule builders.

```ts
import type {
  Timing,
  GuardrailAction,
  RewriteFn,
  InputCondition,
  PreExecutionRule,
  PostExecutionRule,
  ErrorRule,
} from "pi-guardrails";
```

### `Timing`

```ts
type Timing = "before" | "after";
```

- `"before"` — Rule fires on `tool_call` event (pre-execution)
- `"after"` — Rule fires on `tool_result` event (post-execution)

### `GuardrailAction`

```ts
type GuardrailAction = "block" | "confirm" | "run" | "rewrite" | "error_block" | "error_confirm" | "error_run" | "error_rewrite";
```

| Action | Behavior |
|--------|----------|
| `"block"` | Prevent the tool from running or proceeding |
| `"confirm"` | Require user confirmation before proceeding |
| `"run"` | Execute a shell command (with `{key}` interpolation) |
| `"rewrite"` | Transform the tool result content |
| `"error_block"` | Block the tool result when `isError` is true |
| `"error_confirm"` | Require confirmation when `isError` is true |
| `"error_run"` | Execute a shell command when `isError` is true |
| `"error_rewrite"` | Transform error result content |

### `RewriteFn`

```ts
type RewriteFn = (event: ToolResultEvent) => ToolResultEventResult | undefined;
```

A function that receives a `ToolResultEvent` and returns a modified `ToolResultEventResult`, or `undefined` to pass through unchanged. Example:

```ts
const rewriteFn: RewriteFn = (event) => ({
  content: event.content?.map(c =>
    c.type === "text" ? { ...c, text: c.text.replace(/password/gi, "***") } : c
  ),
});
```

### `InputCondition`

```ts
interface InputCondition {
  key: string;       // Input field name: "command", "path", "content", etc.
  matcher: Matcher;  // A Matcher that validates the field value
}
```

Multiple conditions are AND-ed — all must match for the rule to trigger.

### `PreExecutionRule`

```ts
interface PreExecutionRule {
  toolName: string;
  inputConditions: InputCondition[];
  timing: "before";
  action: "block" | "confirm" | "run";
  reason?: string;
  command?: string;
  tokenize?: (text: string) => string[][];
}
```

### `PostExecutionRule`

```ts
interface PostExecutionRule {
  toolName: string;
  inputConditions: InputCondition[];
  outputMatcher: Matcher | null;
  timing: "after";
  action: GuardrailAction;
  reason?: string;
  command?: string;
  rewriteFn?: RewriteFn;
}
```

### `ErrorRule`

```ts
interface ErrorRule {
  toolName: string;
  inputConditions: InputCondition[];
  outputMatcher: Matcher | null;
  action: GuardrailAction;
  reason?: string;
  command?: string;
  rewriteFn?: RewriteFn;
}
```

`ErrorRule` fires on `tool_result` events where `isError` is `true`. It matches against `event.content` text using the same pattern as `PostExecutionRule.outputMatcher`. Error rules execute before post-execution rules — if an error rule matches and acts, post-execution rules are skipped.

### RewriteBuilder — Two Distinct Interfaces

The library exports two different `RewriteBuilder` interfaces with different purposes:

**1. `RewriteBuilder` from `lib/builder/rules.ts`** — Used with `.rewrite((event) => ...)` callbacks in post-execution rules. This is a fluent builder for transforming `ToolResultEventResult` properties:

```ts
ctx.tool("bash")
  .output(ctx.regex(/password/))
  .rewrite((event) => {
    return ctx.rewrite          // ← Guards' internal RewriteBuilder (from builders.ts)
      .text((text) => text.replace(/password/gi, "***"))
      .reason("Redacted secrets")
      .apply(event);            // ← Returns ToolResultEventResult
  });
```

**2. `RewriteBuilder` from `lib/builder/builders.ts`** — Returned by `ctx.rewrite`. This interface provides field-specific rewrite function registration:

| Method | Purpose |
|--------|---------|
| `.command(fn)` | Rewrite the command input field |
| `.output(fn)` | Rewrite the output/result field |
| `.file_path(fn)` | Rewrite file path references |
| `.path(fn)` | Rewrite path references |

The rules.ts `RewriteBuilder` (used internally by the `.text()`, `.content()`, `.block()`, `.reason()`, `.details()`, `.apply()` chain in examples above) and the builders.ts `RewriteBuilder` (used by `ctx.rewrite` with `.command()`, `.output()`, `.file_path()`, `.path()`) serve different abstraction layers — the former transforms `ToolResultEventResult` objects directly, while the latter registers transform functions keyed by input/output field name.

---

## Tokenizers

Standalone tokenizer functions are exported for direct use. They split command strings into typed tokens organized by segment (shell segments are split on `\|\|`, `&&`, `;`).

```ts
import {
  tokenizeBash,
  tokenizeSql,
  tokenizeNushell,
  type Token,
  type Tokenizer,
} from "pi-guardrails";
```

### `tokenizeBash(command: string): Token[][]`

Uses `shell-quote` for proper shell parsing. Splits into segments on `\|\|`, `&&`, `;`. Token types: `word`, `env`, `wrapper`, `operator`, `paren`.

```ts
tokenizeBash("rm -rf /tmp && sudo dd if=/dev/zero")
// [
//   [{ type: "word", value: "rm" }, { type: "word", value: "-rf" }, { type: "word", value: "/tmp" }],
//   [{ type: "word", value: "sudo" }, { type: "word", value: "dd" }, ...],
// ]
```

### `tokenizeSql(command: string): Token[][]`

Single segment (no splitting on operators). Token types: `word`, `string`, `identifier`, `rawstring`, `operator`, `paren`.

```ts
tokenizeSql('SELECT * FROM "my_table" WHERE id = 42')
// [[{ type: "word", value: "SELECT" }, { type: "word", value: "*" }, ...]]
```

### `tokenizeNushell(command: string): Token[][]`

Splits on single pipe `\|`. Operators `\|\|`, `&&`, `;;` remain as tokens. Token types: `word`, `string`, `variable`, `operator`, `paren`.

```ts
tokenizeNushell('ls -R | where size > 1MB | str replace tmp /temp')
// [
//   [{ type: "word", value: "ls" }, { type: "word", value: "-R" }],
//   [{ type: "word", value: "where" }, ...],
//   [{ type: "word", value: "str" }, ...],
// ]
```

### `Token` and `Tokenizer` types

```ts
type Token = {
  type: string;   // e.g., "word", "string", "operator"
  value: string;  // The matched text
};

type Tokenizer = (text: string) => Token[][];
```

---

## Matcher Types

Low-level types used by matchers and rule definitions.

```ts
import type {
  Matcher,
  MatchResult,
} from "pi-guardrails";
```

### `Matcher`

```ts
type Matcher = {
  tryMatch: (tokens: Token[], from: number) => { ok: boolean; consumed?: number };
  match: (tokens: Token[]) => boolean;
  __star?: true;     // Marker for backtracking star
  __spread?: true;   // Marker for backtracking spread
  __repeat?: true;   // Marker for repeat combinator
  __tokenizer?: Tokenizer;  // Tokenizer function (set by ctx.bash/ctx.nu/ctx.sql)
};
```

- `match(tokens)` — Returns `true` if the matcher consumes all tokens.
- `tryMatch(tokens, from)` — Attempts to match starting at index `from`, returns `{ ok, consumed }`.

### `MatchResult`

```ts
type MatchResult =
  | { ok: false; consumed?: number }
  | { ok: true; consumed: number };
```

Return type of `tryMatch` — indicates whether the matcher succeeded and how many tokens it consumed.
