import type { Matcher, Token } from "./types.js";
import { makeExact } from "./helpers.js";

/**
 * Match a word (case-insensitive exact match). `match` checks if ANY token
 * matches the word; `tryMatch` consumes starting at `from` for combinators.
 */
export function word(...words: string[]): Matcher {
  const normalized = words.map((w) => w.toLowerCase());
  return {
    match: (tokens: Token[]) =>
      tokens.some((t: Token) =>
        normalized.some((w) => t.value.toLowerCase() === w),
      ),
    tryMatch: (tokens: Token[], from: number) => {
      if (from >= tokens.length) return { ok: false };
      const val = tokens[from].value.toLowerCase();
      if (normalized.some((w) => val === w)) return { ok: true, consumed: 1 };
      return { ok: false };
    },
  };
}

/**
 * Match a regex against any token in the sequence. The `match` method checks
 * if the regex matches any token's value, enabling content-pattern matching
 * where we only need to find the pattern somewhere, not consume all tokens.
 */
export function regex(...exprs: RegExp[]): Matcher {
  return Object.assign(
    {
      match: (tokens: Token[]) =>
        tokens.some((t: Token) => {
          return exprs.some((expr) => {
            expr.lastIndex = 0;
            return expr.test(t.value);
          });
        }),
      tryMatch: (tokens: Token[], from: number) => {
        for (let i = from; i < tokens.length; i++) {
          if (
            exprs.some((expr) => {
              expr.lastIndex = 0;
              return expr.test(tokens[i].value);
            })
          )
            return { ok: true, consumed: 1 };
        }
        return { ok: false };
      },
    },
    { __isRegex: true as true, __patterns: exprs },
  );
}

/**
 * Match any single token.
 */
export function anyToken(): Matcher {
  return regex(/.+/);
}

/**
 * Match a path token (starts with /).
 */
export function path(): Matcher {
  return regex(/^\//);
}
