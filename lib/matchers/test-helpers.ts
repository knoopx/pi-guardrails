import type { Token } from "./types.js";

/** Create a typed token. */
export function token(type: string, value: string): Token {
  return { type, value };
}

/**
 * Convert a 2D string array to Token[][].
 * Usage: expect(tokenizeBash("...")).toEqual(s([["cd", "/tmp"], ["npm", "install", "|", "cat"]]));
 */
export function s(segments: string[][]): Token[][] {
  return segments.map((seg) =>
    seg.map((v) => {
      if (v === "|" || v === "||" || v === "&&") return token("operator", v);
      return token("word", v);
    }),
  );
}

/**
 * Convert a 1D string array to Token[].
 * Usage: expect(result).toEqual(t(["a", "b"]));
 */
export function t(...values: string[]): Token[] {
  return values.map((v) => {
    if (v === "|" || v === "||" || v === "&&") return token("operator", v);
    return token("word", v);
  });
}
