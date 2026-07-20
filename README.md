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

The builder chain exposes four typed interfaces:

| Builder | Methods |
|---------|---------|
| `ToolMatcherBuilder` (from `.tool(name)`) | `.input(key, matcher)`, `.output(matcher)`, `.error(matcher)` |
| `InputBuilder` (from `.input()`) | `.block(reason)`, `.confirm(reason)`, `.run(command)`, `.output(matcher)`, `.input(key, matcher)`, `.error(matcher)` |
| `PostExecutionActionBuilder` (from `.output()`) | `.block(reason)`, `.confirm(reason)`, `.run(command)`, `.rewrite(fn)`, `.input(key, matcher)` |
| `ErrorActionBuilder` (from `.error()`) | `.block(reason)`, `.confirm(reason)`, `.run(command)`, `.rewrite(fn)` |

The `.rewrite(fn)` method accepts a `RewriteFn`: `(event: ToolResultEvent) => ToolResultEventResult | undefined`.

### 3. Verify it loads

Run `pi` — if the directory exists under `~/.pi/agent/extensions/`, it auto-loads.

### 4. Toggle guardrails on/off

```
/guardrails off   # disable all rules
/guardrails on    # re-enable
```

Guardrails are enabled by default. The `/guardrails` command toggles the enabled/disabled state and persists it via the extension's config loader.

## Builder API

The callback receives a `GuardrailContext` with tokenizer-aware namespaces (`ctx.bash`, `ctx.nu`, `ctx.sql`) and combinator methods (`ctx.seq`, `ctx.contains`, etc.). Rules are defined via a fluent builder chain:

```
ctx.tool(name) → [.input(key, matcher)]* → pre-action | .output(matcher) → [.input(key, matcher)]* → post-action | .error(matcher) → action
```

Each `.tool(name)` call returns a `ToolMatcherBuilder` supporting three entry points:

- **Pre-execution**: Call `.input(key, matcher)` then `.block(reason)`, `.confirm(reason)`, or `.run(command)`. From the input builder, you can also call `.output(matcher)` to switch to post-execution, `.error(matcher)` to handle errors, or add more `.input()` calls.
- **Post-execution**: Call `.output(matcher)` to switch to post-execution mode, then `.block(reason)`, `.confirm(reason)`, `.run(command)`, or `.rewrite(fn)`. Post-execution builder supports additional `.input()` calls.
- **Error-capture**: Call `.error(matcher)` to handle tool errors, then `.block(reason)`, `.confirm(reason)`, `.run(command)`, or `.rewrite(fn)`.

Both `.output()` and `.error()` can be called directly on the tool builder (without `.input()`), matching all calls to that tool.

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

Pre-execution `.run()` displays the command as a reason but does not execute it.

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

Post-execution `.run()` supports `{key}` interpolation from the matched input values and appends the interpolated command as a guardrail message to the tool result content. It does not execute the command.

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

Use `.error()` to match on `tool_result` events where `isError` is `true`. The matcher operates on the result content text:

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

The `.error()` matcher matches against `event.content` text. Regex matchers test the full text; tokenized matchers (e.g., `ctx.seq(ctx.nu.word("Traceback"))`) tokenize with the tagged tokenizer. Error rules fire before post-execution rules — if an error rule matches and acts, the post-execution rules are skipped.

### Standalone evaluation

The `GuardrailContext` exposes three evaluation methods for programmatic use:

| Method | Description |
|--------|-------------|
| `ctx.matchCall(event)` | Evaluate pre-execution rules against a `ToolCallEvent`. Returns `ToolCallEventResult` or `undefined`. |
| `ctx.matchResult(event)` | Evaluate post-execution rules against a `ToolResultEvent`. Returns `ToolResultEventResult` or `undefined`. |
| `ctx.matchError(event)` | Evaluate error rules against a `ToolResultEvent` (only fires when `event.isError === true`). Returns `ToolResultEventResult` or `undefined`. |

These methods return `undefined` when no rule matches, allowing early bailouts.

### Event types

