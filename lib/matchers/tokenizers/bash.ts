import { parse } from "shell-quote";
import type { Token } from "../types.js";

const ENV_VAR_ASSIGNMENT = /^[A-Za-z_][A-Za-z0-9_]*=/;
const COMMAND_WRAPPERS = new Set([
  "env",
  "command",
  "exec",
  "nohup",
  "nice",
  "time",
]);

const SEGMENT_SPLITTERS = new Set(["||", "&&", ";"]);

export function tokenizeBash(command: string): Token[][] {
  const trimmed = command.trim();
  if (!trimmed) return [];

  const parsed = parseShell(trimmed);
  const segments: Token[][] = [];
  const current: Token[] = [];

  for (const token of parsed) {
    processToken(token, current, SEGMENT_SPLITTERS, segments);
  }

  if (current.length > 0) segments.push(normalizeSegment(current));

  return segments;
}

function parseShell(command: string): ReturnType<typeof parse> {
  const result = parse(command);
  // shell-quote treats ? and * as glob chars even in URLs.
  // If the entire input was parsed as a single glob pattern, fall back
  // to simple whitespace splitting (the input is likely a URL or path).
  if (
    result.length === 1 &&
    typeof result[0] === "object" &&
    "pattern" in result[0] &&
    "op" in result[0] &&
    result[0].op === "glob" &&
    command.includes("://")
  ) {
    return command.split(/\s+/).filter(Boolean);
  }
  return result;
}

function makeToken(value: string, type: string): Token {
  return { type, value };
}

function processToken(
  token: ReturnType<typeof parse>[number],
  current: Token[],
  segmentSplitters: Set<string>,
  segments: Token[][],
): void {
  if (isOperator(token)) {
    handleOperator(token.op, current, segmentSplitters, segments);
  } else if (typeof token === "string") {
    current.push(
      makeToken(
        token,
        ENV_VAR_ASSIGNMENT.test(token)
          ? "env"
          : COMMAND_WRAPPERS.has(token)
            ? "wrapper"
            : "word",
      ),
    );
  } else if (typeof token === "object" && "comment" in token) {
    // shell-quote treats # as comment start. Append the #comment to the preceding word
    // so that "nixpkgs#foo" stays as "nixpkgs#foo" instead of being split into "nixpkgs" + comment.
    if (current.length > 0) {
      const last = current[current.length - 1];
      if (last.type === "word") {
        last.value += "#" + (token as { comment: string }).comment;
      } else {
        current.push(
          makeToken("#" + (token as { comment: string }).comment, "word"),
        );
      }
    }
  }
}

function isOperator(
  token: ReturnType<typeof parse>[number],
): token is { op: string } {
  return (
    typeof token === "object" &&
    token !== null &&
    "op" in token &&
    typeof (token as { op: unknown }).op === "string"
  );
}

function handleOperator(
  op: string,
  current: Token[],
  segmentSplitters: Set<string>,
  segments: Token[][],
): void {
  if (segmentSplitters.has(op)) {
    finalizeSegment(current, segments);
  } else {
    current.push(makeToken(op, "operator"));
  }
}

function finalizeSegment(current: Token[], segments: Token[][]): void {
  if (current.length > 0) {
    segments.push(normalizeSegment(current));
    current.length = 0;
  }
}

function normalizeSegment(tokens: Token[]): Token[] {
  let i = 0;
  while (
    i < tokens.length &&
    (tokens[i].type === "env" || tokens[i].type === "wrapper")
  ) {
    i++;
  }
  return i < tokens.length ? tokens.slice(i) : tokens;
}
