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
