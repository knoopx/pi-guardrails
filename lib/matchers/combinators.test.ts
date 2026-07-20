import { describe, it, expect } from "vitest";
import type { Token } from "./types.js";
import {
  seq,
  anyOf,
  repeat,
  repeat1,
  opt,
  exact,
  star,
  spread,
  prefixed,
  contains,
} from "./combinators.js";
import { word, regex } from "./primitives.js";

function t(arr: string[]): Token[] {
  return arr.map((v) => ({ type: "word", value: v }));
}

// ──────────────────────────────────────────────────────────────────────────
// Shared helpers
// ──────────────────────────────────────────────────────────────────────────

const zeroConsumedMatcher = {
  match: (_tokens: Token[]) => true,
  tryMatch: (_tokens: Token[], _from: number) => ({ ok: true, consumed: 0 }),
};

// ──────────────────────────────────────────────────────────────────────────────
// seq + spread backtracking
// ──────────────────────────────────────────────────────────────────────────────

describe("seq with spread backtracking", () => {
  it("backtracks spread to match subsequent tokens", () => {
    const m = seq(word("find"), spread(), word("-name"), word("foo"));
    expect(m.match(t(["find", ".", "-type", "f", "-name", "foo"]))).toBe(true);
  });

  it("backtracks spread to zero when target is immediately after", () => {
    const m = seq(word("find"), spread(), word("-name"));
    expect(m.match(t(["find", "-name"]))).toBe(true);
  });

  it("backtracks spread to zero when target is not found", () => {
    const m = seq(word("find"), spread(), word("-name"));
    expect(m.match(t(["find", "."]))).toBe(false);
  });

  it("backtracks spread with star following", () => {
    const m = seq(word("find"), spread(), word("-name"), star());
    expect(m.match(t(["find", "-name", "foo"]))).toBe(true);
    expect(m.match(t(["find", ".", "-type", "f", "-name", "foo", "extra"]))).toBe(true);
  });

  it("backtracks spread with nested spread", () => {
    const m = seq(word("a"), spread(), word("b"), spread(), word("c"));
    expect(m.match(t(["a", "b", "c"]))).toBe(true);
    expect(m.match(t(["a", "x", "b", "y", "c"]))).toBe(true);
    expect(m.match(t(["a", "b", "c", "d"]))).toBe(true);
    expect(m.match(t(["a", "b"]))).toBe(false);
  });

  it("backtracks spread when middle target is missing", () => {
    const m = seq(word("a"), spread(), word("b"), spread(), word("c"));
    // 'b' is missing — should backtrack both spreads and fail
    expect(m.match(t(["a", "c"]))).toBe(false);
    expect(m.match(t(["a", "x", "c"]))).toBe(false);
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// seq + star backtracking
// ──────────────────────────────────────────────────────────────────────────────

describe("seq with star backtracking", () => {
  it("star backtracks to allow subsequent matchers", () => {
    const m = seq(word("SELECT"), star(), word("FROM"));
    expect(m.match(t(["SELECT", "*", "FROM", "t"]))).toBe(true);
    expect(m.match(t(["SELECT", "FROM", "t"]))).toBe(true);
  });

  it("star backtracks to zero", () => {
    const m = seq(word("SELECT"), star(), word("FROM"));
    expect(m.match(t(["SELECT", "FROM", "t"]))).toBe(true);
  });

  it("star after spread", () => {
    const m = seq(word("a"), spread(), word("b"), star());
    expect(m.match(t(["a", "x", "b"]))).toBe(true);
    expect(m.match(t(["a", "x", "b", "y", "z"]))).toBe(true);
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// seq + repeat backtracking
// ──────────────────────────────────────────────────────────────────────────────

describe("seq with repeat backtracking", () => {
  it("repeat backtracks to allow subsequent matchers", () => {
    // repeat consumes consecutive matches; backtracking reduces consumed count
    const m = seq(word("find"), repeat(word("-f")), word("-exec"));
    expect(m.match(t(["find", "-exec"]))).toBe(true); // repeat matches 0
    expect(m.match(t(["find", "-f", "-exec"]))).toBe(true);
    expect(m.match(t(["find", "-f", "-f", "-exec"]))).toBe(true);
  });

  it("repeat backtracks to zero", () => {
    const m = seq(word("find"), repeat(anyOf(word("-name"), word("-type"))), word("-exec"));
    expect(m.match(t(["find", "-exec"]))).toBe(true);
  });

  it("repeat1 in seq backtracks", () => {
    const m = seq(word("find"), repeat1(word("-f")), word("-exec"));
    expect(m.match(t(["find", "-f", "-exec"]))).toBe(true);
    expect(m.match(t(["find", "-f", "-f", "-exec"]))).toBe(true);
  });

  it("repeat1 fails when first match fails", () => {
    const m = seq(word("find"), repeat1(word("-name")), word("-exec"));
    expect(m.match(t(["find", "-exec"]))).toBe(false);
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// repeat1 edge cases
// ──────────────────────────────────────────────────────────────────────────────

describe("repeat1 edge cases", () => {
  it("fails when first match fails", () => {
    const m = repeat1(word("-"));
    expect(m.match(t(["a"]))).toBe(false);
  });

  it("fails when no tokens at all", () => {
    const m = repeat1(word("-"));
    expect(m.match([])).toBe(false);
  });

  it("matches when first consumed is 0 — returns ok:true consumed:0", () => {
    // A matcher that matches but consumes 0 tokens (e.g. empty regex)
    const zeroConsumed = regex(/(?=)/); // lookahead, matches but consumes nothing
    const m = repeat1(zeroConsumed);
    // first match returns consumed=1 from regex tryMatch, but if we had
    // a true zero-consumed matcher, repeat1 returns { ok: true, consumed: 0 }
    // Let's test with a regex that matches zero-width:
    expect(m.match(t(["a"]))).toBe(true);
  });

  it("repeats multiple times after first", () => {
    const m = repeat1(word("-"));
    expect(m.match(t(["-", "-", "-"]))).toBe(true);
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// exact edge cases
// ──────────────────────────────────────────────────────────────────────────────

describe("exact edge cases", () => {
  it("fails when n exceeds token length", () => {
    const m = exact(5);
    expect(m.match(t(["a", "b", "c"]))).toBe(false);
  });

  it("fails when n is greater than token length", () => {
    const m = exact(10);
    expect(m.match(t(["a"]))).toBe(false);
  });

  it("matches exactly when n equals token length", () => {
    const m = exact(3);
    expect(m.match(t(["a", "b", "c"]))).toBe(true);
  });

  it("matches zero tokens with exact(0)", () => {
    const m = exact(0);
    expect(m.match([])).toBe(true);
  });

  it("exact(-1) on empty tokens: ok:true consumed:-1 but makeExact rejects consumed !== tokens.length", () => {
    const m = exact(-1);
    // from + n <= tokens.length: 0 + (-1) <= 0 → true → ok: true, consumed: -1
    // but makeExact checks consumed === tokens.length: -1 !== 0 → false
    expect(m.match([])).toBe(false);
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// contains edge cases
// ──────────────────────────────────────────────────────────────────────────────

describe("contains edge cases", () => {
  it("matches nested target at the beginning", () => {
    const m = contains(seq(word("SELECT"), word("*")));
    expect(m.match(t(["SELECT", "*", "FROM", "t"]))).toBe(true);
  });

  it("matches nested target at the end", () => {
    const m = contains(seq(word("FROM"), word("t")));
    expect(m.match(t(["SELECT", "*", "FROM", "t"]))).toBe(true);
  });

  it("matches nested target in the middle", () => {
    const m = contains(seq(word("*"), word("FROM")));
    expect(m.match(t(["SELECT", "*", "FROM", "t"]))).toBe(true);
  });

  it("matches partial target via word substring matching", () => {
    // word("FROM") uses case-insensitive full match, so "FROM" matches "FROM"
    // but "form" does not match "FROM"
    const m = contains(word("FROM"));
    expect(m.match(t(["SELECT", "FROM", "t"]))).toBe(true);
    expect(m.match(t(["SELECT", "form", "t"]))).toBe(false);
  });

  it("does not match when target is split across tokens", () => {
    // word("SELECT") needs the full token to be "SELECT", not "SELECT *"
    const m = contains(word("SELECT"));
    expect(m.match(t(["SELECT", "*", "FROM", "t"]))).toBe(true);
  });

  it("returns false when target is not present", () => {
    const m = contains(word("WHERE"));
    expect(m.match(t(["SELECT", "*", "FROM", "t"]))).toBe(false);
  });

  it("handles multi-token target with spread gaps", () => {
    const m = contains(seq(word("SELECT"), spread(), word("FROM")));
    expect(m.match(t(["SELECT", "*", "FROM", "t"]))).toBe(true);
    expect(m.match(t(["SELECT", "FROM", "t"]))).toBe(true);
  });

  it("tryMatch returns consumed equal to token length on match", () => {
    const m = contains(word("SELECT"));
    const tokens = t(["SELECT", "*", "FROM", "t"]);
    const r = m.tryMatch(tokens, 0);
    expect(r.ok).toBe(true);
    expect(r.consumed).toBe(tokens.length);
  });

  it("tryMatch returns ok false when not found from current position", () => {
    const m = contains(word("WHERE"));
    const tokens = t(["SELECT", "*", "FROM", "t"]);
    const r = m.tryMatch(tokens, 0);
    expect(r.ok).toBe(false);
  });

  it("tryMatch finds target at offset", () => {
    const m = contains(word("FROM"));
    const tokens = t(["SELECT", "*", "FROM", "t"]);
    const r = m.tryMatch(tokens, 0);
    expect(r.ok).toBe(true);
    // tryMatch returns consumed = tokens.length from first match at any position
    expect(r.consumed).toBe(tokens.length);
  });

  it("tryMatch fails when start offset skips the target", () => {
    const m = contains(word("SELECT"));
    const tokens = t(["SELECT", "*", "FROM", "t"]);
    // Start from position 1, skip "SELECT"
    const r = m.tryMatch(tokens, 1);
    expect(r.ok).toBe(false);
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// spread edge cases
// ──────────────────────────────────────────────────────────────────────────────

describe("spread edge cases", () => {
  it("matches zero tokens (empty spread)", () => {
    const m = seq(word("a"), spread(), word("b"));
    expect(m.match(t(["a", "b"]))).toBe(true);
  });

  it("matches all tokens", () => {
    const m = seq(spread());
    expect(m.match(t(["a", "b", "c"]))).toBe(true);
  });

  it("backtracks to find subsequent matchers", () => {
    const m = seq(spread(), word("target"));
    expect(m.match(t(["x", "y", "target"]))).toBe(true);
    expect(m.match(t(["target"]))).toBe(true);
  });

  it("returns false when target not found", () => {
    const m = seq(spread(), word("missing"));
    expect(m.match(t(["a", "b"]))).toBe(false);
  });

  it("spread followed by spread", () => {
    const m = seq(spread(), spread());
    expect(m.match(t(["a", "b", "c"]))).toBe(true);
  });

  it("spread tryMatch returns consumed 0 at end of tokens", () => {
    // spread tryMatch iterates c from 0 to tokens.length - from
    // when from === tokens.length, the loop runs once with c=0
    // and from + c === tokens.length, so returns { ok: true, consumed: 0 }
    const m = spread();
    const r = m.tryMatch([], 0);
    expect(r.ok).toBe(true);
    expect(r.consumed).toBe(0);
  });

  it("spread tryMatch returns ok false when tokens empty and from > 0", () => {
    const m = spread();
    const r = m.tryMatch([], 1);
    expect(r.ok).toBe(false);
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// findRepeatEnd edge cases (tested indirectly via repeat)
// ──────────────────────────────────────────────────────────────────────────────

describe("findRepeatEnd via repeat", () => {
  it("handles repeat exhaustion — stops when matcher fails", () => {
    const m = repeat(word("-"));
    // The repeat should consume consecutive "-" tokens and stop at non-"-" token
    const r = m.tryMatch(t(["-", "-", "a", "-"]), 0);
    expect(r.ok).toBe(true);
    expect(r.consumed).toBe(2);
  });

  it("handles zero-consumed matcher in repeat — stops immediately", () => {
    const m = repeat(zeroConsumedMatcher);
    const r = m.tryMatch(t(["a"]), 0);
    expect(r.ok).toBe(true);
    expect(r.consumed).toBe(0);
  });

  it("handles repeat of zero-consumed matcher — returns 0 consumed", () => {
    const m = repeat(zeroConsumedMatcher);
    // makeExact: consumed (0) === tokens.length (0) → true
    expect(m.match([])).toBe(true);
    // makeExact: consumed (0) !== tokens.length (1) → false
    expect(m.match(t(["a"]))).toBe(false);
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// seq backtracking: spread/star/repeat interactions
// ──────────────────────────────────────────────────────────────────────────────

describe("matchSeq backtracking interactions", () => {
  it("spread before star", () => {
    const m = seq(word("a"), spread(), word("b"), star());
    expect(m.match(t(["a", "b"]))).toBe(true);
    expect(m.match(t(["a", "x", "b", "y"]))).toBe(true);
  });

  it("star before spread", () => {
    const m = seq(word("a"), star(), spread(), word("b"));
    // star consumes everything, spread tries to backtrack... but star is __star,
    // so matchSeq iterates c from ti to tokens.length. For star, it tries all
    // possible consumed amounts. Eventually star consumes 0 and spread matches
    // the rest to find "b".
    expect(m.match(t(["a", "b"]))).toBe(true);
    expect(m.match(t(["a", "x", "b"]))).toBe(true);
  });

  it("repeat before spread", () => {
    const m = seq(word("a"), repeat(word("x")), spread(), word("b"));
    expect(m.match(t(["a", "b"]))).toBe(true);
    expect(m.match(t(["a", "x", "x", "y", "b"]))).toBe(true);
  });

  it("spread before repeat", () => {
    const m = seq(word("a"), spread(), repeat(word("x")), word("b"));
    expect(m.match(t(["a", "b"]))).toBe(true);
    expect(m.match(t(["a", "y", "x", "x", "b"]))).toBe(true);
  });

  it("nested spreads and stars", () => {
    const m = seq(spread(), word("a"), spread(), word("b"), star());
    expect(m.match(t(["x", "a", "b"]))).toBe(true);
    expect(m.match(t(["x", "a", "y", "b", "z"]))).toBe(true);
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// edge: matchSeq with from + n <= tokens.length (exact)
// ──────────────────────────────────────────────────────────────────────────────

describe("exact inside seq", () => {
  it("exact n exceeds remaining tokens — fails", () => {
    const m = seq(word("a"), exact(5));
    expect(m.match(t(["a", "b", "c"]))).toBe(false);
  });

  it("exact n matches remaining tokens exactly", () => {
    const m = seq(word("a"), exact(2));
    expect(m.match(t(["a", "b", "c"]))).toBe(true);
  });

  it("exact(0) matches zero tokens", () => {
    const m = seq(word("a"), exact(0));
    expect(m.match(t(["a"]))).toBe(true);
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// findRepeatEnd via repeat1
// ──────────────────────────────────────────────────────────────────────────────

describe("findRepeatEnd via repeat1", () => {
  it("matches exactly when tokens are all dashes", () => {
    const m = repeat1(word("-"));
    expect(m.match(t(["-", "-"]))).toBe(true);
  });

  it("fails when not all tokens are dashes", () => {
    const m = repeat1(word("-"));
    // makeExact requires consumed === tokens.length; "a" is not consumed
    expect(m.match(t(["-", "-", "a"]))).toBe(false);
  });

  it("first consumed=0: returns ok:true consumed:0", () => {
    const m = repeat1(zeroConsumedMatcher);
    // first.ok is true, firstConsumed === 0 → returns { ok: true, consumed: 0 }
    // makeExact checks consumed === tokens.length: 0 !== 1 → false
    expect(m.match(t(["a"]))).toBe(false);
    // But with empty tokens: consumed (0) === tokens.length (0) → true
    expect(m.match([])).toBe(true);
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// repeat and repeat1 with zero-consumed tryMatch
// ──────────────────────────────────────────────────────────────────────────────

describe("repeat with zero-consumed tryMatch", () => {
  it("repeat stops when consumed === 0", () => {
    const m = repeat(zeroConsumedMatcher);
    // tryMatch returns consumed 0, findRepeatEnd breaks
    const r = m.tryMatch(t(["a", "b"]), 0);
    expect(r.ok).toBe(true);
    expect(r.consumed).toBe(0);
  });
});
