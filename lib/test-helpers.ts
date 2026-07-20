import type { Token } from "./matchers/types.js";

/** Create a typed token. */
export function token(type: string, value: string): Token {
  return { type, value };
}


