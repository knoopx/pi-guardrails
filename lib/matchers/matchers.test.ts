import { describe, it, expect } from "vitest";
import type { Token } from "./types.js";
import {
  word,
  seq,
  anyOf,
  repeat,
  repeat1,
  opt,
  star,
  spread,
  prefixed,
  regex,
  exact,
  anyToken,
  path,
  contains,
} from "./index.js";

function t(arr: string[]): Token[] {
  return arr.map((v) => ({ type: "word", value: v }));
}

describe("primitive matchers", () => {
  describe("word", () => {
    it("matches exact word", () => {
      expect(word("rm").match(t(["rm"]))).toBe(true);
      expect(word("rm").match(t(["trash", "."]))).toBe(false);
    });

    it("is case-insensitive", () => {
      expect(word("Rm").match(t(["rm"]))).toBe(true);
      expect(word("RM").match(t(["rm"]))).toBe(true);
    });

    it("matches any of several words", () => {
      const m = word("find", "fd", "grep", "rg");
      expect(m.match(t(["fd"]))).toBe(true);
      expect(m.match(t(["rg"]))).toBe(true);
      expect(m.match(t(["ls"]))).toBe(false);
    });
  });

  describe("regex", () => {
    it("matches token against regex", () => {
      expect(regex(/^\//).match(t(["/home/user"]))).toBe(true);
      expect(regex(/^\//).match(t(["~/home"]))).toBe(false);
    });

    it("does not match substring", () => {
      expect(regex(/^find$/).match(t(["findall"]))).toBe(false);
    });

    it("matches guardrail patterns: Bun.* APIs", () => {
      expect(
        regex(/Bun\.(file|write|spawn|inspect|env|\$)/).match(t(["Bun.file"])),
      ).toBe(true);
      expect(
        regex(/Bun\.(file|write|spawn|inspect|env|\$)/).match(t(["Bun.spawn"])),
      ).toBe(true);
      expect(
        regex(/Bun\.(file|write|spawn|inspect|env|\$)/).match(
          t(["console.log"]),
        ),
      ).toBe(false);
    });

    it("matches guardrail patterns: bun: builtins", () => {
      expect(regex(/bun:/).match(t(["bun:fs"]))).toBe(true);
      expect(regex(/bun:/).match(t(["fs"]))).toBe(false);
    });

    it("matches guardrail patterns: github search", () => {
      expect(
        regex(/^https?:\/\/github\.com\/search/).match(
          t(["https://github.com/search?q=test"]),
        ),
      ).toBe(true);
      expect(
        regex(/^https?:\/\/github\.com\/search/).match(
          t(["https://github.com/user/repo"]),
        ),
      ).toBe(false);
    });
  });

  describe("path", () => {
    it("matches absolute paths", () => {
      expect(path().match(t(["/home/user"]))).toBe(true);
      expect(path().match(t(["/"]))).toBe(true);
    });
  });
});

describe("combinators", () => {
  describe("seq", () => {
    it("matches sequences in order", () => {
      const m = seq(word("find"), word("."), word("-name"));
      expect(m.match(t(["find", ".", "-name"]))).toBe(true);
      expect(m.match(t(["find", "."]))).toBe(false); // not enough tokens
    });

    it("rejects out-of-order", () => {
      const m = seq(word("find"), word("."));
      expect(m.match(t([".", "find"]))).toBe(false);
    });

    it("matches sequence anywhere with star", () => {
      const m = seq(star(), word("SELECT"), star(), word("FROM"), star());
      expect(m.match(t(["SELECT", "*", "FROM", "t"]))).toBe(true);
    });
  });

  describe("anyOf", () => {
    it("matches any of the alternatives", () => {
      const m = anyOf(word("find"), word("fd"));
      expect(m.match(t(["find"]))).toBe(true);
      expect(m.match(t(["fd"]))).toBe(true);
      expect(m.match(t(["grep"]))).toBe(false);
    });

    it("matches guardrail pattern: nix tools", () => {
      const m = anyOf(
        seq(word("nix-hash"), star()),
        seq(word("nix-prefetch-url"), star()),
        seq(word("nix"), word("hash"), star()),
      );
      expect(m.match(t(["nix-hash"]))).toBe(true);
      expect(m.match(t(["nix-prefetch-url", "url"]))).toBe(true);
      expect(m.match(t(["nix", "hash"]))).toBe(true);
      expect(m.match(t(["nix", "search"]))).toBe(false);
    });
  });

  describe("repeat", () => {
    it("matches zero or more", () => {
      const m = repeat(word("-"));
      expect(m.match([])).toBe(true); // zero matches
      expect(m.match(t(["-", "-"]))).toBe(true);
    });

    it("matches in sequence", () => {
      const m = seq(
        word("find"),
        repeat(anyOf(word("-name"), word("-type"), word("."))),
        word("-name"),
      );
      expect(m.match(t(["find", ".", "-name"]))).toBe(true);
    });
  });

  describe("repeat1", () => {
    it("matches one or more", () => {
      const m = repeat1(word("-"));
      expect(m.match(t(["-"]))).toBe(true);
      expect(m.match(t(["-", "-", "-"]))).toBe(true);
      expect(m.match([])).toBe(false);
    });

    it("matches in sequence with prefix", () => {
      const m = seq(
        word("find"),
        repeat1(anyOf(word("-name"), word("-type"))),
        word("."),
      );
      expect(m.match(t(["find", "-name", "-type", "."]))).toBe(true);
      expect(m.match(t(["find", "."]))).toBe(false);
    });
  });

  describe("star", () => {
    it("consumes all remaining tokens", () => {
      const m = seq(word("find"), word("."), star());
      expect(m.match(t(["find", ".", "-name", "*.ts"]))).toBe(true);
      expect(m.match(t(["find", "."]))).toBe(true);
    });
  });

  describe("spread", () => {
    it("matches zero or more via backtracking", () => {
      const m = seq(word("find"), spread(), word("-name"));
      expect(m.match(t(["find", "-name"]))).toBe(true);
      expect(m.match(t(["find", ".", "-name"]))).toBe(true);
      expect(m.match(t(["find", ".", "-type", ".", "-name"]))).toBe(true);
    });

    it("returns false when target not found", () => {
      const m = seq(word("find"), spread(), word("-name"));
      expect(m.match(t(["find", "."]))).toBe(false);
    });
  });

  describe("opt", () => {
    it("matches zero occurrences", () => {
      const m = seq(word("find"), opt(word("-maxdepth")), star());
      expect(m.match(t(["find", "."]))).toBe(true);
      expect(m.match(t(["find", "-maxdepth", "1", "."]))).toBe(true);
    });
  });

  describe("exact", () => {
    it("matches exactly N tokens", () => {
      const m = exact(3);
      expect(m.match(t(["a", "b", "c"]))).toBe(true);
      expect(m.match(t(["a", "b"]))).toBe(false);
      expect(m.match(t(["a", "b", "c", "d"]))).toBe(false);
    });
  });

  describe("prefixed", () => {
    it("matches word followed by anything", () => {
      const m = prefixed("npm");
      expect(m.match(t(["npm"]))).toBe(true);
      expect(m.match(t(["npm", "install"]))).toBe(true);
      expect(m.match(t(["npm", "install", "lodash"]))).toBe(true);
    });

    it("matches multi-word prefix", () => {
      const m = prefixed("git", "commit");
      expect(m.match(t(["git", "commit", "-m", "message"]))).toBe(true);
      // 'git status' starts with 'git', which is one of the prefix words
      expect(m.match(t(["git", "status"]))).toBe(true);
    });

    it("does not match commands without prefix words", () => {
      const m = prefixed("rm");
      expect(m.match(t(["rm", "-rf", "/"]))).toBe(true);
      // 'form' is not exactly 'rm', so it does not match (exact word matching)
      expect(m.match(t(["form", "file"]))).toBe(false);
    });
  });

  describe("anyToken", () => {
    it("matches any single token", () => {
      const m = anyToken();
      expect(m.match(t(["hello"]))).toBe(true);
      expect(m.match(t(["-f"]))).toBe(true);
      expect(m.match(t(["/path"]))).toBe(true);
    });

    it("does not match empty", () => {
      const m = anyToken();
      expect(m.match([])).toBe(false);
    });
  });

  describe("contains", () => {
    it("matches target anywhere in tokens", () => {
      const m = contains(word("SELECT"));
      expect(m.match(t(["SELECT", "*", "FROM", "t"]))).toBe(true);
      expect(m.match(t(["INSERT", "INTO", "t", "SELECT"]))).toBe(true);
      expect(m.match(t(["FROM", "t"]))).toBe(false);
    });

    it("matches multi-token target", () => {
      const m = contains(seq(word("FROM"), word("read_csv_auto")));
      expect(
        m.match(t(["SELECT", "*", "FROM", "read_csv_auto", "('file')"])),
      ).toBe(true);
      // word uses substring — 'read_csv_auto' contains 'from', so this matches
      expect(m.match(t(["SELECT", "read_csv_auto", "FROM", "t"]))).toBe(true);
    });

    it("matches guardrail pattern: npm", () => {
      const m = contains(word("npm"));
      expect(m.match(t(["npm", "install"]))).toBe(true);
      expect(m.match(t(["npm"]))).toBe(true);
      expect(m.match(t(["npx", "install"]))).toBe(false);
    });

    it("matches guardrail pattern: npx", () => {
      const m = contains(word("npx"));
      expect(m.match(t(["npx", "eslint"]))).toBe(true);
      expect(m.match(t(["bunx", "eslint"]))).toBe(false);
    });
  });
});

describe("SQL helpers via ctx.sql.word()", () => {
  it("sql word matches function names", () => {
    const m = seq(word("read_csv_auto"), regex(/^\(/));
    expect(m.match(t(["read_csv_auto", "('file.csv')"]))).toBe(true);
    expect(m.match(t(["SELECT", "read_csv_auto"]))).toBe(false);
  });

  it("sql FROM word matches FROM clause", () => {
    const m = seq(word("FROM"), word("read_csv_auto"), regex(/^\(/));
    expect(m.match(t(["FROM", "read_csv_auto", "('file.csv')"]))).toBe(true);
    expect(m.match(t(["FROM", "some_table"]))).toBe(false);
  });
});

describe("integration: read_csv_auto with ~ path", () => {
  /**
   * Pattern: star() + word("read_csv_auto") + star()
   * Matches any command containing read_csv_auto anywhere.
   */
  const m = seq(star(), word("read_csv_auto"), star());

  it("matches read_csv_auto with ~ path", () => {
    expect(
      m.match(t(["SELECT", "*", "FROM", "read_csv_auto", "('~/path.csv')"])),
    ).toBe(true);
  });

  it("matches read_csv_auto with full path", () => {
    expect(
      m.match(t(["SELECT", "*", "FROM", "read_csv_auto", "('file.csv')"])),
    ).toBe(true);
  });

  it("matches ~ anywhere in tokens", () => {
    expect(
      regex(/~/).match(
        t(["SELECT", "*", "FROM", "read_csv_auto", "('~/path.csv')"]),
      ),
    ).toBe(true);
  });

  it("does NOT match word('.') as tilde", () => {
    // word("~") only matches the exact token "~", not ".pi/records"
    expect(
      contains(word("~")).match(
        t([
          "SELECT",
          "*",
          "FROM",
          "read_csv_auto",
          "('/home/user/.pi/records.csv')",
        ]),
      ),
    ).toBe(false);
  });
});

describe("integration: guardrail patterns", () => {
  it("no-rm: seq(word('rm'), star()) blocks rm commands", () => {
    const m = seq(word("rm"), star());
    expect(m.match(t(["rm", "foo.txt"]))).toBe(true);
    expect(m.match(t(["rm", "-rf", "/tmp"]))).toBe(true);
    expect(m.match(t(["find", "-exec", "rm", "{}"]))).toBe(false); // starts with find
  });

  it("no-global-installs: seq(word('bun'), word('add'), word('-g'), star())", () => {
    const m = seq(word("bun"), word("add"), word("-g"), star());
    expect(m.match(t(["bun", "add", "-g", "lodash"]))).toBe(true);
    expect(m.match(t(["bun", "add", "lodash"]))).toBe(false);
  });

  it("glob is on GuardrailContext, not in matchers module", () => {
    // glob pattern matching uses picomatch and is available via ctx.glob()
    // Not tested here as it's part of GuardrailContext, not the matchers module.
    // Test glob behavior in context.test.ts via actual guardrails (tsv-safety, typescript-only, lock-files).
  });

  it("duckdb-syntax: seq(spread, 'AUTO_DETECT', spread, 'ON', star())", () => {
    const m = seq(spread(), word("AUTO_DETECT"), spread(), word("ON"), star());
    expect(m.match(t(["SET", "AUTO_DETECT", "ON"]))).toBe(true);
    expect(m.match(t(["SELECT", "AUTO_DETECT", "ON", "FROM", "t"]))).toBe(true);
    expect(m.match(t(["SET", "AUTO_DETECT", "OFF"]))).toBe(false);
  });

  it("no-systemd: seq(word('systemctl'), star())", () => {
    const m = seq(word("systemctl"), star());
    expect(m.match(t(["systemctl", "start", "service"]))).toBe(true);
    expect(m.match(t(["systemctl"]))).toBe(true);
    expect(m.match(t(["pgrep", "-a", "service"]))).toBe(false);
  });

  it("podman: anyOf(word('docker'), word('docker-compose')) + star()", () => {
    const m = seq(anyOf(word("docker"), word("docker-compose")), star());
    expect(m.match(t(["docker", "ps"]))).toBe(true);
    expect(m.match(t(["docker-compose", "up"]))).toBe(true);
    expect(m.match(t(["podman", "ps"]))).toBe(false);
  });
});

describe("spread deep backtracking", () => {
  it("spread matches zero tokens between two fixed words", () => {
    const m = seq(word("a"), spread(), word("b"));
    expect(m.match(t(["a", "b"]))).toBe(true);
  });

  it("spread matches all tokens between two fixed words", () => {
    const m = seq(word("a"), spread(), word("b"));
    expect(m.match(t(["a", "x", "y", "z", "b"]))).toBe(true);
  });

  it("spread returns false when target not at end", () => {
    const m = seq(word("a"), spread(), word("b"));
    expect(m.match(t(["a", "x", "y"]))).toBe(false);
  });

  it("spread with star after target", () => {
    const m = seq(word("a"), spread(), word("b"), star());
    expect(m.match(t(["a", "x", "b", "c"]))).toBe(true);
  });
});

describe("repeat1 edge cases", () => {
  it("returns ok:false when first match fails", () => {
    const m = repeat1(word("rm"));
    expect(m.match(t(["ls"]))).toBe(false);
  });

  it("handles firstConsumed === 0 edge case", () => {
    // Create a matcher that matches but consumes 0 tokens
    const zeroConsumingMatcher = {
      match: (tokens: any[]) => tokens.length > 0,
      tryMatch: (tokens: any[], from: number) => {
        if (from < tokens.length) return { ok: true, consumed: 0 };
        return { ok: false };
      },
    };
    const m = repeat1(zeroConsumingMatcher);
    // First match succeeds but consumed=0, so repeat1 returns { ok: true, consumed: 0 }.
    // makeExact checks consumed === tokens.length: 0 !== 1 → false.
    // On empty tokens: first tryMatch fails (from >= tokens.length) → ok: false → match: false.
    expect(m.match([])).toBe(false);
    expect(m.match(t(["a"]))).toBe(false);
  });

  it("repeats until no more matches", () => {
    const m = repeat1(word("-"));
    expect(m.match(t(["-", "-", "-"]))).toBe(true);
  });
});

describe("exact edge cases", () => {
  it("fails when n exceeds token length", () => {
    const m = exact(5);
    expect(m.match(t(["a", "b", "c"]))).toBe(false);
  });

  it("matches n=0", () => {
    const m = exact(0);
    expect(m.match([])).toBe(true);
  });

  it("fails for n=0 when tokens exist", () => {
    const m = exact(0);
    expect(m.match(t(["a"]))).toBe(false);
  });
});

describe("contains tryMatch", () => {
  it("tryMatch finds target and returns consumed=tokens.length", () => {
    const m = contains(word("SELECT"));
    const result = m.tryMatch(t(["FROM", "SELECT", "FROM"]), 0);
    expect(result).toEqual({ ok: true, consumed: 3 });
  });

  it("tryMatch returns ok:false when target not found", () => {
    const m = contains(word("SELECT"));
    const result = m.tryMatch(t(["FROM", "INSERT"]), 0);
    expect(result).toEqual({ ok: false });
  });

  it("tryMatch starts from given offset", () => {
    const m = contains(word("FROM"));
    const result = m.tryMatch(t(["SELECT", "FROM"]), 1);
    expect(result).toEqual({ ok: true, consumed: 2 });
  });

  it("tryMatch returns ok:false when target is before offset", () => {
    const m = contains(word("SELECT"));
    const result = m.tryMatch(t(["SELECT", "FROM"]), 1);
    // SELECT is at position 0, offset is 1, so it won't find it starting from 1
    expect(result).toEqual({ ok: false });
  });
});

describe("seq with nested spread/star/repeat backtracking", () => {
  it("backtracks when spread fails to find next matcher", () => {
    const m = seq(word("a"), spread(), word("b"), spread(), word("c"));
    expect(m.match(t(["a", "b", "c"]))).toBe(true);
  });

  it("repeat backtracks when following matcher fails", () => {
    const m = seq(word("a"), repeat(word("x")), word("b"));
    expect(m.match(t(["a", "x", "x", "b"]))).toBe(true);
    expect(m.match(t(["a", "x", "x"]))).toBe(false);
  });

  it("star backtracks when following matcher needs tokens", () => {
    const m = seq(word("a"), star(), word("b"));
    expect(m.match(t(["a", "x", "y", "b"]))).toBe(true);
    expect(m.match(t(["a", "x", "y"]))).toBe(false);
  });
});

describe("prefixed edge cases", () => {
  it("prefixed with multiple words matches first word only", () => {
    // prefixed("git", "commit") should match "git commit -m msg"
    // but also "git status" because star() after the word sequence
    // allows anything after the prefix words
    const m = prefixed("git", "commit");
    expect(m.match(t(["git", "commit", "-m", "msg"]))).toBe(true);
    expect(m.match(t(["git", "status"]))).toBe(true);
  });
});

describe("seq with getInnerTokenizer returns undefined", () => {
  it("seq without tokenizer returns no __tokenizer", () => {
    const m = seq(word("a"), word("b"));
    expect((m as any).__tokenizer).toBeUndefined();
  });

  it("anyOf without tokenizer returns no __tokenizer", () => {
    const m = anyOf(word("a"), word("b"));
    expect((m as any).__tokenizer).toBeUndefined();
  });

  it("repeat without tokenizer returns no __tokenizer but has __repeat", () => {
    const m = repeat(word("a"));
    expect((m as any).__tokenizer).toBeUndefined();
    expect((m as any).__repeat).toBe(true);
  });

  it("repeat1 without tokenizer returns no __tokenizer", () => {
    const m = repeat1(word("a"));
    expect((m as any).__tokenizer).toBeUndefined();
  });

  it("opt without tokenizer returns no __tokenizer", () => {
    const m = opt(word("a"));
    expect((m as any).__tokenizer).toBeUndefined();
  });

  it("contains without tokenizer returns no __tokenizer", () => {
    const m = contains(word("a"));
    expect((m as any).__tokenizer).toBeUndefined();
  });
});
