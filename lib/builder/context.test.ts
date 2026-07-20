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

  it("does not block unrelated commands", () => {
    ctx
      .tool("bash")
      .input("command", ctx.seq(ctx.bash.word("rm"), ctx.star()))
      .block("Blocked");

    const result = ctx.matchCall(
      makeCall("bash", { command: "find / -name '*.tmp' -exec rm {} +" }),
    );
    expect(result).toBeUndefined();
  });

  it("does not match when first token doesn't match", () => {
    ctx
      .tool("bash")
      .input("command", ctx.seq(ctx.bash.word("rm"), ctx.star()))
      .block("Blocked");

    const result = ctx.matchCall(makeCall("bash", { command: "ls -la" }));
    expect(result).toBeUndefined();
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
    ctx = new GuardrailContext();
  });

  it("blocks result matching output pattern with input condition", () => {
    ctx
      .tool("bash")
      .input("command", ctx.seq(ctx.bash.word("rm"), ctx.star()))
      .output(ctx.regex(/~/))
      .block("Result contains ~ — should expand to full path");

    const result = ctx.matchResult(
      makeResult("bash", { command: "rm ~/data.csv" }, "~/data.csv output"),
    );
    expect(result).toMatchObject({ block: true });
  });

  it("does not block when output does not match", () => {
    ctx
      .tool("bash")
      .input("command", ctx.seq(ctx.bash.word("rm"), ctx.star()))
      .output(ctx.regex(/~/))
      .block("Result contains ~ — should expand to full path");

    const result = ctx.matchResult(
      makeResult(
        "bash",
        { command: "rm /home/user/data.csv" },
        "/home/user/data.csv output",
      ),
    );
    expect(result).toBeUndefined();
  });

  it("does not block when input condition does not match", () => {
    ctx
      .tool("bash")
      .input("command", ctx.seq(ctx.bash.word("rm"), ctx.star()))
      .output(ctx.regex(/~/))
      .block("Result contains ~ — should expand to full path");

    const result = ctx.matchResult(
      makeResult("bash", { command: "ls ~" }, "~/data.csv output"),
    );
    expect(result).toBeUndefined();
  });
});

describe("GuardrailContext — post-execution confirm", () => {
  beforeEach(() => {
    ctx = new GuardrailContext();
  });

  it("confirms result matching output pattern with input condition", () => {
    ctx
      .tool("bash")
      .input("command", ctx.seq(ctx.bash.word("rm"), ctx.star()))
      .output(ctx.regex(/~/))
      .confirm("Confirm the rm result");

    const result = ctx.matchResult(
      makeResult("bash", { command: "rm ~/data.csv" }, "~/data.csv output"),
    );
    expect(result).toMatchObject({ block: true });
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

    const result = ctx.matchResult(
      makeResult(
        "bash",
        { command: "rm /home/user/data.csv" },
        "/home/user/data.csv output",
      ),
    );
    expect(result).toBeUndefined();
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
    ctx = new GuardrailContext();
  });

  it("matches bun add -g pattern with run command", () => {
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

    const result = ctx.matchCall(
      makeCall("bash", { command: "bun add -g lodash" }),
    );
    expect(result).toMatchObject({
      block: true,
      reason: "Command blocked: echo 'Global install blocked!'",
    });
  });

  it("run action does not trigger for unrelated commands", () => {
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

    const result = ctx.matchCall(makeCall("bash", { command: "ls -la" }));
    expect(result).toBeUndefined();
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
  });

  it("matches rule with multiple input conditions", () => {
    ctx
      .tool("bash")
      .input("command", ctx.seq(ctx.bash.word("rm"), ctx.star()))
      .input("file", ctx.bash.word("DELETE_ME"))
      .block("Blocked");

    const result = ctx.matchCall(
      makeCall("bash", { command: "rm DELETE_ME", file: "DELETE_ME" }),
    );
    expect(result).toMatchObject({ block: true });
  });

  it("returns undefined when second input condition fails", () => {
    ctx
      .tool("bash")
      .input("command", ctx.seq(ctx.bash.word("rm"), ctx.star()))
      .input("file", ctx.bash.word("DELETE_ME"))
      .block("Blocked");

    const result = ctx.matchCall(makeCall("bash", { command: "rm DELETE_ME" }));
    expect(result).toBeUndefined();
  });
});

