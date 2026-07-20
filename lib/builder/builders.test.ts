import { describe, it, expect } from "vitest";
import {
  tagged,
  createMatcherBuilder,
  extractTextFromContent,
  interpolateCommand,
} from "./builders.js";

// ──────────────────────────────────────────────────────────────────────────────
// tagged
// ──────────────────────────────────────────────────────────────────────────────

describe("tagged", () => {
  it("attaches __tokenizer to matcher", () => {
    const tokenizer = (text: string) => text.split(/\s+/).map((v) => ({ type: "word", value: v }));
    const matcher = { match: () => true, tryMatch: () => ({ ok: true }) };

    const taggedMatcher = tagged(matcher, tokenizer);

    expect((taggedMatcher as any).__tokenizer).toBe(tokenizer);
    expect(taggedMatcher.match).toBe(matcher.match);
    expect(taggedMatcher.tryMatch).toBe(matcher.tryMatch);
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// createMatcherBuilder
// ──────────────────────────────────────────────────────────────────────────────

describe("createMatcherBuilder", () => {
  it("creates builder with word method", () => {
    const tokenizer = (text: string) => text.split(/\s+/).map((v) => ({ type: "word", value: v }));
    const builder = createMatcherBuilder(tokenizer);

    expect(typeof builder.word).toBe("function");
  });

  it("word returns tagged matcher", () => {
    const tokenizer = (text: string) => text.split(/\s+/).map((v) => ({ type: "word", value: v }));
    const builder = createMatcherBuilder(tokenizer);

    const matcher = builder.word("rm");
    expect((matcher as any).__tokenizer).toBe(tokenizer);
    expect(matcher.match(t(["rm"]))).toBe(true);
  });

  function t(arr: string[]) {
    return arr.map((v) => ({ type: "word", value: v }));
  }
});

// ──────────────────────────────────────────────────────────────────────────────
// extractTextFromContent
// ──────────────────────────────────────────────────────────────────────────────

describe("extractTextFromContent", () => {
  it("extracts text from text content items", () => {
    const result = extractTextFromContent([
      { type: "text", text: "hello" },
      { type: "text", text: "world" },
    ]);
    expect(result).toBe("hello\nworld");
  });

  it("filters out image content items", () => {
    const result = extractTextFromContent([
      { type: "image", data: "base64", mimeType: "image/png" },
      { type: "text", text: "hello" },
    ]);
    expect(result).toBe("hello");
  });

  it("returns empty string for empty array", () => {
    const result = extractTextFromContent([]);
    expect(result).toBe("");
  });

  it("returns empty string when only image content", () => {
    const result = extractTextFromContent([
      { type: "image", data: "base64", mimeType: "image/png" },
    ]);
    expect(result).toBe("");
  });

  it("joins multiple text segments with newline", () => {
    const result = extractTextFromContent([
      { type: "text", text: "line1" },
      { type: "text", text: "line2" },
      { type: "text", text: "line3" },
    ]);
    expect(result).toBe("line1\nline2\nline3");
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// interpolateCommand
// ──────────────────────────────────────────────────────────────────────────────

describe("interpolateCommand", () => {
  it("replaces single placeholder with value", () => {
    const result = interpolateCommand("echo {file}", { file: "test.txt" });
    expect(result).toBe("echo test.txt");
  });

  it("replaces multiple placeholders", () => {
    const result = interpolateCommand(
      "mv {src} {dst}",
      { src: "old.txt", dst: "new.txt" },
    );
    expect(result).toBe("mv old.txt new.txt");
  });

  it("returns placeholder unchanged when key is undefined", () => {
    const result = interpolateCommand("echo {missing}", {});
    expect(result).toBe("echo {missing}");
  });

  it("returns placeholder unchanged when value is null", () => {
    const result = interpolateCommand("echo {key}", { key: null });
    expect(result).toBe("echo {key}");
  });

  it("converts numeric values to string", () => {
    const result = interpolateCommand("echo {count}", { count: 42 });
    expect(result).toBe("echo 42");
  });

  it("converts boolean values to string", () => {
    const result = interpolateCommand("echo {flag}", { flag: true });
    expect(result).toBe("echo true");
  });

  it("converts boolean false to string", () => {
    const result = interpolateCommand("echo {flag}", { flag: false });
    expect(result).toBe("echo false");
  });

  it("does not replace non-placeholder braces", () => {
    const result = interpolateCommand("echo {{{}}}", {});
    expect(result).toBe("echo {{{}}}");
  });

  it("does not replace unmatched closing brace", () => {
    const result = interpolateCommand("echo test}", {});
    expect(result).toBe("echo test}");
  });

  it("handles mixed placeholder and non-placeholder text", () => {
    const result = interpolateCommand(
      "cp {file} /tmp/{dest}/",
      { file: "src.txt", dest: "output" },
    );
    expect(result).toBe("cp src.txt /tmp/output/");
  });

  it("handles empty command string", () => {
    const result = interpolateCommand("", {});
    expect(result).toBe("");
  });

  it("handles placeholder with numeric key name", () => {
    const result = interpolateCommand("echo {key1}", { key1: "value" });
    expect(result).toBe("echo value");
  });

  it("handles placeholder with special characters in value", () => {
    const result = interpolateCommand(
      "echo {msg}",
      { msg: "hello\nworld" },
    );
    expect(result).toBe("echo hello\nworld");
  });

  it("handles duplicate keys in same command", () => {
    const result = interpolateCommand(
      "echo {name} {name}",
      { name: "Alice" },
    );
    expect(result).toBe("echo Alice Alice");
  });
});
