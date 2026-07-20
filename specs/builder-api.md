---
name: builder-api
topic: Guardrails Fluent Builder API
description: "Replace static GuardrailsGroup config with a fluent builder pattern that matches PI coding agent tool_call and tool_result event hooks."
keywords: [guardrails, builder, fluent, tool_call, tool_result, block, confirm, run, rewrite, before, after]
category: Extension
subcategory: Guardrails
---

# Guardrails Fluent Builder API

## Problem

The current guardrail system uses static TypeScript config objects (`GuardrailsGroup` arrays) that are:

- Hard to read: nested objects with `matcher`, `pattern`, `file_pattern`, `includes`, `excludes`
- Hard to maintain: no visual connection between the rule and what it matches
- Limited to three contexts: `command`, `file_name`, `file_content`
- Cannot express post-execution actions (output rewriting, command chaining)
- Cannot express before/after timing

The PI coding agent has a rich event system:

- **`tool_call`** fires before execution with `{ toolCallId, toolName, input }`. Handler can return `{ block: true, reason }` to block the call.
- **`tool_result`** fires after execution with `{ toolCallId, toolName, input, content, isError }`. Handler can modify `content`, `details`, `isError`.

The new API must map directly to these event structures with a fluent, composable builder pattern.

## API

```javascript
// ctx is the guardrail builder context
// ctx.bash provides bash-tokenized matchers
// ctx.rewrite provides output transformation functions

// Pre-execution: block
ctx.tool("edit").input("path", ctx.bash.word("/.git/")).block("Use git commands, not direct VCS edits")

// Pre-execution: confirm
ctx.tool("bash").input("command", ctx.bash.word("rm")).confirm("Really delete? Use trash instead")

// Post-execution: rewrite output
ctx.tool("bash").output(ctx.contains(ctx.regex(/password|secret/i))).rewrite(ctx.rewrite.replace(/password/gi, "***"))

// Before tool executes: run command, block on failure
ctx.tool("edit").input("path", ctx.glob("*.{js,ts}")).before.run("bunx eslint {path}")

// After tool executes: run command, append output
ctx.tool("edit").input("path", ctx.glob("*.{js,ts}")).after.run("bunx prettier --write {path}")

// Multiple input conditions
ctx.tool("write").input("path", ctx.bash.word("~/.config/")).input("content", ctx.contains(ctx.regex(/SECRET/i))).block("No secrets in config")

// Chain multiple actions
ctx.tool("bash").input("command", ctx.bash.word("rm")).before.run("echo 'WARNING: rm'").block("Use trash instead")
```

## Builder Chain Structure

```
ctx → .tool(name) → .input(key, matcher) → .before|.after → .run|.block|.confirm|.rewrite
```

- **`ctx.tool(name)`** — scope to a specific tool by name. Returns `ToolMatcherBuilder`.
- **`.input(key, matcher)`** — add a condition on a specific input key. Returns `ActionBuilder` (or `ToolMatcherBuilder` for chaining additional `.input()` calls).
- **`.output(matcher)`** — add a condition on the tool's output content. Returns `ActionBuilder`.
- **`.before`** — timing selector: action fires before tool execution. Returns `TimingBuilder`.
- **`.after`** — timing selector: action fires after tool execution. Returns `TimingBuilder`.
- **`.run(cmd)`** — execute a shell command. Supports `{key}` interpolation from matched input values.
- **`.block(reason)`** — block the tool call with a reason string.
- **`.confirm(reason)`** — prompt user for confirmation. Blocks if denied.
- **`.rewrite(rw)`** — rewrite tool output text using a rewrite function.

## Matcher Primitives

Built from the existing `shared/matching/matchers/` system, scoped via `ctx.bash`:

| Primitive | Description |
|-----------|-------------|
| `ctx.bash.word("token")` | Match a single token |
| `ctx.seq(a, b, c)` | Match a sequence of matchers in order |
| `ctx.star()` | Match zero or more tokens |
| `ctx.spread()` | Match zero or more tokens (like `...rest`) |
| `ctx.contains(inner)` | Match if inner matcher matches anywhere in the token list |
| `ctx.anyOf(a, b, c)` | Match if any of the matchers match |
| `ctx.repeat(a)` | Match zero or more repetitions of matcher `a` |
| `ctx.glob(pattern)` | Glob path matching (picomatch) |

## Rewrite Primitives

Via `ctx.rewrite`:

| Primitive | Description |
|-----------|-------------|
| `ctx.rewrite.replace(regex, replacement)` | Replace regex matches with replacement string |
| `ctx.rewrite.mask(count)` | Mask last N characters of matched tokens |
| `ctx.rewrite.sanitize()` | Strip ANSI codes, trim whitespace |
| `ctx.rewrite.custom(fn)` | Custom function: `(text: string) => string` |

