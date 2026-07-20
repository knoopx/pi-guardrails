import { describe, it, expect } from "vitest";
import {
  levenshtein,
  fuzzyMatch,
  fuzzyMatchAll,
  substringFuzzyMatch,
} from "./fuzzy.js";

describe("levenshtein", () => {
  it("returns 0 for identical strings", () => {
    expect(levenshtein("hello", "hello")).toBe(0);
  });

  it("returns 0 for empty strings", () => {
    expect(levenshtein("", "")).toBe(0);
  });

  it("computes correct edit distance", () => {
    expect(levenshtein("kitten", "sitting")).toBe(3);
    expect(levenshtein("abc", "ab")).toBe(1);
    expect(levenshtein("", "abc")).toBe(3);
    expect(levenshtein("abc", "")).toBe(3);
  });
});

describe("fuzzyMatch", () => {
  it("finds exact match", () => {
    expect(fuzzyMatch("hello", ["hello", "world"], 2)).toBe("hello");
  });

  it("finds fuzzy match within distance", () => {
    expect(fuzzyMatch("helo", ["hello", "world"], 2)).toBe("hello");
  });

  it("returns null when no match within distance", () => {
    expect(fuzzyMatch("xyz", ["hello", "world"], 2)).toBeNull();
  });

  it("returns null when distance threshold is 0 and no exact match", () => {
    expect(fuzzyMatch("helo", ["hello", "world"], 0)).toBeNull();
  });

  it("finds closest match when multiple are within range", () => {
    expect(fuzzyMatch("ab", ["abc", "abcd"], 2)).toBe("abc");
  });
});

describe("fuzzyMatchAll", () => {
  it("returns all matches within distance", () => {
    expect(fuzzyMatchAll("hello", ["hello", "world", "hallo"], 2)).toEqual([
      "hello",
      "hallo",
    ]);
  });

  it("returns empty array when no matches", () => {
    expect(fuzzyMatchAll("xyz", ["hello", "world"], 2)).toEqual([]);
  });

  it("returns all when distance is large", () => {
    expect(fuzzyMatchAll("hello", ["hello", "world"], 10)).toEqual([
      "hello",
      "world",
    ]);
  });
});

describe("substringFuzzyMatch", () => {
  it("finds exact substring match", () => {
    expect(substringFuzzyMatch("ell", ["hello", "world"], 2)).toBe("hello");
    expect(substringFuzzyMatch("hello", ["hel", "world"], 2)).toBe("hel");
  });

  it("falls back to fuzzy match", () => {
    expect(substringFuzzyMatch("helo", ["hello", "world"], 2)).toBe("hello");
  });

  it("returns null when no match", () => {
    expect(substringFuzzyMatch("xyz", ["hello", "world"], 2)).toBeNull();
  });
});
