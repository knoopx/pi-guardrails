import { describe, it, expect, beforeEach } from "vitest";
import { GuardrailContext } from "./context.js";
import type { ToolCallEvent, ToolResultEvent } from "./events.js";

let ctx: GuardrailContext;

// ──────────────────────────────────────────────────────────────────────────────
// Helper for creating test events
// ──────────────────────────────────────────────────────────────────────────────

function makeCall(
  toolName: string,
  input: Record<string, unknown>,
): ToolCallEvent {
  return { toolCallId: "test-123", toolName, input };
}

function makeResult(
  toolName: string,
  input: Record<string, unknown>,
  content: string,
): ToolResultEvent {
  return {
    toolCallId: "test-123",
    toolName,
    input,
    content: [{ type: "text", text: content }],
    isError: false,
  } as unknown as ToolResultEvent;
}

function makeResultJson(
  toolName: string,
  input: Record<string, unknown>,
  json: unknown,
): ToolResultEvent {
  return {
    toolCallId: "test-123",
    toolName,
    input,
    content: [{ type: "text", text: JSON.stringify(json) }],
    isError: false,
  } as unknown as ToolResultEvent;
}

function makeError(
  input: Record<string, unknown>,
  content: string,
): ToolResultEvent {
  return {
    toolCallId: "1",
    toolName: "bash",
    input,
    content: [{ type: "text", text: content }],
    isError: true,
  } as unknown as ToolResultEvent;
}

// ──────────────────────────────────────────────────────────────────────────────
// Test assertion helpers
// ──────────────────────────────────────────────────────────────────────────────

/** Match a tool call and assert block/no-block result. */
function assertCall(
  ctx: GuardrailContext,
  toolName: string,
  input: Record<string, unknown>,
  expectBlock: boolean,
  expectedReason?: string,
): void {
  const result = ctx.matchCall(makeCall(toolName, input));
  if (expectBlock) {
    if (expectedReason !== undefined) {
      expect(result).toMatchObject({ block: true, reason: expectedReason });
    } else {
      expect(result).toMatchObject({ block: true });
    }
  } else {
    expect(result).toBeUndefined();
  }
}

/** Match a tool result and assert block/no-block result. */
function assertResult(
  ctx: GuardrailContext,
  toolName: string,
  input: Record<string, unknown>,
  content: string,
  expectBlock: boolean,
  expectedReason?: string,
): void {
  const result = ctx.matchResult(makeResult(toolName, input, content));
  if (expectBlock) {
    if (expectedReason !== undefined) {
      expect(result).toMatchObject({ block: true, reason: expectedReason });
    } else {
      expect(result).toMatchObject({ block: true });
    }
  } else {
    expect(result).toBeUndefined();
  }
}

/** Assert error result is blocked with given reason. */
function assertErrorBlock(
  ctx: GuardrailContext,
  input: Record<string, unknown>,
  content: string,
  reason: string,
): void {
  const result = ctx.matchError(makeError(input, content));
  expect(result).toMatchObject({ block: true, reason });
}

/** Assert error result does NOT trigger a block (returns undefined). */
function assertErrorNoBlock(
  ctx: GuardrailContext,
  input: Record<string, unknown>,
  content: string,
): void {
  const result = ctx.matchError(makeError(input, content));
  expect(result).toBeUndefined();
}

// ──────────────────────────────────────────────────────────────────────────────
// Pre-execution: tool().input().block()
// ──────────────────────────────────────────────────────────────────────────────

