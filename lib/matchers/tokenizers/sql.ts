import type { Token } from "../types.js";
import { token, emitWord } from "../helpers.js";

// Character classification helpers
const SPACE = /\s/;
const WORD_CHAR = /[A-Za-z0-9_\.@%$-]/;
const SINGLE_CHAR_OPS = "(,;:=<>![]";
const IS_OPERATOR = SINGLE_CHAR_OPS.includes.bind(SINGLE_CHAR_OPS);

/**
 * Parse a raw string (r'...' or R'...'), advancing `i` past the closing quote.
 * Returns [fullToken, newI] where fullToken includes the r/R prefix.
 */
function parseRawString(command: string, i: number): [string, number] {
  const prefix = command[i]; // 'r' or 'R'
  let strContent = "";
  let pos = i + 2; // skip prefix + opening quote
  while (pos < command.length && command[pos] !== "'") {
    strContent += command[pos];
    pos++;
  }
  return [`${prefix}'${strContent}'`, pos + 1];
}

/**
 * Parse a single-quoted string with escape sequences (backslash).
 * Returns [content, newI].
 */
function parseSingleQuotedString(command: string, start: number): [string, number] {
  let content = "";
  let i = start;
  while (i < command.length) {
    const c = command[i];
    if (c === "'") return [content, i + 1];
    if (c === "\\" && i + 1 < command.length) {
      content += command[i] + command[i + 1];
      i += 2;
    } else {
      content += c;
      i++;
    }
  }
  return [content, i];
}

/**
 * Parse a double-quoted identifier, advancing `i` past the closing quote.
 * Returns [content, newI].
 */
function parseDoubleQuotedId(command: string, start: number): [string, number] {
  let content = "";
  let i = start;
  while (i < command.length && command[i] !== '"') {
    content += command[i];
    i++;
  }
  return [content, i + 1];
}

/**
 * Consume a word character sequence (identifier or number).
 * Returns [chars, newI].
 */
function parseWordCharSequence(command: string, start: number): [string, number] {
  let chars = "";
  let i = start;
  while (i < command.length && WORD_CHAR.test(command[i])) {
    chars += command[i];
    i++;
  }
  return [chars, i];
}

/**
 * Character classification — which category does this character belong to?
 * Takes the command string and index so it can look ahead for raw strings.
 */
type CharKind = "rawString" | "singleQuoted" | "doubleQuoted" | "whitespace" | "operator" | "closingParen" | "wordChar" | "pipe" | "other";

function classifyChar(command: string, i: number, prevIsStart: boolean): CharKind {
  if (prevIsStart && (command[i] === "r" || command[i] === "R")
      && i + 1 < command.length && command[i + 1] === "'") {
    return "rawString";
  }
  if (command[i] === "'") return "singleQuoted";
  if (command[i] === '"') return "doubleQuoted";
  if (SPACE.test(command[i])) return "whitespace";
  if (IS_OPERATOR(command[i])) return "operator";
  if (command[i] === ")") return "closingParen";
  if (command[i] === "|") return "pipe";
  if (WORD_CHAR.test(command[i])) return "wordChar";
  return "other";
}

/**
 * Tokenize SQL commands (DuckDB, SQLite, etc.) into segments.
 * SQL has no segment splitters — all tokens go into a single segment.
 */
export function tokenizeSql(command: string): Token[][] {
  const tokens: Token[] = [];
  let currentToken: string[] = [];
  let i = 0;

  while (i < command.length) {
    const ch = command[i];
    const prevTokenEmpty = currentToken.length === 0;

    switch (classifyChar(command, i, prevTokenEmpty)) {
      case "rawString": {
        const [fullToken, newI] = parseRawString(command, i);
        tokens.push(token(fullToken, "rawstring"));
        i = newI;
        break;
      }
      case "singleQuoted": {
        const [content, newI] = parseSingleQuotedString(command, i + 1);
        tokens.push(token(content, "string"));
        i = newI;
        break;
      }
      case "doubleQuoted": {
        const [content, newI] = parseDoubleQuotedId(command, i + 1);
        tokens.push(token(content, "identifier"));
        i = newI;
        break;
      }
      case "whitespace":
        emitWord(tokens, currentToken);
        i++;
        break;
      case "operator":
        emitWord(tokens, currentToken);
        tokens.push(token(ch, "operator"));
        i++;
        break;
      case "closingParen":
        emitWord(tokens, currentToken);
        tokens.push(token(ch, "paren"));
        i++;
        break;
      case "wordChar": {
        const [chars, newI] = parseWordCharSequence(command, i);
        tokens.push(token(chars, "word"));
        i = newI;
        break;
      }
      case "pipe":
        // Pipe — stop tokenizing (subprocess boundary)
        if (currentToken.length > 0) emitWord(tokens, currentToken);
        return tokens.length > 0 ? [tokens] : [];
      default:
        tokens.push(token(ch, "word"));
        i++;
    }
  }

  if (currentToken.length > 0) emitWord(tokens, currentToken);
  return tokens.length > 0 ? [tokens] : [];
}
