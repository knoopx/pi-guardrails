import type { Matcher, Token, MatchResult, Tokenizer } from "./types.js";
import { word } from "./primitives.js";
import { makeExact } from "./helpers.js";

/** Extract __tokenizer from first inner matcher that has one. */
function getInnerTokenizer(ms: Matcher[]): Tokenizer | undefined {
  for (const m of ms) {
    const tagged = m as Matcher & { __tokenizer?: Tokenizer };
    if (tagged.__tokenizer) return tagged.__tokenizer;
  }
  return undefined;
}

/** Tag a matcher with its inner matcher's tokenizer, if present. */
function tagInnerTokenizer(obj: Matcher, m: Matcher): Matcher {
  const tagged = m as Matcher & { __tokenizer?: Tokenizer };
  if (tagged.__tokenizer)
    return Object.assign(obj, { __tokenizer: tagged.__tokenizer } as Matcher & {
      __tokenizer: Tokenizer;
    });
  return obj;
}

/** Start with given word(s), then anything. */
export function prefixed(...cmdWords: string[]): Matcher {
  return seq(word(...cmdWords), star());
}

/**
 * Sequence: match matchers in order, backtracking on spread/star/repeat.
 */
export function seq(...ms: Matcher[]): Matcher {
  const m = makeExact((tokens, from) =>
    matchSeq(ms, tokens, from, from)
      ? { ok: true, consumed: tokens.length }
      : { ok: false },
  );
  const tokenizer = getInnerTokenizer(ms);
  if (tokenizer)
    return Object.assign(m, { __tokenizer: tokenizer } as Matcher & {
      __tokenizer: Tokenizer;
    });
  return m;
}

function matchSeq(
  ms: Matcher[],
  tokens: Token[],
  mi: number,
  ti: number,
): boolean {
  if (mi === ms.length) return true;
  const m = ms[mi];
  if (m.__spread) {
    for (let c = 0; c <= tokens.length - ti; c++) {
      if (matchSeq(ms, tokens, mi + 1, ti + c)) return true;
    }
    return false;
  }
  if (m.__star) {
    for (let c = ti; c <= tokens.length; c++) {
      if (matchSeq(ms, tokens, mi + 1, c)) return true;
    }
    return false;
  }
  if (m.__repeat) {
    const end = findRepeatEnd(m, tokens, ti);
    for (let pos = end; pos >= ti; pos--) {
      if (matchSeq(ms, tokens, mi + 1, pos)) return true;
    }
    return false;
  }
  const r = m.tryMatch(tokens, ti);
  if (!r.ok) return false;
  return matchSeq(ms, tokens, mi + 1, ti + (r.consumed ?? 0));
}

function findRepeatEnd(m: Matcher, tokens: Token[], from: number): number {
  let pos = from;
  while (pos < tokens.length) {
    const r = m.tryMatch(tokens, pos);
    if (!r.ok) break;
    const consumed = r.consumed ?? 0;
    if (consumed === 0) break;
    pos += consumed;
  }
  return pos;
}

/**
 * Any of: try each matcher, return first success.
 */
export function anyOf(...ms: Matcher[]): Matcher {
  const m = makeExact((tokens, from) => {
    for (const inner of ms) {
      const r = inner.tryMatch(tokens, from);
      if (r.ok) return r;
    }
    return { ok: false };
  });
  const tokenizer = getInnerTokenizer(ms);
  if (tokenizer)
    return Object.assign(m, { __tokenizer: tokenizer } as Matcher & {
      __tokenizer: Tokenizer;
    });
  return m;
}

/**
 * Zero or more: greedily repeat with backtracking.
 */
export function repeat(m: Matcher): Matcher {
  const obj = makeExact((tokens, from) => {
    const end = findRepeatEnd(m, tokens, from);
    return { ok: true, consumed: end - from };
  });
  const tagged = m as Matcher & { __tokenizer?: Tokenizer };
  if (tagged.__tokenizer)
    return Object.assign(obj, {
      __repeat: true,
      __tokenizer: tagged.__tokenizer,
    } as Matcher & { __repeat: true; __tokenizer: Tokenizer });
  return Object.assign(obj, { __repeat: true } as { __repeat: true });
}

/**
 * One or more.
 */
export function repeat1(m: Matcher): Matcher {
  const obj = makeExact((tokens, from) => {
    const first = m.tryMatch(tokens, from);
    if (!first.ok) return { ok: false };
    const firstConsumed = first.consumed ?? 0;
    if (firstConsumed === 0) return { ok: true, consumed: 0 };
    let pos = from + firstConsumed;
    while (pos < tokens.length) {
      const more = m.tryMatch(tokens, pos);
      if (!more.ok) break;
      const consumed = more.consumed ?? 0;
      if (consumed === 0) break;
      pos += consumed;
    }
    return { ok: true, consumed: pos - from };
  });
  return tagInnerTokenizer(obj, m);
}

/**
 * Optional: 0 or 1.
 */
export function opt(m: Matcher): Matcher {
  const obj = makeExact((tokens, from) => {
    const r = m.tryMatch(tokens, from);
    return r.ok ? r : { ok: true, consumed: 0 };
  });
  return tagInnerTokenizer(obj, m);
}

/**
 * Exact N tokens.
 */
export function exact(n: number): Matcher {
  return makeExact((tokens, from) =>
    from + n <= tokens.length ? { ok: true, consumed: n } : { ok: false },
  );
}

/**
 * Star: always matches, consumes all remaining.
 */
export function star(): Matcher {
  return Object.assign(
    makeExact(() => ({ ok: true, consumed: 0 })),
    { __star: true } as { __star: true },
  );
}

/**
 * Spread: backtracking wildcard (like `*` in old patterns).
 */
export function spread(): Matcher {
  const tryMatch: (tokens: Token[], from: number) => MatchResult = (
    tokens,
    from,
  ) => {
    for (let c = 0; c <= tokens.length - from; c++) {
      if (from + c === tokens.length) return { ok: true, consumed: c };
    }
    return { ok: false };
  };
  return Object.assign(makeExact(tryMatch), { __spread: true } as {
    __spread: true;
  });
}

/**
 * Contains: check if the target sequence appears anywhere in the tokens.
 */
export function contains(...targets: Matcher[]): Matcher {
  const obj: Matcher = {
    match: (tokens) => {
      for (let pos = 0; pos <= tokens.length; pos++) {
        if (matchSeq(targets, tokens, 0, pos)) return true;
      }
      return false;
    },
    tryMatch: (tokens, from) => {
      for (let pos = from; pos <= tokens.length; pos++) {
        if (matchSeq(targets, tokens, 0, pos))
          return { ok: true, consumed: tokens.length };
      }
      return { ok: false };
    },
  };
  const tokenizer = getInnerTokenizer(targets);
  if (tokenizer)
    return Object.assign(obj, { __tokenizer: tokenizer } as Matcher & {
      __tokenizer: Tokenizer;
    });
  return obj;
}