## Interpolation

`.run(cmd)` supports `{key}` placeholders that interpolate from the matched input values:

```javascript
ctx.tool("edit").input("path", ctx.glob("*.{js,ts}")).run("bunx prettier --write {path}")
// → bunx prettier --write /home/knoopx/project/src/index.ts

ctx.tool("write")
  .input("path", ctx.bash.word("*.js"))
  .input("content", ctx.contains(ctx.bash.regex(/console\.log/)))
  .run("echo 'Debug log found in {path}'")
```

## Event Hook Mapping

### tool_call (pre-execution)

| API | Event result |
|-----|-------------|
| `.block(reason)` | `{ block: true, reason }` — blocks execution |
| `.confirm(reason)` | User confirmation dialog; `{ block: true/false, reason }` |
| `.before.run(cmd)` | Executes command. Non-zero exit → blocks original call |

### tool_result (post-execution)

| API | Event result |
|-----|-------------|
| `.after.run(cmd)` | Appends command output to `content` |
| `.rewrite(rw)` | Transforms `content` text |
| `.output(matcher).block(reason)` | Blocks result (suppresses output) |
| `.output(matcher).confirm(reason)` | User confirmation on result |

## Default Files

Each logical guardrail group gets a `.ts` file in `defaults/protocols/`:

```
defaults/protocols/
  no-rm.ts
  no-grep.ts
  no-find.ts
  no-pi-tools-in-bash.ts
  protect-paths.ts
  testing.ts
  no-regex-markup.ts
  sequential-delegation.ts
  verify-before-claim.ts
  engineering-rules.ts
  read-skills-first.ts
  preserve-working-code.ts
  evidence-based-updates.ts
  telegram-no-autosend.ts
  no-bash-scripting.ts
  trash-over-rm.ts
  ...
```

## Migration

### Current system (legacy)

```typescript
// GuardrailsGroup[]
{
  group: "no-rm",
  pattern: "*",
  rules: [
    {
      context: "command",
      matcher: seq(word("rm"), star()),
      action: "block",
      reason: "Use trash",
    },
  ],
}
```

### New system

```javascript
// defaults/protocols/no-rm.ts
import type { GuardrailContext } from "../types";

export default function (ctx: GuardrailContext) {
  ctx.tool("bash")
    .input("command", ctx.seq(ctx.bash.word("rm"), ctx.star()))
    .block("Use trash instead of rm — it permanently deletes files");
}
```

### Registration

`defaults/protocols/all.ts` imports and runs all protocol modules:

```typescript
import type { GuardrailContext } from "../../types";

import noRm from "./no-rm";
import noGrep from "./no-grep";
// ...

export default function (ctx: GuardrailContext) {
  noRm(ctx);
  noGrep(ctx);
  // ...
}
```

Extension `index.ts`:

```typescript
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { loadGuardrailsSettings } from "./config/loader";
import allProtocols from "./defaults/protocols/all";

export default async function (pi: ExtensionAPI) {
  const enabled = (await loadGuardrailsSettings()).enabled;

  pi.on("tool_call", async (event, ctx) => {
    if (!enabled) return;
    const guardrails = new GuardrailContext();
    allProtocols(guardrails);
    return guardrails.matchCall(event);
  });

  pi.on("tool_result", async (event, ctx) => {
    if (!enabled) return;
    const guardrails = new GuardrailContext();
    allProtocols(guardrails);
    return guardrails.matchResult(event);
  });
}
```

## Non-Codifiable Protocols

Some protocols are procedural guidance or behavioral norms that cannot be enforced via guardrails:

- `engineering-rules.md` — "Read Guardrails First", "Research Before Implementing"
- `evidence-based-updates.md` — "NEVER add rules without evidence"
- `preserve-working-code.md` — "Changes must not break existing functionality"
- `sequential-delegation.md` — "ONE task per delegation"
- `verify-before-claim.md` — "Verify After Every Change"
- `telegram-no-autosend.md` — "NEVER send Telegram messages unless asked"
- `read-skills-first.md` — "ALWAYS read relevant skill files BEFORE executing"

These remain as markdown protocol files in `~/.pi/agent/protocols/` and are read by agents at runtime via skill loading. They cannot be codified as guardrails because they govern agent behavior, not tool calls.

## Security

- `.run()` commands execute in a sandboxed shell
- Only `block`, `confirm`, `rewrite`, and `run` are allowed actions
- No arbitrary code execution via the builder
- Commands are validated against a whitelist of safe operations