describe("Fluent API — output + chained inputs", () => {
  beforeEach(() => {
    ctx = new GuardrailContext();
  });

  it("matches output rule with multiple input conditions", () => {
    ctx
      .tool("bash")
      .input("command", ctx.seq(ctx.bash.word("rm"), ctx.star()))
      .input("file", ctx.bash.word("DELETE_ME"))
      .output(ctx.regex(/~/))
      .block("Result contains ~ — should expand to full path");

    const result = ctx.matchResult(
      makeResult(
        "bash",
        { command: "rm ~/DELETE_ME", file: "DELETE_ME" },
        "~/DELETE_ME output",
      ),
    );
    expect(result).toMatchObject({ block: true });
  });

  it("returns undefined when second input condition fails", () => {
    ctx
      .tool("bash")
      .input("command", ctx.seq(ctx.bash.word("rm"), ctx.star()))
      .input("file", ctx.bash.word("DELETE_ME"))
      .output(ctx.regex(/~/))
      .block("Result contains ~ — should expand to full path");

    const result = ctx.matchResult(
      makeResult(
        "bash",
        { command: "rm /home/user/DELETE_ME" },
        "~/DELETE_ME output",
      ),
    );
    expect(result).toBeUndefined();
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

    const result = ctx.matchCall(makeCall("bash", { command: "cm --version" }));
    expect(result).toMatchObject({ block: true });
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

    const result = ctx.matchCall(
      makeCall("bash", { command: "cm deps --circular foo" }),
    );
    expect(result).toMatchObject({ block: true });
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

    const result = ctx.matchCall(
      makeCall("bash", { command: "cm callers symbol foo" }),
    );
    expect(result).toMatchObject({ block: true });
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

    const result = ctx.matchCall(makeCall("bash", { command: "cm map /path" }));
    expect(result).toMatchObject({ block: true });
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

    const result = ctx.matchCall(
      makeCall("bash", { command: "jj-hunk --version" }),
    );
    expect(result).toMatchObject({ block: true });
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

    const result = ctx.matchCall(makeCall("bash", { command: "jj-hunk -V" }));
    expect(result).toMatchObject({ block: true });
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

    const result = ctx.matchCall(
      makeCall("bash", { command: "jj-hunk split --include foo" }),
    );
    expect(result).toMatchObject({ block: true });
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

    const result = ctx.matchCall(
      makeCall("bash", { command: "kuva scatter --x-col price" }),
    );
    expect(result).toMatchObject({ block: true });
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

    const result = ctx.matchCall(
      makeCall("bash", { command: "kuva --y-col name" }),
    );
    expect(result).toMatchObject({ block: true });
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

    const result = ctx.matchCall(
      makeCall("bash", { command: "kuva --label-col label" }),
    );
    expect(result).toMatchObject({ block: true });
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

    const result = ctx.matchCall(
      makeCall("bash", { command: "kuva --color-by col" }),
    );
    expect(result).toMatchObject({ block: true });
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

    const result = ctx.matchCall(
      makeCall("bash", { command: "kuva --legend" }),
    );
    expect(result).toMatchObject({ block: true });
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

    const result = ctx.matchCall(
      makeCall("bash", { command: "kuva --agg avg" }),
    );
    expect(result).toMatchObject({ block: true });
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

    const result = ctx.matchCall(
      makeCall("bash", { command: "kuva --rotate-labels" }),
    );
    expect(result).toMatchObject({ block: true });
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

    const result = ctx.matchCall(
      makeCall("bash", { command: 'kuva bar --color "red"' }),
    );
    expect(result).toMatchObject({ block: true });
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

    const result = ctx.matchCall(
      makeCall("bash", { command: "kuva --size-col size" }),
    );
    expect(result).toMatchObject({ block: true });
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

    const result = ctx.matchCall(
      makeCall("bash", { command: "kuva --color-col color" }),
    );
    expect(result).toMatchObject({ block: true });
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

    const result = ctx.matchCall(
      makeCall("bash", { command: "kuva --value-col value" }),
    );
    expect(result).toMatchObject({ block: true });
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

    const result = ctx.matchCall(
      makeCall("bash", { command: "kuva --group-col group" }),
    );
    expect(result).toMatchObject({ block: true });
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

    const result = ctx.matchCall(
      makeCall("write", {
        path: "/tmp/test.ts",
        content:
          "// eslint-disable-next-line @typescript-eslint/no-explicit-any\nconst x: any = 1",
      }),
    );
    expect(result).toMatchObject({ block: true });
  });

  it("allows write with normal content", () => {
    ctx
      .tool("write")
      .input("content", ctx.regex(/eslint-disable/))
      .block("Blocked");

    const result = ctx.matchCall(
      makeCall("write", { path: "/tmp/test.ts", content: "console.log('hi')" }),
    );
    expect(result).toBeUndefined();
  });

  it("blocks edit with eslint-disable in newText", () => {
    ctx
      .tool("edit")
      .input("newText", ctx.regex(/eslint-disable/))
      .block("disabling lint rules hides issues. Fix the code instead");

    const result = ctx.matchCall(
      makeCall("edit", {
        path: "/tmp/test.ts",
        newText: "// eslint-disable-next-line",
      }),
    );
    expect(result).toMatchObject({ block: true });
  });

  it("allows edit without eslint-disable", () => {
    ctx
      .tool("edit")
      .input("newText", ctx.regex(/eslint-disable/))
      .block("Blocked");

    const result = ctx.matchCall(
      makeCall("edit", {
        path: "/tmp/test.ts",
        newText: "console.log('hello')",
      }),
    );
    expect(result).toBeUndefined();
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

    const result = ctx.matchCall(
      makeCall("write", { path: "package-lock.json", content: "{}" }),
    );
    expect(result).toMatchObject({ block: true });
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

    const result = ctx.matchCall(
      makeCall("write", { path: "bun.lockb", content: "binary" }),
    );
    expect(result).toMatchObject({ block: true });
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

    const result = ctx.matchCall(
      makeCall("write", { path: "Cargo.lock", content: "locked" }),
    );
    expect(result).toMatchObject({ block: true });
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

    const result = ctx.matchCall(
      makeCall("edit", { path: "yarn.lock", newText: "lockfileVersion: 6" }),
    );
    expect(result).toMatchObject({ block: true });
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

    const result = ctx.matchCall(
      makeCall("write", { path: "data.json", content: "{}" }),
    );
    expect(result).toBeUndefined();
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

    const result = ctx.matchCall(makeCall("bash", { command: "nh build" }));
    expect(result).toMatchObject({ block: true });
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

    const result = ctx.matchCall(makeCall("bash", { command: "nh switch" }));
    expect(result).toMatchObject({ block: true });
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

    const result = ctx.matchCall(
      makeCall("edit", { path: ".git/config", newText: "new" }),
    );
    expect(result).toMatchObject({ block: true });
  });

  it("blocks write on .git/config", () => {
    ctx
      .tool("write")
      .input("path", ctx.regex(/^\.git\//))
      .block(
        "VCS internals — direct modification can corrupt history. Use git/jj commands instead",
      );

    const result = ctx.matchCall(
      makeCall("write", { path: ".git/config", content: "config" }),
    );
    expect(result).toMatchObject({ block: true });
  });

  it("blocks edit on .jj/repo/config.toml", () => {
    ctx
      .tool("edit")
      .input("path", ctx.regex(/^\.jj\//))
      .block(
        "VCS internals — direct modification can corrupt history. Use git/jj commands instead",
      );

    const result = ctx.matchCall(
      makeCall("edit", { path: ".jj/repo/config.toml", newText: "toml" }),
    );
    expect(result).toMatchObject({ block: true });
  });

  it("blocks write on .jj/repo/config.toml", () => {
    ctx
      .tool("write")
      .input("path", ctx.regex(/^\.jj\//))
      .block(
        "VCS internals — direct modification can corrupt history. Use git/jj commands instead",
      );

    const result = ctx.matchCall(
      makeCall("write", { path: ".jj/repo/config.toml", content: "toml" }),
    );
    expect(result).toMatchObject({ block: true });
  });

  it("blocks edit on ~/.config/nvim/init.lua", () => {
    ctx
      .tool("edit")
      .input("path", ctx.regex(/^~\/.config\//))
      .block(
        "System config directory — modifying config files directly can break applications",
      );

    const result = ctx.matchCall(
      makeCall("edit", { path: "~/.config/nvim/init.lua", newText: "lua" }),
    );
    expect(result).toMatchObject({ block: true });
  });

  it("blocks write on ~/.config/nvim/init.lua", () => {
    ctx
      .tool("write")
      .input("path", ctx.regex(/^~\/.config\//))
      .block(
        "System config directory — modifying config files directly can break applications",
      );

    const result = ctx.matchCall(
      makeCall("write", { path: "~/.config/nvim/init.lua", content: "lua" }),
    );
    expect(result).toMatchObject({ block: true });
  });

  it("blocks edit on ~/.local/share/foo/bar", () => {
    ctx
      .tool("edit")
      .input("path", ctx.regex(/^~\/.local\//))
      .block(
        "System local data directory — modifying files here can break installed applications",
      );

    const result = ctx.matchCall(
      makeCall("edit", { path: "~/.local/share/foo/bar", newText: "data" }),
    );
    expect(result).toMatchObject({ block: true });
  });

  it("blocks write on ~/.local/share/foo/bar", () => {
    ctx
      .tool("write")
      .input("path", ctx.regex(/^~\/.local\//))
      .block(
        "System local data directory — modifying files here can break installed applications",
      );

    const result = ctx.matchCall(
      makeCall("write", { path: "~/.local/share/foo/bar", content: "data" }),
    );
    expect(result).toMatchObject({ block: true });
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

    const result = ctx.matchCall(
      makeCall("write", { path: "src/main.ts", content: "export {}" }),
    );
    expect(result).toBeUndefined();
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// Guardrail: testing
// ──────────────────────────────────────────────────────────────────────────────

describe("testing guardrail", () => {
  beforeEach(() => {
    ctx = new GuardrailContext();
  });

  it("blocks write with .skip(", () => {
    ctx
      .tool("write")
      .input(
        "content",
        ctx.regex(/\.skip\b|\bdescribe\.skip\b|\bxdescribe\b|\bxit\(/),
      )
      .block(
        "skipped tests create blind spots. Fix, delete, or use `it.todo()` instead",
      );

    const result = ctx.matchCall(
      makeCall("write", {
        path: "/tmp/test.ts",
        content: "it.skip('failing test', () => {});",
      }),
    );
    expect(result).toMatchObject({ block: true });
  });

  it("blocks write with describe.skip", () => {
    ctx
      .tool("write")
      .input(
        "content",
        ctx.regex(/\.skip\b|\bdescribe\.skip\b|\bxdescribe\b|\bxit\(/),
      )
      .block(
        "skipped tests create blind spots. Fix, delete, or use `it.todo()` instead",
      );

    const result = ctx.matchCall(
      makeCall("write", {
        path: "/tmp/test.ts",
        content: "describe.skip('skipped suite', () => {});",
      }),
    );
    expect(result).toMatchObject({ block: true });
  });

  it("blocks edit with xdescribe", () => {
    ctx
      .tool("edit")
      .input(
        "newText",
        ctx.regex(/\.skip\b|\bdescribe\.skip\b|\bxdescribe\b|\bxit\(/),
      )
      .block(
        "skipped tests create blind spots. Fix, delete, or use `it.todo()` instead",
      );

    const result = ctx.matchCall(
      makeCall("edit", {
        path: "/tmp/test.ts",
        newText: "xdescribe('suite', () => {})",
      }),
    );
    expect(result).toMatchObject({ block: true });
  });

  it("blocks write with xit(", () => {
    ctx
      .tool("write")
      .input(
        "content",
        ctx.regex(/\.skip\b|\bdescribe\.skip\b|\bxdescribe\b|\bxit\(/),
      )
      .block(
        "skipped tests create blind spots. Fix, delete, or use `it.todo()` instead",
      );

    const result = ctx.matchCall(
      makeCall("write", {
        path: "/tmp/test.ts",
        content: "xit('failing test', () => {})",
      }),
    );
    expect(result).toMatchObject({ block: true });
  });

  it("allows write with normal test content", () => {
    ctx
      .tool("write")
      .input(
        "content",
        ctx.regex(/\.skip\b|\bdescribe\.skip\b|\bxdescribe\b|\bxit\(/),
      )
      .block("Blocked");

    const result = ctx.matchCall(
      makeCall("write", {
        path: "/tmp/test.ts",
        content: "it('passes', () => {});",
      }),
    );
    expect(result).toBeUndefined();
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// Guardrail: typescript-only
// ──────────────────────────────────────────────────────────────────────────────

describe("typescript-only guardrail", () => {
  beforeEach(() => {
    ctx = new GuardrailContext();
  });

  it("blocks write on .js file", () => {
    ctx
      .tool("write")
      .input("path", ctx.glob("*.js"))
      .block("this project uses TypeScript. Create `.ts` files instead");

    const result = ctx.matchCall(
      makeCall("write", { path: "file.js", content: "export {}" }),
    );
    expect(result).toMatchObject({ block: true });
  });

  it("blocks edit on .js file", () => {
    ctx
      .tool("edit")
      .input("path", ctx.glob("*.js"))
      .block("this project uses TypeScript. Create `.ts` files instead");

    const result = ctx.matchCall(
      makeCall("edit", { path: "lib.js", newText: "export {}" }),
    );
    expect(result).toMatchObject({ block: true });
  });

  it("allows write on .ts file", () => {
    ctx.tool("write").input("path", ctx.glob("*.js")).block("Blocked");

    const result = ctx.matchCall(
      makeCall("write", { path: "file.ts", content: "export {}" }),
    );
    expect(result).toBeUndefined();
  });

  it("allows edit on .ts file", () => {
    ctx.tool("edit").input("path", ctx.glob("*.js")).block("Blocked");

    const result = ctx.matchCall(
      makeCall("edit", { path: "lib.ts", newText: "export {}" }),
    );
    expect(result).toBeUndefined();
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

    const result = ctx.matchCall(makeCall("bash", { command: "bun test" }));
    expect(result).toMatchObject({ block: true });
  });

  it("allows bash `vitest` (not `bun test`)", () => {
    ctx
      .tool("bash")
      .input(
        "command",
        ctx.seq(ctx.bash.word("bun"), ctx.bash.word("test"), ctx.star()),
      )
      .block("Blocked");

    const result = ctx.matchCall(makeCall("bash", { command: "vitest" }));
    expect(result).toBeUndefined();
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// Guardrail: no-fallow-ignore
// ──────────────────────────────────────────────────────────────────────────────

describe("no-fallow-ignore guardrail", () => {
  beforeEach(() => {
    ctx = new GuardrailContext();
  });

  it("blocks write with fallow-ignore in content", () => {
    ctx
      .tool("write")
      .input("content", ctx.regex(/fallow-ignore/))
      .block(
        "fallow-ignore comments suppress code quality checks. Fix the underlying issue instead",
      );

    const result = ctx.matchCall(
      makeCall("write", {
        path: "/tmp/test.ts",
        content: "// fallow-ignore: FIXME need to fix this",
      }),
    );
    expect(result).toMatchObject({ block: true });
  });

  it("blocks edit with fallow-ignore in newText", () => {
    ctx
      .tool("edit")
      .input("newText", ctx.regex(/fallow-ignore/))
      .block(
        "fallow-ignore comments suppress code quality checks. Fix the underlying issue instead",
      );

    const result = ctx.matchCall(
      makeCall("edit", {
        path: "/tmp/test.ts",
        newText: "// fallow-ignore: old code",
      }),
    );
    expect(result).toMatchObject({ block: true });
  });

  it("allows write with normal content", () => {
    ctx
      .tool("write")
      .input("content", ctx.regex(/fallow-ignore/))
      .block("Blocked");

    const result = ctx.matchCall(
      makeCall("write", { path: "/tmp/test.ts", content: "export {}" }),
    );
    expect(result).toBeUndefined();
  });
});
