import { describe, it, expect } from "vitest";
import { tokenizeNushell } from "./nushell";
import { token } from "../../test-helpers.js";

// Token type helpers for common nu-tokenizer outputs
const w = (...v: string[]) => v.map((x) => token("word", x));
const str = (...v: string[]) => v.map((x) => token("string", x));
const vari = (...v: string[]) => v.map((x) => token("variable", x));
const op = (...v: string[]) => v.map((x) => token("operator", x));

describe("tokenizeNushell", () => {
  it("returns empty for empty and whitespace", () => {
    expect(tokenizeNushell("")).toEqual([]);
    expect(tokenizeNushell("   ")).toEqual([]);
  });

  describe("simple commands", () => {
    it("tokenizes a simple command", () => {
      expect(tokenizeNushell("ls -la")).toEqual([w("ls", "-la")]);
    });

    it("tokenizes a command with arguments", () => {
      expect(tokenizeNushell("ls -la --all")).toEqual([w("ls", "-la", "--all")]);
    });
  });

  describe("pipe splitting", () => {
    it("splits on single pipe", () => {
      // Pipe splits segments, but not tokens within a segment
      expect(tokenizeNushell("ls | grep foo")).toEqual([w("ls"), w("grep", "foo")]);
    });

    it("splits on multiple pipes", () => {
      expect(tokenizeNushell("ls | grep foo | sort")).toEqual([w("ls"), w("grep", "foo"), w("sort")]);
    });

    it("keeps || as a token in the next segment", () => {
      // || is NOT a segment splitter; it stays as a token in its segment
      expect(tokenizeNushell("fail || succeed")).toEqual([w("fail"), [...op("||"), ...w("succeed")]]);
    });

    it("splits on && (segment separator, not a token)", () => {
      // && is a segment splitter
      expect(tokenizeNushell("a && b")).toEqual([w("a"), w("b")]);
    });
  });

  describe("double-quoted strings", () => {
    it("parses double-quoted string as single token", () => {
      expect(tokenizeNushell('echo "hello world"')).toEqual([[token("word", "echo"), token("string", "hello world")]]);
    });

    it("handles escape sequences in double quotes", () => {
      // \\n in double quotes → backslash consumed, next char 'n' pushed
      expect(tokenizeNushell('echo "line1\\nline2"')).toEqual([[token("word", "echo"), token("string", "line1nline2")]]);
    });

    it("handles backslash at end of double-quoted string", () => {
      expect(tokenizeNushell('echo "end\\')).toEqual([[token("word", "echo"), token("string", "end\\")]]);
    });
  });

  describe("single-quoted strings", () => {
    it("parses single-quoted string as single token", () => {
      expect(tokenizeNushell("echo 'hello world'")).toEqual([[token("word", "echo"), token("string", "hello world")]]);
    });

    it("does not process escapes in single quotes", () => {
      expect(tokenizeNushell("echo '\\n'")).toEqual([[token("word", "echo"), token("string", "\\n")]]);
    });

    it("handles escaped single quotes ('')", () => {
      expect(tokenizeNushell("echo 'it''s'")).toEqual([[token("word", "echo"), token("string", "it's")]]);
    });
  });

  describe("backtick strings", () => {
    it("parses backtick string as single token", () => {
      expect(tokenizeNushell("echo `hello`")).toEqual([[token("word", "echo"), token("string", "hello")]]);
    });

    it("handles escape sequences in backticks", () => {
      // same escaping as double quotes
      expect(tokenizeNushell("echo `a\\nb`")).toEqual([[token("word", "echo"), token("string", "anb")]]);
    });
  });

  describe("variables", () => {
    it("parses simple variable", () => {
      expect(tokenizeNushell("$foo")).toEqual([vari("$foo")]);
    });

    it("parses env variable", () => {
      expect(tokenizeNushell("$env.PATH")).toEqual([vari("$env.PATH")]);
    });

    it("parses $in variable", () => {
      expect(tokenizeNushell("$in.foo")).toEqual([vari("$in.foo")]);
    });

    it("parses $nothing variable", () => {
      expect(tokenizeNushell("$nothing")).toEqual([vari("$nothing")]);
    });

    it("parses variable in command", () => {
      expect(tokenizeNushell("echo $HOME")).toEqual([[token("word", "echo"), token("variable", "$HOME")]]);
    });

    it("parses variable in pipe chain", () => {
      expect(tokenizeNushell("echo $data | length")).toEqual([
        [token("word", "echo"), token("variable", "$data")],
        [token("word", "length")],
      ]);
    });
  });

  describe("complete pipelines", () => {
    it("tokenizes a full pipeline", () => {
      // single-quoted string is parsed without quotes
      expect(tokenizeNushell("ls -l | where type == 'file' | select name")).toEqual([
        w("ls", "-l"),
        [token("word", "where"), token("word", "type"), token("word", "=="), token("string", "file")],
        w("select", "name"),
      ]);
    });
  });

  // ────────────────────────────────────────────────────────────────────────────
  // Guardrail-relevant nushell commands (from nu-syntax.ts)
  // ────────────────────────────────────────────────────────────────────────────

  describe("guardrail: ls -R", () => {
    it("tokenizes ls -R", () => {
      expect(tokenizeNushell("ls -R")).toEqual([w("ls", "-R")]);
    });
  });

  describe("guardrail: ls -r", () => {
    it("tokenizes ls -r", () => {
      expect(tokenizeNushell("ls -r")).toEqual([w("ls", "-r")]);
    });
  });

  describe("guardrail: str split", () => {
    it("tokenizes str split", () => {
      expect(tokenizeNushell("str split 'hello'")).toEqual([
        [token("word", "str"), token("word", "split"), token("string", "hello")],
      ]);
    });
  });

  describe("guardrail: str substring --start", () => {
    it("tokenizes str substring with --start flag", () => {
      expect(tokenizeNushell("str substring --start 5 'hello'")).toEqual([
        [token("word", "str"), token("word", "substring"), token("word", "--start"), token("word", "5"), token("string", "hello")],
      ]);
    });
  });

  describe("guardrail: str match -r", () => {
    it("tokenizes str match -r", () => {
      expect(tokenizeNushell("str match -r 'pattern' 'text'")).toEqual([
        [token("word", "str"), token("word", "match"), token("word", "-r"), token("string", "pattern"), token("string", "text")],
      ]);
    });
  });

  describe("guardrail: str pad", () => {
    it("tokenizes str pad", () => {
      expect(tokenizeNushell("str pad 'hello' 10 '0'")).toEqual([
        [token("word", "str"), token("word", "pad"), token("string", "hello"), token("word", "10"), token("string", "0")],
      ]);
    });
  });

  describe("guardrail: parse --pattern", () => {
    it("tokenizes parse --pattern", () => {
      expect(tokenizeNushell("parse --pattern 'pattern' input")).toEqual([
        [token("word", "parse"), token("word", "--pattern"), token("string", "pattern"), token("word", "input")],
      ]);
    });
  });

  describe("guardrail: parse html", () => {
    it("tokenizes parse html", () => {
      expect(tokenizeNushell("parse html '<div>test</div>'")).toEqual([
        [token("word", "parse"), token("word", "html"), token("string", "<div>test</div>")],
      ]);
    });
  });

  describe("guardrail: fetch (removed)", () => {
    it("tokenizes fetch", () => {
      expect(tokenizeNushell("fetch https://example.com")).toEqual([
        [token("word", "fetch"), token("word", "https://example.com")],
      ]);
    });
  });

  describe("guardrail: http get -raw", () => {
    it("tokenizes http get -raw", () => {
      expect(tokenizeNushell("http get -raw https://example.com")).toEqual([
        [token("word", "http"), token("word", "get"), token("word", "-raw"), token("word", "https://example.com")],
      ]);
    });
  });

  describe("guardrail: http get -a", () => {
    it("tokenizes http get -a", () => {
      expect(tokenizeNushell("http get -a 'header:value' https://example.com")).toEqual([
        [token("word", "http"), token("word", "get"), token("word", "-a"), token("string", "header:value"), token("word", "https://example.com")],
      ]);
    });
  });

  describe("guardrail: sort without column", () => {
    it("tokenizes sort", () => {
      expect(tokenizeNushell("sort")).toEqual([w("sort")]);
    });
  });

  describe("guardrail: save --csv", () => {
    it("tokenizes save --csv", () => {
      expect(tokenizeNushell("save --csv file.csv")).toEqual([
        [token("word", "save"), token("word", "--csv"), token("word", "file.csv")],
      ]);
    });
  });

  describe("guardrail: str replace --pattern", () => {
    it("tokenizes str replace --pattern", () => {
      expect(tokenizeNushell("str replace --pattern 'old' 'new' 'text'")).toEqual([
        [token("word", "str"), token("word", "replace"), token("word", "--pattern"), token("string", "old"), token("string", "new"), token("string", "text")],
      ]);
    });
  });

  describe("guardrail: str glob-replace", () => {
    it("tokenizes str glob-replace", () => {
      expect(tokenizeNushell("str glob-replace '*.js' '*.ts'")).toEqual([
        [token("word", "str"), token("word", "glob-replace"), token("string", "*.js"), token("string", "*.ts")],
      ]);
    });
  });

  describe("guardrail: str help", () => {
    it("tokenizes str help", () => {
      expect(tokenizeNushell("str help")).toEqual([w("str", "help")]);
    });
  });

  describe("guardrail: str lpad", () => {
    it("tokenizes str lpad", () => {
      expect(tokenizeNushell("str lpad 4 '0' '5'")).toEqual([
        [token("word", "str"), token("word", "lpad"), token("word", "4"), token("string", "0"), token("string", "5")],
      ]);
    });
  });

  describe("guardrail: query db", () => {
    it("tokenizes query db", () => {
      expect(tokenizeNushell("query db 'SELECT * FROM users'")).toEqual([
        [token("word", "query"), token("word", "db"), token("string", "SELECT * FROM users")],
      ]);
    });
  });
});