describe("GuardrailContext — pre-execution rules", () => {
  beforeEach(() => {
    ctx = new GuardrailContext();
  });

  it("matches and blocks on bash rm command", () => {
    ctx
      .tool("bash")
      .input("command", ctx.seq(ctx.bash.word("rm"), ctx.star()))
      .block(
        "Do not use `rm` to delete files — it permanently removes them. Use `trash` instead, which moves files to the trash where they can be recovered",
      );

    const result = ctx.matchCall(makeCall("bash", { command: "rm foo.txt" }));
    expect(result).toMatchObject({
      block: true,
      reason:
        "Do not use `rm` to delete files — it permanently removes them. Use `trash` instead, which moves files to the trash where they can be recovered",
    });
  });

  it("blocks global bun add", () => {
    ctx
      .tool("bash")
      .input(
        "command",
        ctx.seq(
          ctx.bash.word("bun"),
          ctx.bash.word("add"),
          ctx.bash.word("-g"),
          ctx.star(),
        ),
      )
      .block(
        "Global package installs are forbidden. Install packages locally in the project instead",
      );

    const result = ctx.matchCall(
      makeCall("bash", { command: "bun add -g lodash" }),
    );
    expect(result).toMatchObject({
      block: true,
      reason:
        "Global package installs are forbidden. Install packages locally in the project instead",
    });
  });

  describe("rm-block rule", () => {
    beforeEach(() => {
      ctx
        .tool("bash")
        .input("command", ctx.seq(ctx.bash.word("rm"), ctx.star()))
        .block("Blocked");
    });

    it("does not block unrelated commands", () => {
      assertCall(
        ctx,
        "bash",
        { command: "find / -name '*.tmp' -exec rm {} +" },
        false,
      );
    });

    it("does not match when first token doesn't match", () => {
      assertCall(ctx, "bash", { command: "ls -la" }, false);
    });

    it("blocks rm after &&", () => {
      assertCall(ctx, "bash", { command: "cd /tmp && rm -rf ." }, true);
    });

    it("blocks rm after ;", () => {
      assertCall(ctx, "bash", { command: "echo hello; rm -rf /" }, true);
    });

    it("blocks rm after ||", () => {
      assertCall(ctx, "bash", { command: "ls || rm -rf ." }, true);
    });
  });

  it("matches nushell ls -R (nu-syntax guardrail)", () => {
    ctx
      .tool("nu-eval")
      .input("command", ctx.contains(ctx.nu.word("ls"), ctx.nu.word("-R")))
      .block(
        "nushell `ls` has no `-R` flag. Use `ls -r` for recursive listing or `ls **` glob (read skill: ~/.pi/agent/skills/tools/nu)",
      );

    const result = ctx.matchCall(makeCall("nu-eval", { command: "ls -R" }));
    expect(result).toMatchObject({
      block: true,
      reason:
        "nushell `ls` has no `-R` flag. Use `ls -r` for recursive listing or `ls **` glob (read skill: ~/.pi/agent/skills/tools/nu)",
    });
  });

  it("matches nushell sort (nu-syntax guardrail)", () => {
    ctx
      .tool("nu-eval")
      .input("command", ctx.contains(ctx.nu.word("sort")))
      .block(
        "nushell `sort` takes no positional arguments. Use `sort-by <column>` to sort by a column (read skill: ~/.pi/agent/skills/tools/nu)",
      );

    const result = ctx.matchCall(makeCall("nu-eval", { command: "sort" }));
    expect(result).toMatchObject({
      block: true,
      reason:
        "nushell `sort` takes no positional arguments. Use `sort-by <column>` to sort by a column (read skill: ~/.pi/agent/skills/tools/nu)",
    });
  });

  it("allows valid nushell commands", () => {
    ctx
      .tool("nu-eval")
      .input("command", ctx.contains(ctx.nu.word("sort")))
      .block("Blocked");

    const result = ctx.matchCall(
      makeCall("nu-eval", { command: "sort-by name" }),
    );
    expect(result).toBeUndefined();
  });

  it("matches duckdb read_csv_auto (duckdb-syntax guardrail)", () => {
    ctx
      .tool("duckdb-eval")
      .input("command", ctx.contains(ctx.sql.word("read_csv_auto")))
      .block(
        "duckdb does not expand `~` in paths. Use full paths like `/home/user/...` or read the file with the `read` tool first (read skill: ~/.pi/agent/skills/tools/duckdb)",
      );

    const result = ctx.matchCall(
      makeCall("duckdb-eval", {
        command: "SELECT * FROM read_csv_auto('/home/user/data.csv')",
      }),
    );
    expect(result).toMatchObject({
      block: true,
      reason:
        "duckdb does not expand `~` in paths. Use full paths like `/home/user/...` or read the file with the `read` tool first (read skill: ~/.pi/agent/skills/tools/duckdb)",
    });
  });

  it("matches duckdb AUTO_DETECT ON (duckdb-syntax guardrail)", () => {
    ctx
      .tool("duckdb-eval")
      .input(
        "command",
        ctx.seq(
          ctx.spread(),
          ctx.sql.word("AUTO_DETECT"),
          ctx.spread(),
          ctx.sql.word("ON"),
          ctx.star(),
        ),
      )
      .block(
        "duckdb `read_csv_auto` has no `AUTO_DETECT ON` option. It auto-detects by default. Use `read_csv_auto('file.csv', auto_detect=true)` if needed (read skill: ~/.pi/agent/skills/tools/duckdb)",
      );

    const result = ctx.matchCall(
      makeCall("duckdb-eval", { command: "SET AUTO_DETECT ON" }),
    );
    expect(result).toMatchObject({
      block: true,
      reason:
        "duckdb `read_csv_auto` has no `AUTO_DETECT ON` option. It auto-detects by default. Use `read_csv_auto('file.csv', auto_detect=true)` if needed (read skill: ~/.pi/agent/skills/tools/duckdb)",
    });
  });

  it("does not match unrelated duckdb queries", () => {
    ctx
      .tool("duckdb-eval")
      .input("command", ctx.contains(ctx.sql.word("read_csv_auto")))
      .block("Blocked");

    const result = ctx.matchCall(
      makeCall("duckdb-eval", { command: "SELECT 1" }),
    );
    expect(result).toBeUndefined();
  });

  it("blocks web-fetch on github search", () => {
    ctx
      .tool("web-fetch")
      .input("source", ctx.regex(/^https?:\/\/github\.com\/search/))
      .block(
        "GitHub search results render dynamically and require JavaScript. Use the `gh-search-repos` tool or `gh search repos` CLI command instead",
      );

    const result = ctx.matchCall(
      makeCall("web-fetch", { source: "https://github.com/search?q=test" }),
    );
    expect(result).toMatchObject({
      block: true,
      reason:
        "GitHub search results render dynamically and require JavaScript. Use the `gh-search-repos` tool or `gh search repos` CLI command instead",
    });
  });

  it("allows web-fetch on regular github URLs", () => {
    ctx
      .tool("web-fetch")
      .input("source", ctx.regex(/^https?:\/\/github\.com\/search/))
      .block("Blocked");

    const result = ctx.matchCall(
      makeCall("web-fetch", { source: "https://github.com/user/repo" }),
    );
    expect(result).toBeUndefined();
  });

  it("blocks write with Bun.file()", () => {
    ctx
      .tool("write")
      .input("content", ctx.regex(/Bun\.(file|write|spawn|inspect|env|\$)/))
      .block(
        "Bun-exclusive APIs are not available in the Pi runtime (Node.js 24). Use node:fs/promises (readFile, writeFile), node:child_process (spawn, execFile), util.inspect, process.env instead",
      );

    const result = ctx.matchCall(
      makeCall("write", {
        path: "/tmp/test.ts",
        content: "Bun.file('/path').write()",
      }),
    );
    expect(result).toMatchObject({
      block: true,
      reason:
        "Bun-exclusive APIs are not available in the Pi runtime (Node.js 24). Use node:fs/promises (readFile, writeFile), node:child_process (spawn, execFile), util.inspect, process.env instead",
    });
  });

  it("blocks edit with Bun.spawn() in newText", () => {
    ctx
      .tool("edit")
      .input("newText", ctx.regex(/Bun\.(file|write|spawn|inspect|env|\$)/))
      .block(
        "Bun-exclusive APIs are not available in the Pi runtime (Node.js 24). Use node:fs/promises (readFile, writeFile), node:child_process (spawn, execFile), util.inspect, process.env instead",
      );

    const result = ctx.matchCall(
      makeCall("edit", { path: "/tmp/test.ts", newText: "Bun.spawn('ls')" }),
    );
    expect(result).toMatchObject({
      block: true,
      reason:
        "Bun-exclusive APIs are not available in the Pi runtime (Node.js 24). Use node:fs/promises (readFile, writeFile), node:child_process (spawn, execFile), util.inspect, process.env instead",
    });
  });

  it("allows write with non-Bun content", () => {
    ctx
      .tool("write")
      .input("content", ctx.regex(/Bun\.(file|write|spawn|inspect|env|\$)/))
      .block("Blocked");

    const result = ctx.matchCall(
      makeCall("write", { path: "/tmp/test.ts", content: "console.log('hi')" }),
    );
    expect(result).toBeUndefined();
  });

  it("allows edit with non-Bun content", () => {
    ctx
      .tool("edit")
      .input("newText", ctx.regex(/Bun\.(file|write|spawn|inspect|env|\$)/))
      .block("Blocked");

    const result = ctx.matchCall(
      makeCall("edit", { path: "/tmp/test.ts", newText: "console.log('hi')" }),
    );
    expect(result).toBeUndefined();
  });

  it("blocks write on .tsv files", () => {
    ctx
      .tool("write")
      .input("path", ctx.glob("*.tsv"))
      .block(
        "TSV files must be written via DuckDB, not hand-edited. Use duckdb-eval to INSERT/UPDATE records, then COPY back the full table. Hand-editing corrupts tab delimiters and breaks column alignment.",
      );

    const result = ctx.matchCall(
      makeCall("write", { path: "/tmp/data.tsv", content: "foo\tbar" }),
    );
    expect(result).toMatchObject({
      block: true,
      reason:
        "TSV files must be written via DuckDB, not hand-edited. Use duckdb-eval to INSERT/UPDATE records, then COPY back the full table. Hand-editing corrupts tab delimiters and breaks column alignment.",
    });
  });

  it("blocks edit on .tsv files", () => {
    ctx
      .tool("edit")
      .input("path", ctx.glob("*.tsv"))
      .block(
        "TSV files must be edited via DuckDB, not hand-edited. Use duckdb-eval to read all rows, mutate, then COPY back the full table. Hand-editing corrupts tab delimiters and breaks column alignment.",
      );

    const result = ctx.matchCall(
      makeCall("edit", { path: "/tmp/data.tsv", newText: "foo\tbar" }),
    );
    expect(result).toMatchObject({
      block: true,
      reason:
        "TSV files must be edited via DuckDB, not hand-edited. Use duckdb-eval to read all rows, mutate, then COPY back the full table. Hand-editing corrupts tab delimiters and breaks column alignment.",
    });
  });

  it("allows write on non-.tsv files", () => {
    ctx.tool("write").input("path", ctx.glob("*.tsv")).block("Blocked");

    const result = ctx.matchCall(
      makeCall("write", { path: "/tmp/data.json", content: "{}" }),
    );
    expect(result).toBeUndefined();
  });

  it("allows edit on non-.tsv files", () => {
    ctx.tool("edit").input("path", ctx.glob("*.tsv")).block("Blocked");

    const result = ctx.matchCall(
      makeCall("edit", { path: "/tmp/data.json", newText: "{}" }),
    );
    expect(result).toBeUndefined();
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// Post-execution: tool().input().output().block()
// ──────────────────────────────────────────────────────────────────────────────

describe("GuardrailContext — post-execution block", () => {
  beforeEach(() => {
    ctx
      .tool("bash")
      .input("command", ctx.seq(ctx.bash.word("rm"), ctx.star()))
      .output(ctx.regex(/~/))
      .block("Result contains ~ — should expand to full path");
  });

  it("blocks result matching output pattern with input condition", () => {
    assertResult(
      ctx,
      "bash",
      { command: "rm ~/data.csv" },
      "~/data.csv output",
      true,
    );
  });

  it("does not block when output does not match", () => {
    assertResult(
      ctx,
      "bash",
      { command: "rm /home/user/data.csv" },
      "/home/user/data.csv output",
      false,
    );
  });

  it("does not block when input condition does not match", () => {
    assertResult(
      ctx,
      "bash",
      { command: "ls ~" },
      "~/data.csv output",
      false,
    );
  });
});

describe("GuardrailContext — post-execution confirm", () => {
  it("confirms result matching output pattern with input condition", () => {
    ctx
      .tool("bash")
      .input("command", ctx.seq(ctx.bash.word("rm"), ctx.star()))
      .output(ctx.regex(/~/))
      .confirm("Confirm the rm result");

    assertResult(
      ctx,
      "bash",
      { command: "rm ~/data.csv" },
      "~/data.csv output",
      true,
    );
  });
});

describe("GuardrailContext — post-execution rewrite", () => {
  beforeEach(() => {
    ctx = new GuardrailContext();
  });

  it("rewrites result text when matching output and input patterns", () => {
    ctx
      .tool("bash")
      .input("command", ctx.seq(ctx.bash.word("rm"), ctx.star()))
      .output(ctx.regex(/~/))
      .rewrite((event) => {
        const newContent = event.content.map((c) => {
          if (c.type === "text") {
            return { ...c, text: c.text.replace(/~/g, "/home/user") };
          }
          return c;
        });
        return { content: newContent };
      });

    const result = ctx.matchResult(
      makeResult("bash", { command: "rm ~/data.csv" }, "~/data.csv output"),
    );
    expect(result?.content?.[0]).toMatchObject({
      type: "text",
      text: "/home/user/data.csv output",
    });
  });

  it("does not rewrite when output does not match", () => {
    ctx
      .tool("bash")
      .input("command", ctx.seq(ctx.bash.word("rm"), ctx.star()))
      .output(ctx.regex(/~/))
      .rewrite((event) => {
        const newContent = event.content.map((c) => {
          if (c.type === "text") {
            return { ...c, text: c.text.replace(/~/g, "/home/user") };
          }
          return c;
        });
        return { content: newContent };
      });

    assertResult(
      ctx,
      "bash",
      { command: "rm /home/user/data.csv" },
      "/home/user/data.csv output",
      false,
    );
  });

  it("can rewrite JSON content", () => {
    ctx
      .tool("write")
      .input("file_path", ctx.contains(ctx.bash.word("README.md")))
      .output(ctx.regex(/error|warning|problem/i))
      .rewrite((event) => {
        const newContent = event.content.map((c) => {
          if (c.type === "text") {
            return {
              ...c,
              text: c.text.replace(/error|warning|problem/gi, "issue"),
            };
          }
          return c;
        });
        return { content: newContent };
      });

    const result = ctx.matchResult(
      makeResultJson(
        "write",
        { file_path: "README.md" },
        { message: "This is an error" },
      ),
    );
    expect(result?.content?.[0]).toMatchObject({
      type: "text",
      text: '{"message":"This is an issue"}',
    });
  });
});

describe("GuardrailContext — post-execution run", () => {
  beforeEach(() => {
    ctx = new GuardrailContext();
  });

  it("runs command on matching output and input", () => {
    ctx
      .tool("bash")
      .input("command", ctx.seq(ctx.bash.word("rm"), ctx.star()))
      .output(ctx.regex(/~/))
      .run("echo 'Found tilde in result!'");

    const result = ctx.matchResult(
      makeResult("bash", { command: "rm ~/data.csv" }, "~/data.csv output"),
    );
    expect(result?.content?.[0]).toMatchObject({ type: "text" });
    expect(
      (result?.content?.[0] as { type: "text"; text: string })?.text,
    ).toContain("Found tilde in result!");
  });
});

describe("GuardrailContext — pre-execution run action", () => {
  beforeEach(() => {
    ctx
      .tool("bash")
      .input(
        "command",
        ctx.seq(
          ctx.bash.word("bun"),
          ctx.bash.word("add"),
          ctx.bash.word("-g"),
          ctx.star(),
        ),
      )
      .run("echo 'Global install blocked!'");
  });

  it("matches bun add -g pattern with run command", () => {
    assertCall(
      ctx,
      "bash",
      { command: "bun add -g lodash" },
      true,
      "Command blocked: echo 'Global install blocked!'",
    );
  });

  it("run action does not trigger for unrelated commands", () => {
    assertCall(ctx, "bash", { command: "ls -la" }, false);
  });
});

describe("GuardrailContext — rule interactions", () => {
  beforeEach(() => {
    ctx = new GuardrailContext();
  });

  it("first matching post-rule wins", () => {
    ctx
      .tool("bash")
      .input("command", ctx.seq(ctx.bash.word("rm"), ctx.star()))
      .output(ctx.regex(/~/))
      .block("First rule: tilde in result");

    ctx
      .tool("bash")
      .input("command", ctx.seq(ctx.bash.word("rm"), ctx.star()))
      .output(ctx.regex(/csv/i))
      .block("Second rule: csv in result");

    const result = ctx.matchResult(
      makeResult("bash", { command: "rm ~/data.csv" }, "~/data.csv output"),
    );
    expect(result).toMatchObject({
      block: true,
      reason: "First rule: tilde in result",
    });
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// Fluent API: chaining inputs
// ──────────────────────────────────────────────────────────────────────────────

describe("Fluent API — chained inputs", () => {
  beforeEach(() => {
    ctx = new GuardrailContext();
    ctx
      .tool("bash")
      .input("command", ctx.seq(ctx.bash.word("rm"), ctx.star()))
      .input("file", ctx.bash.word("DELETE_ME"))
      .block("Blocked");
  });

  it("matches rule with multiple input conditions", () => {
    assertCall(ctx, "bash", { command: "rm DELETE_ME", file: "DELETE_ME" }, true);
  });

  it("returns undefined when second input condition fails", () => {
    assertCall(ctx, "bash", { command: "rm DELETE_ME" }, false);
  });
});

describe("Fluent API — output + chained inputs", () => {
  beforeEach(() => {
    ctx = new GuardrailContext();
    ctx
      .tool("bash")
      .input("command", ctx.seq(ctx.bash.word("rm"), ctx.star()))
      .input("file", ctx.bash.word("DELETE_ME"))
      .output(ctx.regex(/~/))
      .block("Result contains ~ — should expand to full path");
  });

  it("matches output rule with multiple input conditions", () => {
    assertResult(
      ctx,
      "bash",
      { command: "rm ~/DELETE_ME", file: "DELETE_ME" },
      "~/DELETE_ME output",
      true,
    );
  });

  it("returns undefined when second input condition fails", () => {
    assertResult(
      ctx,
      "bash",
      { command: "rm /home/user/DELETE_ME" },
      "~/DELETE_ME output",
      false,
    );
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// Guardrail: cm-flags
// ──────────────────────────────────────────────────────────────────────────────

describe("cm-flags guardrail", () => {
  beforeEach(() => {
    ctx = new GuardrailContext();
  });

  it("blocks `cm --version`", () => {
    ctx
      .tool("bash")
      .input(
        "command",
        ctx.seq(ctx.bash.word("cm"), ctx.bash.word("--version"), ctx.star()),
      )
      .block(
        "cm has no `--version` flag. Use `cm --help` to check availability",
      );

    assertCall(ctx, "bash", { command: "cm --version" }, true);
  });

  it("blocks `cm deps --circular foo`", () => {
    ctx
      .tool("bash")
      .input(
        "command",
        ctx.seq(
          ctx.bash.word("cm"),
          ctx.bash.word("deps"),
          ctx.spread(),
          ctx.bash.word("--circular"),
          ctx.star(),
        ),
      )
      .block(
        "cm deps has no `--circular` flag. Use `cm deps <target>` without it — circular deps are shown by default",
      );

    assertCall(ctx, "bash", { command: "cm deps --circular foo" }, true);
  });

  it("blocks `cm callers symbol foo`", () => {
    ctx
      .tool("bash")
      .input(
        "command",
        ctx.seq(
          ctx.bash.word("cm"),
          ctx.bash.word("callers"),
          ctx.bash.word("symbol"),
          ctx.star(),
        ),
      )
      .block(
        "cm callers takes a symbol name directly, not 'symbol <name>'. Use `cm callers <symbol>`",
      );

    assertCall(ctx, "bash", { command: "cm callers symbol foo" }, true);
  });

  it("blocks `cm map /path`", () => {
    ctx
      .tool("bash")
      .input(
        "command",
        ctx.seq(ctx.bash.word("cm"), ctx.bash.word("map"), ctx.star()),
      )
      .block(
        "cm map takes a directory path, not a file path. Point it at the project root directory",
      );

    assertCall(ctx, "bash", { command: "cm map /path" }, true);
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// Guardrail: jj-hunk-flags
// ──────────────────────────────────────────────────────────────────────────────

describe("jj-hunk-flags guardrail", () => {
  beforeEach(() => {
    ctx = new GuardrailContext();
  });

  it("blocks `jj-hunk --version`", () => {
    ctx
      .tool("bash")
      .input(
        "command",
        ctx.seq(
          ctx.bash.word("jj-hunk"),
          ctx.bash.word("--version"),
          ctx.star(),
        ),
      )
      .block(
        "jj-hunk has no `--version` flag. Use `jj-hunk help` to check availability",
      );

    assertCall(ctx, "bash", { command: "jj-hunk --version" }, true);
  });

  it("blocks `jj-hunk -V`", () => {
    ctx
      .tool("bash")
      .input(
        "command",
        ctx.seq(ctx.bash.word("jj-hunk"), ctx.bash.word("-V"), ctx.star()),
      )
      .block(
        "jj-hunk has no `-V` flag. Use `jj-hunk help` to check availability",
      );

    assertCall(ctx, "bash", { command: "jj-hunk -V" }, true);
  });

  it("blocks `jj-hunk split --include foo`", () => {
    ctx
      .tool("bash")
      .input(
        "command",
        ctx.seq(
          ctx.bash.word("jj-hunk"),
          ctx.bash.word("split"),
          ctx.spread(),
          ctx.bash.word("--include"),
          ctx.star(),
        ),
      )
      .block(
        "jj-hunk split has no `--include` flag. Pass file paths directly or use `-f` for a spec file",
      );

    assertCall(ctx, "bash", { command: "jj-hunk split --include foo" }, true);
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// Guardrail: kuva-flags
// ──────────────────────────────────────────────────────────────────────────────

describe("kuva-flags guardrail", () => {
  beforeEach(() => {
    ctx = new GuardrailContext();
  });

  it("blocks `kuva --x-col price`", () => {
    ctx
      .tool("bash")
      .input(
        "command",
        ctx.seq(
          ctx.bash.word("kuva"),
          ctx.spread(),
          ctx.bash.word("--x-col"),
          ctx.star(),
        ),
      )
      .block(
        "kuva has no `--x-col` flag. Use `--x` instead. Example: `kuva scatter --x price --y score`",
      );

    assertCall(ctx, "bash", { command: "kuva scatter --x-col price" }, true);
  });

  it("blocks `kuva --y-col name`", () => {
    ctx
      .tool("bash")
      .input(
        "command",
        ctx.seq(
          ctx.bash.word("kuva"),
          ctx.spread(),
          ctx.bash.word("--y-col"),
          ctx.star(),
        ),
      )
      .block(
        "kuva has no `--y-col` flag. Use `--y` instead. Example: `kuva scatter --x price --y score`",
      );

    assertCall(ctx, "bash", { command: "kuva --y-col name" }, true);
  });

  it("blocks `kuva --label-col label`", () => {
    ctx
      .tool("bash")
      .input(
        "command",
        ctx.seq(
          ctx.bash.word("kuva"),
          ctx.spread(),
          ctx.bash.word("--label-col"),
          ctx.star(),
        ),
      )
      .block("kuva has no `--label-col` flag. Use `--label` instead");

    assertCall(ctx, "bash", { command: "kuva --label-col label" }, true);
  });

  it("blocks `kuva --color-by col`", () => {
    ctx
      .tool("bash")
      .input(
        "command",
        ctx.seq(
          ctx.bash.word("kuva"),
          ctx.spread(),
          ctx.bash.word("--color-by"),
          ctx.star(),
        ),
      )
      .block(
        "not all kuva chart types support `--color-by`. Check the chart type docs",
      );

    assertCall(ctx, "bash", { command: "kuva --color-by col" }, true);
  });

  it("blocks `kuva --legend`", () => {
    ctx
      .tool("bash")
      .input(
        "command",
        ctx.seq(
          ctx.bash.word("kuva"),
          ctx.spread(),
          ctx.bash.word("--legend"),
          ctx.star(),
        ),
      )
      .block(
        "kuva has no `--legend` flag. Use `--legend-wrap` if available for the chart type",
      );

    assertCall(ctx, "bash", { command: "kuva --legend" }, true);
  });

  it("blocks `kuva --agg avg`", () => {
    ctx
      .tool("bash")
      .input(
        "command",
        ctx.seq(
          ctx.bash.word("kuva"),
          ctx.spread(),
          ctx.bash.word("--agg"),
          ctx.star(),
        ),
      )
      .block(
        "kuva has no `--agg` flag. Aggregate in DuckDB before piping to kuva",
      );

    assertCall(ctx, "bash", { command: "kuva --agg avg" }, true);
  });

  it("blocks `kuva --rotate-labels`", () => {
    ctx
      .tool("bash")
      .input(
        "command",
        ctx.seq(
          ctx.bash.word("kuva"),
          ctx.spread(),
          ctx.bash.word("--rotate-labels"),
          ctx.star(),
        ),
      )
      .block("kuva has no `--rotate-labels` flag. Use `--label-angle` instead");

    assertCall(ctx, "bash", { command: "kuva --rotate-labels" }, true);
  });

  it("blocks `kuva --color` (any value)", () => {
    ctx
      .tool("bash")
      .input(
        "command",
        ctx.seq(
          ctx.bash.word("kuva"),
          ctx.spread(),
          ctx.bash.word("--color"),
          ctx.star(),
        ),
      )
      .block(
        "kuva chart types may not support `--color` directly. Use `--palette` or `--color-by` depending on chart type",
      );

    assertCall(ctx, "bash", { command: 'kuva bar --color "red"' }, true);
  });

  it("blocks `kuva --size-col size`", () => {
    ctx
      .tool("bash")
      .input(
        "command",
        ctx.seq(
          ctx.bash.word("kuva"),
          ctx.spread(),
          ctx.bash.word("--size-col"),
          ctx.star(),
        ),
      )
      .block("kuva has no `--size-col` flag. Use `--size` instead");

    assertCall(ctx, "bash", { command: "kuva --size-col size" }, true);
  });

  it("blocks `kuva --color-col color`", () => {
    ctx
      .tool("bash")
      .input(
        "command",
        ctx.seq(
          ctx.bash.word("kuva"),
          ctx.spread(),
          ctx.bash.word("--color-col"),
          ctx.star(),
        ),
      )
      .block("kuva has no `--color-col` flag. Use `--color-by` instead");

    assertCall(ctx, "bash", { command: "kuva --color-col color" }, true);
  });

  it("blocks `kuva --value-col value`", () => {
    ctx
      .tool("bash")
      .input(
        "command",
        ctx.seq(
          ctx.bash.word("kuva"),
          ctx.spread(),
          ctx.bash.word("--value-col"),
          ctx.star(),
        ),
      )
      .block("kuva has no `--value-col` flag. Use `--value` instead");

    assertCall(ctx, "bash", { command: "kuva --value-col value" }, true);
  });

  it("blocks `kuva --group-col group`", () => {
    ctx
      .tool("bash")
      .input(
        "command",
        ctx.seq(
          ctx.bash.word("kuva"),
          ctx.spread(),
          ctx.bash.word("--group-col"),
          ctx.star(),
        ),
      )
      .block("kuva has no `--group-col` flag. Use `--group` instead");

    assertCall(ctx, "bash", { command: "kuva --group-col group" }, true);
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// Guardrail: linting
// ──────────────────────────────────────────────────────────────────────────────

describe("linting guardrail", () => {
  beforeEach(() => {
    ctx = new GuardrailContext();
  });

  it("blocks write with eslint-disable in content", () => {
    ctx
      .tool("write")
      .input("content", ctx.regex(/eslint-disable/))
      .block("disabling lint rules hides issues. Fix the code instead");

    assertCall(ctx, "write", {
      path: "/tmp/test.ts",
      content: "// eslint-disable-next-line @typescript-eslint/no-explicit-any\nconst x: any = 1",
    }, true);
  });

  it("allows write with normal content", () => {
    ctx
      .tool("write")
      .input("content", ctx.regex(/eslint-disable/))
      .block("Blocked");

    assertCall(ctx, "write", { path: "/tmp/test.ts", content: "console.log('hi')" }, false);
  });

  it("blocks edit with eslint-disable in newText", () => {
    ctx
      .tool("edit")
      .input("newText", ctx.regex(/eslint-disable/))
      .block("disabling lint rules hides issues. Fix the code instead");

    assertCall(ctx, "edit", {
      path: "/tmp/test.ts",
      newText: "// eslint-disable-next-line",
    }, true);
  });

  it("allows edit without eslint-disable", () => {
    ctx
      .tool("edit")
      .input("newText", ctx.regex(/eslint-disable/))
      .block("Blocked");

    assertCall(ctx, "edit", { path: "/tmp/test.ts", newText: "console.log('hello')" }, false);
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// Guardrail: lock-files
// ──────────────────────────────────────────────────────────────────────────────

describe("lock-files guardrail", () => {
  beforeEach(() => {
    ctx = new GuardrailContext();
  });

  it("blocks write on package-lock.json", () => {
    ctx
      .tool("write")
      .input(
        "path",
        ctx.glob(
          "{package-lock.json,bun.lockb,yarn.lock,pnpm-lock.yaml,poetry.lock,uv.lock,Cargo.lock,Gemfile.lock,flake.lock}",
        ),
      )
      .block(
        "lock files are auto-generated. Edit the manifest instead and run the package manager to regenerate",
      );

    assertCall(ctx, "write", { path: "package-lock.json", content: "{}" }, true);
  });

  it("blocks write on bun.lockb", () => {
    ctx
      .tool("write")
      .input(
        "path",
        ctx.glob(
          "{package-lock.json,bun.lockb,yarn.lock,pnpm-lock.yaml,poetry.lock,uv.lock,Cargo.lock,Gemfile.lock,flake.lock}",
        ),
      )
      .block(
        "lock files are auto-generated. Edit the manifest instead and run the package manager to regenerate",
      );

    assertCall(ctx, "write", { path: "bun.lockb", content: "binary" }, true);
  });

  it("blocks write on Cargo.lock", () => {
    ctx
      .tool("write")
      .input(
        "path",
        ctx.glob(
          "{package-lock.json,bun.lockb,yarn.lock,pnpm-lock.yaml,poetry.lock,uv.lock,Cargo.lock,Gemfile.lock,flake.lock}",
        ),
      )
      .block(
        "lock files are auto-generated. Edit the manifest instead and run the package manager to regenerate",
      );

    assertCall(ctx, "write", { path: "Cargo.lock", content: "locked" }, true);
  });

  it("blocks edit on yarn.lock", () => {
    ctx
      .tool("edit")
      .input(
        "path",
        ctx.glob(
          "{package-lock.json,bun.lockb,yarn.lock,pnpm-lock.yaml,poetry.lock,uv.lock,Cargo.lock,Gemfile.lock,flake.lock}",
        ),
      )
      .block(
        "lock files are auto-generated. Edit the manifest instead and run the package manager to regenerate",
      );

    assertCall(ctx, "edit", { path: "yarn.lock", newText: "lockfileVersion: 6" }, true);
  });

  it("allows write on data.json (not a lock file)", () => {
    ctx
      .tool("write")
      .input(
        "path",
        ctx.glob(
          "{package-lock.json,bun.lockb,yarn.lock,pnpm-lock.yaml,poetry.lock,uv.lock,Cargo.lock,Gemfile.lock,flake.lock}",
        ),
      )
      .block("Blocked");

    assertCall(ctx, "write", { path: "data.json", content: "{}" }, false);
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// Guardrail: nh-flags
// ──────────────────────────────────────────────────────────────────────────────

describe("nh-flags guardrail", () => {
  beforeEach(() => {
    ctx = new GuardrailContext();
  });

  it("blocks `nh build`", () => {
    ctx
      .tool("bash")
      .input(
        "command",
        ctx.seq(ctx.bash.word("nh"), ctx.bash.word("build"), ctx.star()),
      )
      .block(
        "nh has no `build` subcommand. Use `nix build` directly or `nh home switch` / `nh os switch`",
      );

    assertCall(ctx, "bash", { command: "nh build" }, true);
  });

  it("blocks `nh switch`", () => {
    ctx
      .tool("bash")
      .input(
        "command",
        ctx.seq(ctx.bash.word("nh"), ctx.bash.word("switch"), ctx.star()),
      )
      .block(
        "nh has no `switch` subcommand. Use `nh home switch` or `nh os switch`",
      );

    assertCall(ctx, "bash", { command: "nh switch" }, true);
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// Guardrail: protect-paths
// ──────────────────────────────────────────────────────────────────────────────

describe("protect-paths guardrail", () => {
  beforeEach(() => {
    ctx = new GuardrailContext();
  });

  it("blocks edit on .git/config", () => {
    ctx
      .tool("edit")
      .input("path", ctx.regex(/^\.git\//))
      .block(
        "VCS internals — direct modification can corrupt history. Use git/jj commands instead",
      );

    assertCall(ctx, "edit", { path: ".git/config", newText: "new" }, true);
  });

  it("blocks write on .git/config", () => {
    ctx
      .tool("write")
      .input("path", ctx.regex(/^\.git\//))
      .block(
        "VCS internals — direct modification can corrupt history. Use git/jj commands instead",
      );

    assertCall(ctx, "write", { path: ".git/config", content: "config" }, true);
  });

  it("blocks edit on .jj/repo/config.toml", () => {
    ctx
      .tool("edit")
      .input("path", ctx.regex(/^\.jj\//))
      .block(
        "VCS internals — direct modification can corrupt history. Use git/jj commands instead",
      );

    assertCall(ctx, "edit", { path: ".jj/repo/config.toml", newText: "toml" }, true);
  });

  it("blocks write on .jj/repo/config.toml", () => {
    ctx
      .tool("write")
      .input("path", ctx.regex(/^\.jj\//))
      .block(
        "VCS internals — direct modification can corrupt history. Use git/jj commands instead",
      );

    assertCall(ctx, "write", { path: ".jj/repo/config.toml", content: "toml" }, true);
  });

  it("blocks edit on ~/.config/nvim/init.lua", () => {
    ctx
      .tool("edit")
      .input("path", ctx.regex(/^~\/.config\//))
      .block(
        "System config directory — modifying config files directly can break applications",
      );

    assertCall(ctx, "edit", { path: "~/.config/nvim/init.lua", newText: "lua" }, true);
  });

  it("blocks write on ~/.config/nvim/init.lua", () => {
    ctx
      .tool("write")
      .input("path", ctx.regex(/^~\/.config\//))
      .block(
        "System config directory — modifying config files directly can break applications",
      );

    assertCall(ctx, "write", { path: "~/.config/nvim/init.lua", content: "lua" }, true);
  });

  it("blocks edit on ~/.local/share/foo/bar", () => {
    ctx
      .tool("edit")
      .input("path", ctx.regex(/^~\/.local\//))
      .block(
        "System local data directory — modifying files here can break installed applications",
      );

    assertCall(ctx, "edit", { path: "~/.local/share/foo/bar", newText: "data" }, true);
  });

  it("blocks write on ~/.local/share/foo/bar", () => {
    ctx
      .tool("write")
      .input("path", ctx.regex(/^~\/.local\//))
      .block(
        "System local data directory — modifying files here can break installed applications",
      );

    assertCall(ctx, "write", { path: "~/.local/share/foo/bar", content: "data" }, true);
  });

  it("allows write on src/main.ts", () => {
    ctx
      .tool("write")
      .input("path", ctx.regex(/^\.git\//))
      .block("Blocked");

    ctx
      .tool("write")
      .input("path", ctx.regex(/^\.jj\//))
      .block("Blocked");

    ctx
      .tool("write")
      .input("path", ctx.regex(/^~\/.config\//))
      .block("Blocked");

    ctx
      .tool("write")
      .input("path", ctx.regex(/^~\/.local\//))
      .block("Blocked");

    assertCall(ctx, "write", { path: "src/main.ts", content: "export {}" }, false);
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// Guardrail: testing
// ──────────────────────────────────────────────────────────────────────────────

describe("testing guardrail", () => {
  const tempCtx = new GuardrailContext();
  const skipRegex = tempCtx.regex(/\.skip\b|\bdescribe\.skip\b|\bxdescribe\b|\bxit\(/);
  const skipReason =
    "skipped tests create blind spots. Fix, delete, or use `it.todo()` instead";

  beforeEach(() => {
    ctx = new GuardrailContext();
  });

  it("blocks write with .skip(", () => {
    ctx.tool("write").input("content", skipRegex).block(skipReason);
    assertCall(ctx, "write", {
      path: "/tmp/test.ts",
      content: "it.skip('failing test', () => {});",
    }, true);
  });

  it("blocks write with describe.skip", () => {
    ctx.tool("write").input("content", skipRegex).block(skipReason);
    assertCall(ctx, "write", {
      path: "/tmp/test.ts",
      content: "describe.skip('skipped suite', () => {});",
    }, true);
  });

  it("blocks edit with xdescribe", () => {
    ctx.tool("edit").input("newText", skipRegex).block(skipReason);
    assertCall(ctx, "edit", {
      path: "/tmp/test.ts",
      newText: "xdescribe('suite', () => {})",
    }, true);
  });

  it("blocks write with xit(", () => {
    ctx.tool("write").input("content", skipRegex).block(skipReason);
    assertCall(ctx, "write", {
      path: "/tmp/test.ts",
      content: "xit('failing test', () => {})",
    }, true);
  });

  it("allows write with normal test content", () => {
    ctx.tool("write").input("content", skipRegex).block("Blocked");
    assertCall(ctx, "write", { path: "/tmp/test.ts", content: "it('passes', () => {});" }, false);
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// Guardrail: typescript-only
// ──────────────────────────────────────────────────────────────────────────────

describe("typescript-only guardrail", () => {
  const tsReason = "this project uses TypeScript. Create `.ts` files instead";

  beforeEach(() => {
    ctx = new GuardrailContext();
  });

  it("blocks write on .js file", () => {
    ctx.tool("write").input("path", ctx.glob("*.js")).block(tsReason);
    assertCall(ctx, "write", { path: "file.js", content: "export {}" }, true);
  });

  it("blocks edit on .js file", () => {
    ctx.tool("edit").input("path", ctx.glob("*.js")).block(tsReason);
    assertCall(ctx, "edit", { path: "lib.js", newText: "export {}" }, true);
  });

  it("allows write on .ts file", () => {
    ctx.tool("write").input("path", ctx.glob("*.js")).block("Blocked");
    assertCall(ctx, "write", { path: "file.ts", content: "export {}" }, false);
  });

  it("allows edit on .ts file", () => {
    ctx.tool("edit").input("path", ctx.glob("*.js")).block("Blocked");
    assertCall(ctx, "edit", { path: "lib.ts", newText: "export {}" }, false);
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// Guardrail: vitest
// ──────────────────────────────────────────────────────────────────────────────

describe("vitest guardrail", () => {
  beforeEach(() => {
    ctx = new GuardrailContext();
  });

  it("blocks bash `bun test`", () => {
    ctx
      .tool("bash")
      .input(
        "command",
        ctx.seq(ctx.bash.word("bun"), ctx.bash.word("test"), ctx.star()),
      )
      .block(
        "`bun test` invokes Bun's built-in test runner, not Vitest. Use `bun vitest run` instead",
      );

    assertCall(ctx, "bash", { command: "bun test" }, true);
  });

  it("allows bash `vitest` (not `bun test`)", () => {
    ctx
      .tool("bash")
      .input(
        "command",
        ctx.seq(ctx.bash.word("bun"), ctx.bash.word("test"), ctx.star()),
      )
      .block("Blocked");

    assertCall(ctx, "bash", { command: "vitest" }, false);
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// Guardrail: no-fallow-ignore
// ──────────────────────────────────────────────────────────────────────────────

describe("no-fallow-ignore guardrail", () => {
  const fallowReason =
    "fallow-ignore comments suppress code quality checks. Fix the underlying issue instead";

  beforeEach(() => {
    ctx = new GuardrailContext();
  });

  it("blocks write with fallow-ignore in content", () => {
    ctx.tool("write").input("content", ctx.regex(/fallow-ignore/)).block(fallowReason);
    assertCall(ctx, "write", {
      path: "/tmp/test.ts",
      content: "// fallow-ignore: FIXME need to fix this",
    }, true);
  });

  it("blocks edit with fallow-ignore in newText", () => {
    ctx.tool("edit").input("newText", ctx.regex(/fallow-ignore/)).block(fallowReason);
    assertCall(ctx, "edit", {
      path: "/tmp/test.ts",
      newText: "// fallow-ignore: old code",
    }, true);
  });

  it("allows write with normal content", () => {
    ctx.tool("write").input("content", ctx.regex(/fallow-ignore/)).block("Blocked");
    assertCall(ctx, "write", { path: "/tmp/test.ts", content: "export {}" }, false);
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// Edge cases: handlePreAction, handlePostRun, handlePostRewrite
// ──────────────────────────────────────────────────────────────────────────────

describe("handlePreAction edge cases", () => {
  beforeEach(() => {
    ctx = new GuardrailContext();
  });

  it("returns undefined for run action with no command", () => {
    ctx
      .tool("bash")
      .input("command", ctx.seq(ctx.bash.word("rm"), ctx.star()))
      .run("");

    assertCall(ctx, "bash", { command: "rm foo.txt" }, false);
  });

  it("returns undefined for run action when timing is not 'before'", () => {
    ctx.preRules.push({
      toolName: "bash",
      inputConditions: [{ key: "command", matcher: ctx.bash.word("rm") }],
      timing: "after",
      action: "run",
      command: "echo hello",
    });

    assertCall(ctx, "bash", { command: "rm foo.txt" }, false);
  });

  it("returns undefined for unknown action", () => {
    ctx.preRules.push({
      toolName: "bash",
      inputConditions: [{ key: "command", matcher: ctx.bash.word("rm") }],
      timing: "before",
      action: "unknown" as any,
    });

    assertCall(ctx, "bash", { command: "rm foo.txt" }, false);
  });

  it("returns undefined for default case in handlePreAction", () => {
    ctx.preRules.push({
      toolName: "bash",
      inputConditions: [{ key: "command", matcher: ctx.bash.word("rm") }],
      timing: "before",
      action: "block",
    });

    // block is handled, but confirm is also handled. Default covers unknown actions.
    const result = ctx.matchCall(makeCall("bash", { command: "rm foo.txt" }));
    expect(result).toBeDefined();
  });
});

describe("handlePostAction edge cases", () => {
  beforeEach(() => {
    ctx = new GuardrailContext();
  });

  it("returns undefined when run action has no command", () => {
    ctx
      .tool("bash")
      .input("command", ctx.seq(ctx.bash.word("rm"), ctx.star()))
      .output(ctx.anyToken())
      .run("");

    assertResult(
      ctx,
      "bash",
      { command: "rm foo.txt" },
      "output",
      false,
    );
  });

  it("returns undefined when run command is undefined", () => {
    ctx
      .tool("bash")
      .input("command", ctx.seq(ctx.bash.word("rm"), ctx.star()))
      .output(ctx.anyToken())
      .run(undefined as any);

    assertResult(
      ctx,
      "bash",
      { command: "rm foo.txt" },
      "output",
      false,
    );
  });

  it("returns undefined when rewriteFn is falsy", () => {
    ctx
      .tool("bash")
      .input("command", ctx.seq(ctx.bash.word("rm"), ctx.star()))
      .output(ctx.anyToken())
      .rewrite(undefined as any);

    assertResult(
      ctx,
      "bash",
      { command: "rm foo.txt" },
      "output",
      false,
    );
  });

  it("returns undefined for unknown post action", () => {
    ctx.postRules.push({
      toolName: "bash",
      inputConditions: [{ key: "command", matcher: ctx.bash.word("rm") }],
      outputMatcher: ctx.anyToken(),
      timing: "after",
      action: "unknown" as any,
    });

    assertResult(
      ctx,
      "bash",
      { command: "rm foo.txt" },
      "output",
      false,
    );
  });
});

describe("handleErrorAction edge cases", () => {
  beforeEach(() => {
    ctx = new GuardrailContext();
  });

  it("handles error_run action", () => {
    ctx
      .tool("bash")
      .error(ctx.regex(/error/i))
      .run("echo 'error occurred'");

    const result = ctx.matchError({
      toolCallId: "1",
      toolName: "bash",
      input: { command: "test" },
      content: [{ type: "text", text: "Error occurred" }],
      isError: true,
    } as unknown as ToolResultEvent);

    expect(result).toMatchObject({
      content: [{ type: "text", text: expect.stringContaining("error occurred") }],
    });
  });

  it("handles error_rewrite action", () => {
    ctx
      .tool("bash")
      .error(ctx.regex(/error/i))
      .rewrite((event) => ({
        content: event.content?.map((c) =>
          c.type === "text"
            ? { ...c, text: c.text.replace(/error/gi, "issue") }
            : c,
        ),
      }));

    const result = ctx.matchError({
      toolCallId: "1",
      toolName: "bash",
      input: { command: "test" },
      content: [{ type: "text", text: "Error in code" }],
      isError: true,
    } as unknown as ToolResultEvent);

    expect(result?.content).toEqual([
      { type: "text", text: "issue in code" },
    ]);
  });

  it("error_run returns undefined when command is empty", () => {
    ctx
      .tool("bash")
      .error(ctx.regex(/error/i))
      .run("");

    assertErrorNoBlock(ctx, { command: "test" }, "Error occurred");
  });

  it("error_rewrite returns undefined when rewriteFn is falsy", () => {
    ctx
      .tool("bash")
      .error(ctx.regex(/error/i))
      .rewrite(undefined as any);

    assertErrorNoBlock(ctx, { command: "test" }, "Error occurred");
  });

  it("returns undefined for unknown error action", () => {
    ctx.errorRules.push({
      toolName: "bash",
      inputConditions: [],
      outputMatcher: ctx.anyToken(),
      timing: "after",
      action: "unknown" as any,
    });

    assertErrorNoBlock(ctx, { command: "test" }, "Error occurred");
  });
});

describe("evaluateConditions edge cases", () => {
  beforeEach(() => {
    ctx
      .tool("bash")
      .input("command", ctx.seq(ctx.bash.word("rm"), ctx.star()))
      .block("Blocked");
  });

  it("returns false when input value is undefined", () => {
    assertCall(ctx, "bash", { command: undefined }, false);
  });

  it("returns false when input value is null", () => {
    assertCall(ctx, "bash", { command: null }, false);
  });

  it("returns false when no input key matches", () => {
    assertCall(ctx, "bash", { cmd: "rm foo.txt" }, false);
  });

  it("returns true when all conditions pass (empty conditions)", () => {
    // This is already tested via other tests, but let's be explicit
    const freshCtx = new GuardrailContext();
    const result = freshCtx.matchCall(makeCall("bash", { command: "rm foo.txt" }));
    expect(result).toBeUndefined(); // no rules defined
  });

  it("handles non-string input values via String()", () => {
    assertCall(ctx, "bash", { command: 42 }, false);
  });
});

describe("matchesOutputRule edge cases", () => {
  beforeEach(() => {
    ctx = new GuardrailContext();
  });

  it("returns true when outputMatcher is null", () => {
    ctx.postRules.push({
      toolName: "bash",
      inputConditions: [{ key: "command", matcher: ctx.bash.word("rm") }],
      outputMatcher: null,
      timing: "after",
      action: "block",
      reason: "Blocked",
    });

    const result = ctx.matchResult(
      makeResult("bash", { command: "rm foo.txt" }, "output"),
    );
    expect(result).toMatchObject({ block: true });
  });

  it("returns true when event.content is missing", () => {
    ctx.postRules.push({
      toolName: "bash",
      inputConditions: [{ key: "command", matcher: ctx.bash.word("rm") }],
      outputMatcher: ctx.anyToken(),
      timing: "after",
      action: "block",
      reason: "Blocked",
    });

    const result = ctx.matchResult({
      toolCallId: "1",
      toolName: "bash",
      input: { command: "rm foo.txt" },
      content: [],
      isError: false,
    } as unknown as ToolResultEvent);

    // With empty content, extractTextFromContent returns ""
    // tokenizeBash("") returns [] (empty segments)
    // segments.length === 0 → returns false → no match
    expect(result).toBeUndefined();
  });

  it("returns true when event.content is undefined", () => {
    ctx.postRules.push({
      toolName: "bash",
      inputConditions: [{ key: "command", matcher: ctx.bash.word("rm") }],
      outputMatcher: ctx.anyToken(),
      timing: "after",
      action: "block",
      reason: "Blocked",
    });

    const result = ctx.matchResult({
      toolCallId: "1",
      toolName: "bash",
      input: { command: "rm foo.txt" },
      content: undefined as any,
      isError: false,
    } as unknown as ToolResultEvent);

    // !event.content → true → matchesOutputRule returns true
    expect(result).toMatchObject({ block: true });
  });

  it("returns false when tokenizer produces no segments", () => {
    ctx.postRules.push({
      toolName: "bash",
      inputConditions: [{ key: "command", matcher: ctx.bash.word("rm") }],
      outputMatcher: ctx.anyToken(),
      timing: "after",
      action: "block",
      reason: "Blocked",
    });

    const result = ctx.matchResult({
      toolCallId: "1",
      toolName: "bash",
      input: { command: "rm foo.txt" },
      content: [{ type: "text", text: "" }],
      isError: false,
    } as unknown as ToolResultEvent);

    expect(result).toBeUndefined();
  });

  it("matches regex against full text even if tokens don't match individually", () => {
    ctx
      .tool("bash")
      .input("command", ctx.bash.word("echo"))
      .output(ctx.regex(/signal 11/i))
      .block("Crash detected");

    const result = ctx.matchResult(
      makeResult("bash", { command: "echo signal 11" }, "signal 11"),
    );
    expect(result).toMatchObject({ block: true });
  });

  it("uses bash tokenizer by default for output matchers without tokenizer", () => {
    ctx
      .tool("bash")
      .input("command", ctx.bash.word("echo"))
      .output(ctx.bash.word("rm"))
      .block("rm in output");

    const result = ctx.matchResult(
      makeResult("bash", { command: "echo rm" }, "rm"),
    );
    expect(result).toMatchObject({ block: true });
  });
});

describe("context helper methods", () => {
  beforeEach(() => {
    ctx = new GuardrailContext();
  });

  it("regex creates regex matcher", () => {
    const m = ctx.regex(/test/);
    expect(typeof m.match).toBe("function");
    expect(typeof m.tryMatch).toBe("function");
  });

  it("glob creates glob matcher", () => {
    const m = ctx.glob("*.ts");
    expect(typeof m.match).toBe("function");
    expect(typeof m.tryMatch).toBe("function");
  });

  it("anyToken creates anyToken matcher", () => {
    const m = ctx.anyToken();
    expect(typeof m.match).toBe("function");
    expect(typeof m.tryMatch).toBe("function");
  });

  it("seq wraps seq", () => {
    const m = ctx.seq(ctx.bash.word("rm"), ctx.star());
    expect(typeof m.match).toBe("function");
    expect(typeof m.tryMatch).toBe("function");
  });

  it("star wraps star", () => {
    const m = ctx.star();
    expect((m as any).__star).toBe(true);
  });

  it("spread wraps spread", () => {
    const m = ctx.spread();
    expect((m as any).__spread).toBe(true);
  });

  it("contains wraps contains", () => {
    const m = ctx.contains(ctx.bash.word("rm"));
    expect(typeof m.match).toBe("function");
  });

  it("builder context has bash, nu, sql matchers", () => {
    expect(typeof ctx.bash.word).toBe("function");
    expect(typeof ctx.nu.word).toBe("function");
    expect(typeof ctx.sql.word).toBe("function");
  });
});

describe("tool().error() with input conditions", () => {
  beforeEach(() => {
    ctx = new GuardrailContext();
  });

  it("error rules with input conditions", () => {
    ctx
      .tool("bash")
      .input("command", ctx.seq(ctx.bash.word("rm"), ctx.star()))
      .error(ctx.regex(/error/i))
      .block("rm error");

    const result = ctx.matchError({
      toolCallId: "1",
      toolName: "bash",
      input: { command: "rm foo.txt" },
      content: [{ type: "text", text: "Error: not found" }],
      isError: true,
    } as unknown as ToolResultEvent);

    expect(result).toMatchObject({ block: true, reason: "rm error" });
  });

  it("error rules with input conditions do not match non-matching input", () => {
    ctx
      .tool("bash")
      .input("command", ctx.seq(ctx.bash.word("rm"), ctx.star()))
      .error(ctx.regex(/error/i))
      .block("rm error");

    const result = ctx.matchError({
      toolCallId: "1",
      toolName: "bash",
      input: { command: "ls" },
      content: [{ type: "text", text: "Error: not found" }],
      isError: true,
    } as unknown as ToolResultEvent);

    expect(result).toBeUndefined();
  });
});
