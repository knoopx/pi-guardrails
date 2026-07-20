/**
 * Composable chainable matcher helpers.
 *
 * Primitives: word(), regex(), anyToken(), path()
 * Combos: seq(), anyOf(), repeat(), repeat1(), opt(), exact(), star(), spread(), contains(), prefixed()
 * Tokenizers: tokenizeBash, tokenizeSql, tokenizeNushell
 */

export { type MatchResult, type Matcher } from "./types.js";
export { word, regex, anyToken, path } from "./primitives.js";
export {
  seq,
  anyOf,
  repeat,
  repeat1,
  opt,
  exact,
  star,
  spread,
  contains,
  prefixed,
} from "./combinators.js";

export { tokenizeBash } from "./tokenizers/bash.js";
export { tokenizeSql } from "./tokenizers/sql.js";
export { tokenizeNushell } from "./tokenizers/nushell.js";
export { parsePattern, matchCommandPattern } from "./patterns/command.js";
export { matchFileNamePattern, matchContentPattern } from "./patterns/file.js";
