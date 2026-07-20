/**
 * Composable chainable matcher helpers.
 *
 * Primitives: word(), regex(), anyToken(), path()
 * Combos: seq(), anyOf(), repeat(), repeat1(), opt(), exact(), star(), spread(), contains(), prefixed()
 * Tokenizers: tokenizeBash, tokenizeSql, tokenizeNushell
 */


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