Tool events follow a consistent shape. Pre-execution receives `ToolCallEvent` with `toolName`, `toolCallId`, and `input` (keys vary by tool). Post-execution and error rules receive `ToolResultEvent` which adds `content: (TextContent | ImageContent)[]`, `isError: boolean`, and optional `details`.

| Tool | Input keys |
|------|----------|
| `bash` | `command: string` |
| `read` | `path: string` |
| `edit` | `path: string`, `oldText: string`, `newText: string` |
| `write` | `path: string`, `content: string` |
| `grep` | `pattern: string`, `path: string` |
| `find` | `path: string` |
| `ls` | `path: string` |
| custom | arbitrary `Record<string, unknown>` |

## Matcher Primitives

### Tokenizer namespaces

Each grammar tokenizer splits input into segments, then each segment into typed tokens. `word()` matchers operate on token values.

**`ctx.bash` — Bash/shell tokenization**

Uses `shell-quote` for proper shell parsing. Splits into segments on `||`, `&&`, `;`.

| Token type | Description | Example |
|------------|-------------|---------|
| `word` | Regular token | `rm`, `-rf`, `foo.txt`, `*` |
| `env` | Variable assignment (`KEY=value`) — stripped only from the **leading** position of a segment | `PATH=foo rm file` → segment starts with `rm` |
| `wrapper` | Command wrapper (`env`, `command`, `exec`, etc.) — stripped only from the **leading** position of a segment | `sudo rm file` → segment starts with `rm` |
| `operator` | Shell operator | `>`, `<`, `>>`, `&`, `!` |

- Quotes preserved: `'pattern with spaces'` → single token
- Glob characters `?` and `*` kept as single tokens

```ts
// Match rm -rf /path
ctx.seq(ctx.bash.word("rm"), ctx.bash.word("-rf"), ctx.bash.word("/path"))

// Match any git commit with --amend
ctx.contains(ctx.bash.word("--amend"))
```

**`ctx.nu` — Nushell tokenization**

Splits into segments on single pipe `|`. The `||` operator splits segments and emits an `operator` token. The `&&` operator splits segments but does NOT emit a token.

| Token type | Description | Example |
|------------|-------------|---------|
| `word` | Regular token | `ls`, `-R`, `foo` |
| `string` | Double-quoted, single-quoted, or backtick strings | `"hello"`, `'world'`, `` `raw` `` |
| `variable` | Variable references | `$in`, `$env.HOME`, `$var` |
| `operator` | Double pipe operator | `\|\|` |

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

Combinators compose matchers. The context exposes `seq`, `star`, `spread`, `contains`, and `anyOf`:

| Combinator | Description | Example |
|------------|-------------|---------|
| `seq(...)` | Sequence matchers in order, with backtracking for `star`/`spread` | `ctx.seq(ctx.bash.word("rm"), ctx.star())` |
| `star()` | Zero-width wildcard — always matches and consumes zero tokens; backtracking in `seq` tries all positions after it | `ctx.star()` |
| `spread()` | Backtracking wildcard — tries all positions before the next matcher | `ctx.seq(ctx.bash.word("dd"), ctx.spread(), ctx.bash.word("if="))` |
| `contains(...)` | Find the target sequence anywhere in the tokens. On match, consumes all tokens from the match point onward. | `ctx.contains(ctx.bash.word("rm"))` |
| `anyOf(...)` | Try each matcher in order; return the first match | `ctx.anyOf(ctx.bash.word("rm"), ctx.bash.word("unlink"))` |

Additional combinators (`repeat`, `repeat1`, `opt`, `exact`, `prefixed`) exist in `lib/matchers/combinators.ts` but are not exposed on the context. Use `seq` + `star`/`spread` as building blocks.

### Standalone matchers

| Matcher | Description | Example |
|---------|-------------|---------|
| `ctx.regex(re)` | Regex with RegExp literal | `ctx.regex(/^https:\/\//)` |
| `ctx.glob(pattern)` | Glob path matching (picomatch) | `ctx.glob("~/.config/**")` |
| `ctx.anyToken()` | Matches any single token | `ctx.anyToken()` |
| `ctx.path()` | Token starts with `/` | — not exposed on `ctx`; import `path` from `pi-guardrails/lib/matchers/primitives.js` |

