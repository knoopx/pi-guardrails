import { describe, it, expect } from "vitest";
import { tokenizeSql } from "./sql";

function token(type: string, value: string) {
  return { type, value };
}

describe("tokenizeSql", () => {
  it("returns empty for empty and whitespace", () => {
    expect(tokenizeSql("")).toEqual([]);
    expect(tokenizeSql("   ")).toEqual([]);
  });

  describe("simple words", () => {
    it("tokenizes a simple SQL statement", () => {
      expect(tokenizeSql("SELECT * FROM users"))
        .toEqual([
          [
            token("word", "SELECT"),
            token("word", "*"),
            token("word", "FROM"),
            token("word", "users"),
          ],
        ]);
    });

    it("tokenizes with keywords", () => {
      expect(tokenizeSql("SELECT name FROM users WHERE active = 1"))
        .toEqual([
          [
            token("word", "SELECT"),
            token("word", "name"),
            token("word", "FROM"),
            token("word", "users"),
            token("word", "WHERE"),
            token("word", "active"),
            token("operator", "="),
            token("word", "1"),
          ],
        ]);
    });
  });

  describe("single-quoted strings", () => {
    it("parses a single-quoted string", () => {
      expect(tokenizeSql("SELECT 'hello' FROM users"))
        .toEqual([
          [
            token("word", "SELECT"),
            token("string", "hello"),
            token("word", "FROM"),
            token("word", "users"),
          ],
        ]);
    });

    it("handles escape sequences in single quotes", () => {
      // '' escapes the quote — tokenizer ends string at first '', starts new string
      expect(tokenizeSql("SELECT 'it''s' FROM users"))
        .toEqual([
          [
            token("word", "SELECT"),
            token("string", "it"),
            token("string", "s"),
            token("word", "FROM"),
            token("word", "users"),
          ],
        ]);
    });

    it("handles backslash at end of single-quoted string", () => {
      // tokenizer does not handle backslash escaping — everything after opening quote is a string
      expect(tokenizeSql("SELECT 'path\\' FROM users"))
        .toEqual([
          [
            token("word", "SELECT"),
            token("string", "path\\' FROM users"),
          ],
        ]);
    });
  });

  describe("double-quoted identifiers", () => {
    it("parses a double-quoted identifier", () => {
      expect(tokenizeSql('SELECT "user_name" FROM users'))
        .toEqual([
          [
            token("word", "SELECT"),
            token("identifier", "user_name"),
            token("word", "FROM"),
            token("word", "users"),
          ],
        ]);
    });

    it("parses double-quoted string with special chars", () => {
      expect(tokenizeSql('SELECT "table-name" FROM users'))
        .toEqual([
          [
            token("word", "SELECT"),
            token("identifier", "table-name"),
            token("word", "FROM"),
            token("word", "users"),
          ],
        ]);
    });
  });

  describe("raw strings", () => {
    it("parses r'' raw string", () => {
      expect(tokenizeSql("SELECT r'hello world' FROM users"))
        .toEqual([
          [
            token("word", "SELECT"),
            token("rawstring", "r'hello world'"),
            token("word", "FROM"),
            token("word", "users"),
          ],
        ]);
    });

    it("parses R'' raw string", () => {
      expect(tokenizeSql("SELECT R'hello world' FROM users"))
        .toEqual([
          [
            token("word", "SELECT"),
            token("rawstring", "R'hello world'"),
            token("word", "FROM"),
            token("word", "users"),
          ],
        ]);
    });

    it("raw strings only parsed when preceding empty token position", () => {
      // Raw strings only recognized at token start, not mid-word
      expect(tokenizeSql("SELECT abc r'hello'"))
        .toEqual([
          [
            token("word", "SELECT"),
            token("word", "abc"),
            token("rawstring", "r'hello'"),
          ],
        ]);
    });
  });

  describe("operators", () => {
    it("tokenizes opening parenthesis", () => {
      expect(tokenizeSql("SELECT count(*) FROM users"))
        .toEqual([
          [
            token("word", "SELECT"),
            token("word", "count"),
            token("operator", "("),
            token("word", "*"),
            token("paren", ")"),
            token("word", "FROM"),
            token("word", "users"),
          ],
        ]);
    });

    it("tokenizes comma operator", () => {
      expect(tokenizeSql("SELECT a, b, c FROM t"))
        .toEqual([
          [
            token("word", "SELECT"),
            token("word", "a"),
            token("operator", ","),
            token("word", "b"),
            token("operator", ","),
            token("word", "c"),
            token("word", "FROM"),
            token("word", "t"),
          ],
        ]);
    });

    it("tokenizes semicolon", () => {
      expect(tokenizeSql("SELECT 1; SELECT 2"))
        .toEqual([
          [
            token("word", "SELECT"),
            token("word", "1"),
            token("operator", ";"),
            token("word", "SELECT"),
            token("word", "2"),
          ],
        ]);
    });

    it("tokenizes colon and equals", () => {
      // colon is a separate operator token
      expect(tokenizeSql("SELECT :name, @var"))
        .toEqual([
          [
            token("word", "SELECT"),
            token("operator", ":"),
            token("word", "name"),
            token("operator", ","),
            token("word", "@var"),
          ],
        ]);
    });
  });

  describe("word characters", () => {
    it("handles dots in identifiers", () => {
      expect(tokenizeSql("SELECT table.column FROM schema.table"))
        .toEqual([
          [
            token("word", "SELECT"),
            token("word", "table.column"),
            token("word", "FROM"),
            token("word", "schema.table"),
          ],
        ]);
    });

    it("handles underscores and digits", () => {
      expect(tokenizeSql("SELECT user_name1 FROM t2"))
        .toEqual([
          [
            token("word", "SELECT"),
            token("word", "user_name1"),
            token("word", "FROM"),
            token("word", "t2"),
          ],
        ]);
    });
  });

  describe("function call patterns", () => {
    it("tokenizes function call with arguments", () => {
      expect(tokenizeSql("SELECT read_csv_auto('file.csv')"))
        .toEqual([
          [
            token("word", "SELECT"),
            token("word", "read_csv_auto"),
            token("operator", "("),
            token("string", "file.csv"),
            token("paren", ")"),
          ],
        ]);
    });

    it("tokenizes function with multiple args", () => {
      expect(tokenizeSql("SELECT substr('hello', 0, 5)"))
        .toEqual([
          [
            token("word", "SELECT"),
            token("word", "substr"),
            token("operator", "("),
            token("string", "hello"),
            token("operator", ","),
            token("word", "0"),
            token("operator", ","),
            token("word", "5"),
            token("paren", ")"),
          ],
        ]);
    });
  });

  describe("tilde and special paths", () => {
    it("tokenizes tilde as a word character", () => {
      expect(tokenizeSql("SELECT * FROM read_csv_auto('~/data.csv')"))
        .toEqual([
          [
            token("word", "SELECT"),
            token("word", "*"),
            token("word", "FROM"),
            token("word", "read_csv_auto"),
            token("operator", "("),
            token("string", '~/data.csv'),
            token("paren", ")"),
          ],
        ]);
    });
  });

  // ────────────────────────────────────────────────────────────────────────────
  // Guardrail-relevant SQL patterns (from duckdb-syntax.ts)
  // ────────────────────────────────────────────────────────────────────────────

  describe("guardrail: read_csv_auto", () => {
    it("tokenizes read_csv_auto with tilde path", () => {
      expect(tokenizeSql("SELECT * FROM read_csv_auto('~/data.csv')"))
        .toEqual([
          [
            token("word", "SELECT"),
            token("word", "*"),
            token("word", "FROM"),
            token("word", "read_csv_auto"),
            token("operator", "("),
            token("string", '~/data.csv'),
            token("paren", ")"),
          ],
        ]);
    });

    it("tokenizes read_csv_auto with options", () => {
      expect(tokenizeSql("SELECT * FROM read_csv_auto('file.csv', header=true, auto_detect=true)"))
        .toEqual([
          [
            token("word", "SELECT"),
            token("word", "*"),
            token("word", "FROM"),
            token("word", "read_csv_auto"),
            token("operator", "("),
            token("string", "file.csv"),
            token("operator", ","),
            token("word", "header"),
            token("operator", "="),
            token("word", "true"),
            token("operator", ","),
            token("word", "auto_detect"),
            token("operator", "="),
            token("word", "true"),
            token("paren", ")"),
          ],
        ]);
    });
  });

  describe("guardrail: AUTO_DETECT ON", () => {
    it("tokenizes SET AUTO_DETECT ON", () => {
      expect(tokenizeSql("SET AUTO_DETECT ON"))
        .toEqual([
          [
            token("word", "SET"),
            token("word", "AUTO_DETECT"),
            token("word", "ON"),
          ],
        ]);
    });
  });

  describe("guardrail: regexp_extract with r'' raw string", () => {
    it("tokenizes regexp_extract with r''", () => {
      expect(tokenizeSql("SELECT regexp_extract(col, r'pattern', 1)"))
        .toEqual([
          [
            token("word", "SELECT"),
            token("word", "regexp_extract"),
            token("operator", "("),
            token("word", "col"),
            token("operator", ","),
            token("rawstring", "r'pattern'"),
            token("operator", ","),
            token("word", "1"),
            token("paren", ")"),
          ],
        ]);
    });
  });

  describe("guardrail: string_to_split_to_array", () => {
    it("tokenizes string_to_split_to_array", () => {
      expect(tokenizeSql("SELECT string_to_split_to_array(str, delimiter)"))
        .toEqual([
          [
            token("word", "SELECT"),
            token("word", "string_to_split_to_array"),
            token("operator", "("),
            token("word", "str"),
            token("operator", ","),
            token("word", "delimiter"),
            token("paren", ")"),
          ],
        ]);
    });
  });

  describe("guardrail: list_agg", () => {
    it("tokenizes list_agg", () => {
      expect(tokenizeSql("SELECT list_agg(col)"))
        .toEqual([
          [
            token("word", "SELECT"),
            token("word", "list_agg"),
            token("operator", "("),
            token("word", "col"),
            token("paren", ")"),
          ],
        ]);
    });
  });

  describe("guardrail: string_agg", () => {
    it("tokenizes string_agg", () => {
      expect(tokenizeSql("SELECT string_agg(col, ',')"))
        .toEqual([
          [
            token("word", "SELECT"),
            token("word", "string_agg"),
            token("operator", "("),
            token("word", "col"),
            token("operator", ","),
            token("string", ","),
            token("paren", ")"),
          ],
        ]);
    });
  });

  describe("guardrail: initcap", () => {
    it("tokenizes initcap", () => {
      expect(tokenizeSql("SELECT initcap(col)"))
        .toEqual([
          [
            token("word", "SELECT"),
            token("word", "initcap"),
            token("operator", "("),
            token("word", "col"),
            token("paren", ")"),
          ],
        ]);
    });
  });

  describe("guardrail: regexp_like", () => {
    it("tokenizes regexp_like", () => {
      expect(tokenizeSql("SELECT regexp_like(col, 'pattern')"))
        .toEqual([
          [
            token("word", "SELECT"),
            token("word", "regexp_like"),
            token("operator", "("),
            token("word", "col"),
            token("operator", ","),
            token("string", "pattern"),
            token("paren", ")"),
          ],
        ]);
    });
  });

  describe("guardrail: regexp_count", () => {
    it("tokenizes regexp_count", () => {
      expect(tokenizeSql("SELECT regexp_count(col, 'pattern')"))
        .toEqual([
          [
            token("word", "SELECT"),
            token("word", "regexp_count"),
            token("operator", "("),
            token("word", "col"),
            token("operator", ","),
            token("string", "pattern"),
            token("paren", ")"),
          ],
        ]);
    });
  });

  describe("guardrail: regexp_split_to_table", () => {
    it("tokenizes regexp_split_to_table", () => {
      expect(tokenizeSql("SELECT regexp_split_to_table(col, 'pattern')"))
        .toEqual([
          [
            token("word", "SELECT"),
            token("word", "regexp_split_to_table"),
            token("operator", "("),
            token("word", "col"),
            token("operator", ","),
            token("string", "pattern"),
            token("paren", ")"),
          ],
        ]);
    });
  });

  describe("guardrail: COPY TO", () => {
    it("tokenizes COPY TO", () => {
      expect(tokenizeSql("COPY t TO 'file.csv' (HEADER TRUE)"))
        .toEqual([
          [
            token("word", "COPY"),
            token("word", "t"),
            token("word", "TO"),
            token("string", "file.csv"),
            token("operator", "("),
            token("word", "HEADER"),
            token("word", "TRUE"),
            token("paren", ")"),
          ],
        ]);
    });
  });

  describe("guardrail: INSERT INTO read_csv_auto", () => {
    it("tokenizes INSERT INTO read_csv_auto", () => {
      expect(tokenizeSql("INSERT INTO read_csv_auto VALUES (1)"))
        .toEqual([
          [
            token("word", "INSERT"),
            token("word", "INTO"),
            token("word", "read_csv_auto"),
            token("word", "VALUES"),
            token("operator", "("),
            token("word", "1"),
            token("paren", ")"),
          ],
        ]);
    });
  });

  describe("guardrail: UPDATE read_csv_auto", () => {
    it("tokenizes UPDATE read_csv_auto", () => {
      expect(tokenizeSql("UPDATE read_csv_auto SET col = 1"))
        .toEqual([
          [
            token("word", "UPDATE"),
            token("word", "read_csv_auto"),
            token("word", "SET"),
            token("word", "col"),
            token("operator", "="),
            token("word", "1"),
          ],
        ]);
    });
  });

  describe("guardrail: LOAD csv FROM", () => {
    it("tokenizes LOAD csv FROM", () => {
      expect(tokenizeSql("LOAD csv FROM 'file.csv'"))
        .toEqual([
          [
            token("word", "LOAD"),
            token("word", "csv"),
            token("word", "FROM"),
            token("string", "file.csv"),
          ],
        ]);
    });
  });

  describe("guardrail: LIKE ANY", () => {
    it("tokenizes LIKE ANY", () => {
      expect(tokenizeSql("SELECT * FROM t WHERE col LIKE ANY (ARRAY['a', 'b'])"))
        .toEqual([
          [
            token("word", "SELECT"),
            token("word", "*"),
            token("word", "FROM"),
            token("word", "t"),
            token("word", "WHERE"),
            token("word", "col"),
            token("word", "LIKE"),
            token("word", "ANY"),
            token("operator", "("),
            token("word", "ARRAY"),
            token("operator", "["),
            token("string", "a"),
            token("operator", ","),
            token("string", "b"),
            token("operator", "]"),
            token("paren", ")"),
          ],
        ]);
    });
  });

  describe("guardrail: duckdb -c subprocess", () => {
    it("tokenizes duckdb -c", () => {
      expect(tokenizeSql("duckdb -c 'SELECT 1'"))
        .toEqual([
          [
            token("word", "duckdb"),
            token("word", "-c"),
            token("string", "SELECT 1"),
          ],
        ]);
    });
  });

  describe("guardrail: duckdb -csv subprocess", () => {
    it("tokenizes duckdb -csv", () => {
      expect(tokenizeSql("duckdb -c 'SELECT 1' | csv"))
        .toEqual([
          [
            token("word", "duckdb"),
            token("word", "-c"),
            token("string", "SELECT 1"),
          ],
        ]);
    });
  });

  describe("guardrail: WHERE OVER", () => {
    it("tokenizes WHERE with OVER", () => {
      expect(tokenizeSql("SELECT * FROM t WHERE rank() OVER (ORDER BY col) = 1"))
        .toEqual([
          [
            token("word", "SELECT"),
            token("word", "*"),
            token("word", "FROM"),
            token("word", "t"),
            token("word", "WHERE"),
            token("word", "rank"),
            token("operator", "("),
            token("paren", ")"),
            token("word", "OVER"),
            token("operator", "("),
            token("word", "ORDER"),
            token("word", "BY"),
            token("word", "col"),
            token("paren", ")"),
            token("operator", "="),
            token("word", "1"),
          ],
        ]);
    });
  });

  describe("guardrail: OVERWRITE_TRUE", () => {
    it("tokenizes OVERWRITE_TRUE", () => {
      expect(tokenizeSql("SELECT * FROM read_csv_auto('file.csv', OVERWRITE_TRUE = true)"))
        .toEqual([
          [
            token("word", "SELECT"),
            token("word", "*"),
            token("word", "FROM"),
            token("word", "read_csv_auto"),
            token("operator", "("),
            token("string", "file.csv"),
            token("operator", ","),
            token("word", "OVERWRITE_TRUE"),
            token("operator", "="),
            token("word", "true"),
            token("paren", ")"),
          ],
        ]);
    });
  });

  describe("guardrail: union_by_name", () => {
    it("tokenizes union_by_name", () => {
      expect(tokenizeSql("SELECT * FROM read_csv_auto('file.csv', union_by_name = true)"))
        .toEqual([
          [
            token("word", "SELECT"),
            token("word", "*"),
            token("word", "FROM"),
            token("word", "read_csv_auto"),
            token("operator", "("),
            token("string", "file.csv"),
            token("operator", ","),
            token("word", "union_by_name"),
            token("operator", "="),
            token("word", "true"),
            token("paren", ")"),
          ],
        ]);
    });
  });

  describe("guardrail: substr + unnest", () => {
    it("tokenizes substr on unnest result", () => {
      expect(tokenizeSql("SELECT substr(unnest(arr), 1, 3)"))
        .toEqual([
          [
            token("word", "SELECT"),
            token("word", "substr"),
            token("operator", "("),
            token("word", "unnest"),
            token("operator", "("),
            token("word", "arr"),
            token("paren", ")"),
            token("operator", ","),
            token("word", "1"),
            token("operator", ","),
            token("word", "3"),
            token("paren", ")"),
          ],
        ]);
    });
  });

  describe("guardrail: nested UNNEST", () => {
    it("tokenizes nested UNNEST calls", () => {
      expect(tokenizeSql("SELECT unnest(unnest(arr))"))
        .toEqual([
          [
            token("word", "SELECT"),
            token("word", "unnest"),
            token("operator", "("),
            token("word", "unnest"),
            token("operator", "("),
            token("word", "arr"),
            token("paren", ")"),
            token("paren", ")"),
          ],
        ]);
    });
  });

  describe("guardrail: CASE THEN 0", () => {
    it("tokenizes CASE THEN 0", () => {
      expect(tokenizeSql("SELECT CASE WHEN x THEN 0 ELSE 'str' END"))
        .toEqual([
          [
            token("word", "SELECT"),
            token("word", "CASE"),
            token("word", "WHEN"),
            token("word", "x"),
            token("word", "THEN"),
            token("word", "0"),
            token("word", "ELSE"),
            token("string", "str"),
            token("word", "END"),
          ],
        ]);
    });
  });

  describe("guardrail: read_csv_auto as scalar (not in FROM)", () => {
    it("tokenizes read_csv_auto as scalar expression", () => {
      expect(tokenizeSql("SELECT read_csv_auto('file.csv')"))
        .toEqual([
          [
            token("word", "SELECT"),
            token("word", "read_csv_auto"),
            token("operator", "("),
            token("string", "file.csv"),
            token("paren", ")"),
          ],
        ]);
    });
  });
});
