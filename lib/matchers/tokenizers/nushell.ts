import type { Token } from "../types.js";
import { token } from "../helpers.js";

// ── String literal parsers ────────────────────────────────────────────────────

/** Configuration for a string literal type. */
interface StringConfig {
  quote: string;
  escape: string | null;
  escapeSeq: string | null;
}

/**
 * Parse a string literal, advancing past the closing delimiter.
 * Returns [content, newI].
 */
function parseStringLiteral(command: string, start: number, config: StringConfig): [string, number] {
  let content = "";
  let i = start;
  while (i < command.length) {
    const c = command[i];
    // Backslash escape sequences
    if (config.escape && c === config.escape && i + 1 < command.length) {
      content += command[i + 1];
      i += 2;
      continue;
    }
    // Quote character — end of string or escape sequence (e.g. '' → ')
    if (c === config.quote) {
      if (config.escapeSeq && i + 1 < command.length && command.substring(i, i + 2) === config.escapeSeq) {
        content += config.escapeSeq[0];
        i += 2;
        continue;
      }
      return [content, i + 1];
    }
    content += c;
    i++;
  }
  return [content, i];
}

// ── Segment management ────────────────────────────────────────────────────────

/** Finalize current segment and push to segments list. */
function finalizeSegment(current: Token[], segments: Token[][]): void {
  if (current.length > 0) {
    segments.push([...current]);
    current.length = 0;
  }
}

/** Classify a non-whitespace character. */
type CharKind = "string" | "variable" | "segmentSplit" | "word";

function classifyChar(command: string, i: number): CharKind {
  const ch = command[i];
  if (ch === '"' || ch === "'" || ch === "`") return "string";
  if (ch === "$") return "variable";
  if (ch === "|") return "segmentSplit";
  if (ch === "&" && i + 1 < command.length && command[i + 1] === "&") return "segmentSplit";
  return "word";
}

/** Parse a string literal, pushing it to current segment. */
function parseString(command: string, i: number, current: Token[]): number {
  const ch = command[i];
  let config: StringConfig;
  switch (ch) {
    case '"': config = { quote: '"', escape: "\\", escapeSeq: null }; break;
    case "'": config = { quote: "'", escape: null, escapeSeq: "''" }; break;
    default: config = { quote: "`", escape: "\\", escapeSeq: null };
  }
  const [content, newI] = parseStringLiteral(command, i + 1, config);
  current.push(token(content, "string"));
  return newI;
}

/** Parse a variable token ($var, $env.VAR, etc.). */
function parseVariable(command: string, i: number, current: Token[]): number {
  let varChars = "$";
  i++;
  while (i < command.length && /[A-Za-z0-9_\.]/.test(command[i])) {
    varChars += command[i];
    i++;
  }
  current.push(token(varChars, "variable"));
  return i;
}

/** Parse a word token (non-whitespace, non-operator sequence). */
function parseWord(command: string, i: number, current: Token[]): number {
  let chars = "";
  while (i < command.length && !/\s|[\|&]/.test(command[i])) {
    chars += command[i];
    i++;
  }
  if (chars.length > 0) current.push(token(chars, "word"));
  return i;
}

// ── Main tokenizer ────────────────────────────────────────────────────────────

/**
 * Tokenize Nushell commands into segments. Segments are split on pipe `|` only.
 *
 * Handles:
 * - Double-quoted strings with escape sequences
 * - Single-quoted literal strings (no escapes, '' = ')
 * - Backtick strings with escape sequences
 * - Variables ($var, $env.VAR, $in, $nothing)
 * - Pipe operators as segment splitters
 * - Command operators (&&, ||, etc.)
 * - Whitespace as delimiters
 */
export function tokenizeNushell(command: string): Token[][] {
  const segments: Token[][] = [];
  const current: Token[] = [];
  let i = 0;

  while (i < command.length) {
    const ch = command[i];

    // Whitespace — skip, doesn't split segments
    if (/\s/.test(ch)) {
      i++;
      continue;
    }

    // Dispatch based on character type
    switch (classifyChar(command, i)) {
      case "string":
        i = parseString(command, i, current);
        break;
      case "variable":
        i = parseVariable(command, i, current);
        break;
      case "segmentSplit":
        // Single pipe — segment splitter; || — token in current segment
        if (ch === "|") {
          if (i + 1 < command.length && command[i + 1] === "|") {
            finalizeSegment(current, segments);
            current.push(token("||", "operator"));
            i += 2;
          } else {
            finalizeSegment(current, segments);
            i++;
          }
        } else {
          // && — segment splitter (no token emitted)
          finalizeSegment(current, segments);
          i += 2;
        }
        break;
      case "word":
        i = parseWord(command, i, current);
        break;
    }
  }

  if (current.length > 0) segments.push([...current]);
  return segments;
}
