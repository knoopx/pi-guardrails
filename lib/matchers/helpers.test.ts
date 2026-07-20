import { describe, it, expect } from "vitest";
import { makeExact, token, emitWord } from "./helpers.js";
import type { Token } from "./types.js";

// ──────────────────────────────────────────────────────────────────────────────
// token
// ──────────────────────────────────────────────────────────────────────────────

describe("token", () => {
  it("creates a typed token", () => {
    const t = token("hello", "word");
    expect(t).toEqual({ type: "word", value: "hello" });
  });

  it("creates token with different type", () => {
    const t = token("/path", "path");
    expect(t).toEqual({ type: "path", value: "/path" });
  });

  it("creates token with empty value", () => {
    const t = token("", "word");
    expect(t).toEqual({ type: "word", value: "" });
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// emitWord
// ──────────────────────────────────────────────────────────────────────────────

describe("emitWord", () => {
  it("emits word token when buffer has content", () => {
    const tokens: Token[] = [];
    const current: string[] = ["h", "e", "l", "l", "o"];

    emitWord(tokens, current);

    expect(tokens).toEqual([{ type: "word", value: "hello" }]);
    expect(current).toEqual([]);
  });

  it("does nothing when buffer is empty", () => {
    const tokens: Token[] = [];
    const current: string[] = [];

    emitWord(tokens, current);

    expect(tokens).toEqual([]);
    expect(current).toEqual([]);
  });

  it("preserves existing tokens", () => {
    const tokens: Token[] = [{ type: "word", value: "previous" }];
    const current: string[] = ["n", "e", "w"];

    emitWord(tokens, current);

    expect(tokens).toEqual([
      { type: "word", value: "previous" },
      { type: "word", value: "new" },
    ]);
    expect(current).toEqual([]);
  });

  it("emits word from single char buffer", () => {
    const tokens: Token[] = [];
    const current: string[] = ["x"];

    emitWord(tokens, current);

    expect(tokens).toEqual([{ type: "word", value: "x" }]);
    expect(current).toEqual([]);
  });

  it("clears buffer by setting length to 0", () => {
    const tokens: Token[] = [];
    const current: string[] = ["a", "b", "c"];

    emitWord(tokens, current);

    expect(current.length).toBe(0);
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// makeExact
// ──────────────────────────────────────────────────────────────────────────────

describe("makeExact", () => {
  it("returns matcher with match and tryMatch", () => {
    const m = makeExact((tokens, from) => {
      if (from < tokens.length) return { ok: true, consumed: 1 };
      return { ok: false };
    });
    expect(typeof m.match).toBe("function");
    expect(typeof m.tryMatch).toBe("function");
  });

  it("match calls tryMatch from 0 and checks full consumption", () => {
    const m = makeExact((tokens, from) => {
      if (from < tokens.length) return { ok: true, consumed: 1 };
      return { ok: false };
    });

    // Consumes all 3 tokens one at a time? No — the tryMatch only consumes 1.
    // But makeExact checks consumed === tokens.length. So if tryMatch
    // only consumes 1 out of 3, match returns false.
    expect(m.match([{ type: "word", value: "a" }, { type: "word", value: "b" }, { type: "word", value: "c" }])).toBe(false);
  });

  it("match returns true when all tokens consumed", () => {
    const m = makeExact((tokens, from) => {
      return { ok: true, consumed: tokens.length - from };
    });

    expect(m.match([{ type: "word", value: "a" }, { type: "word", value: "b" }])).toBe(true);
  });

  it("match returns false when tryMatch fails", () => {
    const m = makeExact((_tokens, _from) => ({ ok: false }));
    expect(m.match([])).toBe(false);
  });

  it("match returns false when consumed is undefined", () => {
    const m = makeExact((_tokens, _from) => ({ ok: true }));
    expect(m.match([{ type: "word", value: "a" }])).toBe(false);
  });

  it("tryMatch delegates to provided function", () => {
    const m = makeExact((tokens, from) => {
      return { ok: from < tokens.length, consumed: 1 };
    });

    expect(m.tryMatch([{ type: "word", value: "a" }], 0)).toEqual({ ok: true, consumed: 1 });
    // when from >= tokens.length, ok is false but consumed still returned from the delegate
    expect(m.tryMatch([{ type: "word", value: "a" }], 5)).toEqual({ ok: false, consumed: 1 });
  });
});