**Note:** `word()` uses case-insensitive *exact* matching — `word("rm")` matches the token `rm` but does NOT match `form` or `armor`. Use `contains()` for search across tokens, or `regex()` for full pattern matching.

### Command matching examples

```ts
// "npm install lodash"
ctx.seq(ctx.bash.word("npm"), ctx.bash.word("install"), ctx.star())

// "dd if=/dev/zero of=/dev/sda bs=1M"
ctx.seq(ctx.bash.word("dd"), ctx.spread(), ctx.bash.word("if="))

// "sudo rm foo.txt"
ctx.seq(ctx.bash.word("sudo"), ctx.star())

// Any command containing "read_csv_auto"
ctx.contains(ctx.sql.word("read_csv_auto"))

// Commands starting with "git" — use seq + star
ctx.seq(ctx.bash.word("git"), ctx.star())

// Match any of several tools
ctx.seq(ctx.contains(ctx.bash.word("find", "fd", "grep", "rg")))
```

### File path matching examples

```ts
// Match edit/write to .git/ directory
ctx.tool("edit").input("path", ctx.regex(/^\.git\//))

// Match any lock file
ctx.tool("write").input("path", ctx.glob("{package-lock.json,bun.lockb,yarn.lock}"))

// Match files containing a pattern in content
ctx.tool("write").input("content", ctx.regex(/eslint-disable/))

// Glob options: picomatch with { matchBase: true, dot: true }
ctx.tool("write").input("path", ctx.glob("**/.*"))
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

## Standalone Handlers

The library provides standalone handler functions that operate on a `GuardrailContext` without requiring the extension lifecycle. These are useful for testing, custom integrations, or building custom tool wrappers.

These functions are not re-exported from the package's default entry but can be imported from their internal paths. For most use cases, use the `GuardrailContext.matchCall/matchResult/matchError` methods directly — they delegate to the same logic:

```ts
import { GuardrailContext } from "pi-guardrails/lib/builder/context.js";
import type { ToolCallEvent, ToolResultEvent } from "pi-guardrails/lib/builder/events.js";

const ctx = new GuardrailContext();
ctx.tool("bash").input("command", ctx.seq(ctx.bash.word("rm"), ctx.star())).block("Use trash");

// Evaluate a tool call
const result = ctx.matchCall({
  toolName: "bash",
  toolCallId: "abc",
  input: { command: "rm -rf /" },
});
```

```ts
// Internal — not part of the public API
import { handleToolCall, handleToolResult, handleToolError } from "pi-guardrails/lib/handlers.js";
import { GuardrailContext } from "pi-guardrails/lib/builder/context.js";
```

| Function | Description |
|----------|-------------|
| `handleToolCall(ctx, event)` | Evaluate pre-execution rules against a tool call event |
| `handleToolResult(ctx, event)` | Evaluate post-execution rules against a tool result event |
| `handleToolError(ctx, event)` | Evaluate error rules against a tool result event (only when `isError` is true) |
| `createHandler(ctx)` | Create a handler object with `handleCall`, `handleResult`, `handleError` |
| `composeContexts(...ctxs)` | Chain multiple contexts; first match wins |
| `withFallback(primary, fallback)` | Return primary result or fallback value |

---

## Tokenizers

The library includes three grammar-aware tokenizers that split command strings into typed tokens organized by segment.

| Tokenizer | Segment splitters | Token types |
|-----------|-------------------|-------------|
| `tokenizeBash` | `\|\|`, `&&`, `;` | `word`, `env`, `wrapper`, `operator` |
| `tokenizeSql` | none (single segment) | `word`, `string`, `identifier`, `rawstring`, `operator`, `paren` |
| `tokenizeNushell` | single `\|` | `word`, `string`, `variable`, `operator` |

The bash tokenizer uses `shell-quote` for proper shell parsing and normalizes segments by stripping leading `env`/`wrapper` tokens. The nushell tokenizer handles double-quoted strings (backslash escapes), single-quoted literal strings (`''` escape), backtick strings, and `$variable` references.
