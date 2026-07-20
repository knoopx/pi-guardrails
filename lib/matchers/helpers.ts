import type { Matcher, Token } from "./types.js";

// ── Matcher helpers ──────────────────────────────────────────────────────────

/**
 * Wrap a tryMatch-only matcher with a full match() that checks exact consumption.
 * Used by primitives, combos, and other matcher builders.
 */
export function makeExact(
  tryMatch: (
    tokens: Token[],
    from: number,
  ) => { ok: boolean; consumed?: number },
): Matcher {
  return {
    match: (tokens) => {
      const r = tryMatch(tokens, 0);
      return r.ok && "consumed" in r && r.consumed === tokens.length;
    },
    tryMatch,
  };
}

// ── Tokenizer helpers ────────────────────────────────────────────────────────

/** Create a typed token. */
export function token(value: string, type: string): Token {
  return { type, value };
}

/**
 * Finalize any pending token characters into a word token, clearing the buffer.
 */
export function emitWord(tokens: Token[], current: string[]): void {
  if (current.length > 0) {
    tokens.push(token(current.join(""), "word"));
    current.length = 0;
  }
}
