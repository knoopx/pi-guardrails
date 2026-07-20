import { tokenizeBash } from "../tokenizers/bash.js";
import type { Token } from "../types.js";

export type PatternToken =
  | { kind: "literal"; value: string }
  | { kind: "or"; options: string[][] }
  | { kind: "single" }
  | { kind: "spread" };

function splitPatternParts(pattern: string): string[] {
  const parts: string[] = [];
  let current = "";
  let braceDepth = 0;

  for (const ch of pattern) {
    if (ch === "{") {
      braceDepth++;
      current += ch;
    } else if (ch === "}") {
      braceDepth = Math.max(0, braceDepth - 1);
      current += ch;
    } else if (ch === "|" && braceDepth === 0) {
      if (current) {
        parts.push(current);
        current = "";
      }
    } else if (/\s/.test(ch) && braceDepth === 0) {
      if (current) {
        parts.push(current);
        current = "";
      }
    } else {
      current += ch;
    }
  }
  if (current) parts.push(current);
  return parts;
}

export function parsePattern(pattern: string): PatternToken[] {
  const parts = splitPatternParts(pattern.trim());
  return parts.filter(Boolean).map((part): PatternToken => {
    if (part === "*") return { kind: "spread" };
    if (part === "?") return { kind: "single" };
    const orOptions = parseOrToken(part);
    if (orOptions) {
      if (orOptions.length === 1 && orOptions[0].length === 1)
        return { kind: "literal", value: orOptions[0][0] };
      return { kind: "or", options: orOptions };
    }

    return { kind: "literal", value: part };
  });
}

function parseOrToken(token: string): string[][] | null {
  if (!token.startsWith("{") || !token.endsWith("}")) return null;
  const body = token.slice(1, -1);
  const options = body
    .split(",")
    .map((option) => option.trim().split(/\s+/).filter(Boolean))
    .filter((tokens) => tokens.length > 0);

  if (options.length === 0) return null;

  return options;
}

// ── Command matching ─────────────────────────────────────────────────────────

function matchTokens(
  pattern: PatternToken[],
  tokens: Token[],
  pi = 0,
  ti = 0,
): boolean {
  if (pi === pattern.length) return ti === tokens.length;
  const pat = pattern[pi];

  if (pat.kind === "spread") {
    for (let consume = 0; consume <= tokens.length - ti; consume++) {
      if (matchTokens(pattern, tokens, pi + 1, ti + consume)) return true;
    }
    return false;
  }

  if (pat.kind === "single")
    return matchTokens(pattern, tokens, pi + 1, ti + 1);
  const actual = getComparableToken(tokens, ti);

  if (pat.kind === "or")
    return pat.options.some((optionTokens) => {
      if (ti + optionTokens.length > tokens.length) {
        return false;
      }
      for (let j = 0; j < optionTokens.length; j++) {
        const tokenActual = getComparableToken(tokens, ti + j);
        if (!matchLiteralToken(tokenActual, optionTokens[j])) {
          return false;
        }
      }
      return matchTokens(pattern, tokens, pi + 1, ti + optionTokens.length);
    });

  if (!matchLiteralToken(actual, pat.value)) return false;
  return matchTokens(pattern, tokens, pi + 1, ti + 1);
}

function getComparableToken(tokens: Token[], tokenIndex: number): string {
  if (tokenIndex === 0)
    return tokens[tokenIndex].value.split("/").pop() || tokens[tokenIndex].value;

  return tokens[tokenIndex].value;
}

/**
 * Normalize a path token by expanding `~` to $HOME and stripping trailing slashes.
 * This allows patterns like `~/` to match both `~/` (unexpanded) and
 * `$HOME` (expanded) representations of the home directory.
 */
function normalizePathToken(token: string | undefined): string | undefined {
  if (typeof token !== "string") return token;
  // Expand ~/ to $HOME/
  if (token.startsWith("~/")) {
    token = `${process.env.HOME}${token.slice(1)}`;
  } else if (token === "~") {
    token = process.env.HOME;
  }
  if (typeof token !== "string") return token;
  // Strip trailing slash for canonical comparison
  return token.replace(/\/$/, "");
}

function matchLiteralToken(actual: string, expected: string): boolean {
  if (!expected.includes("*")) {
    // For path-like tokens (starting with / or ~), normalize before comparing
    if (expected.startsWith("/") || expected.startsWith("~/") || expected === "~") {
      return normalizePathToken(actual) === normalizePathToken(expected);
    }
    return actual === expected;
  }
  const escaped = expected
    .split("*")
    .map((p) => p.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
    .join(".*");
  return new RegExp(`^${escaped}$`).test(actual);
}

export function matchCommandPattern(
  command: string,
  pattern: string,
): boolean {
  const segments = tokenizeBash(command);
  const patternTokens = parsePattern(pattern);
  if (patternTokens.length === 0) return false;
  return segments.some((seg: Token[]) => matchTokens(patternTokens, seg));
}
