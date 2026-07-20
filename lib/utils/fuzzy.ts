/**
 * Fuzzy matching utility — Levenshtein distance with threshold.
 */

/**
 * Calculate the Levenshtein edit distance between two strings.
 * Standard dynamic programming algorithm.
 */
export function levenshtein(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  const dp: number[][] = Array.from({ length: m + 1 }, () =>
    Array(n + 1).fill(0),
  );

  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;

  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (a[i - 1] === b[j - 1]) {
        dp[i][j] = dp[i - 1][j - 1];
      } else {
        dp[i][j] = 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
      }
    }
  }

  return dp[m][n];
}

/**
 * Check if a string matches any target string within a given edit distance.
 * @param str - The input string to check
 * @param targets - Array of target strings to match against
 * @param maxDistance - Maximum Levenshtein distance to consider a match
 * @returns The closest matching target string, or null if no match within threshold
 */
export function fuzzyMatch(
  str: string,
  targets: string[],
  maxDistance: number,
): string | null {
  let bestMatch: string | null = null;
  let bestDist = maxDistance + 1;

  for (const target of targets) {
    const dist = levenshtein(str, target);
    if (dist < bestDist) {
      bestDist = dist;
      bestMatch = target;
    }
  }

  return bestDist <= maxDistance ? bestMatch : null;
}

/**
 * Find all targets within a given edit distance from the input string.
 * @param str - The input string
 * @param targets - Array of target strings
 * @param maxDistance - Maximum Levenshtein distance
 * @returns Array of matched targets
 */
export function fuzzyMatchAll(
  str: string,
  targets: string[],
  maxDistance: number,
): string[] {
  const results: string[] = [];

  for (const target of targets) {
    const dist = levenshtein(str, target);
    if (dist <= maxDistance) {
      results.push(target);
    }
  }

  return results;
}

/**
 * Check if a string is a substring match of any target, with optional fuzziness.
 * @param str - The input string
 * @param targets - Array of target strings
 * @param maxDistance - Maximum Levenshtein distance for fuzzy matching
 * @returns The closest matching target string, or null
 */
export function substringFuzzyMatch(
  str: string,
  targets: string[],
  maxDistance: number,
): string | null {
  // First try exact substring match
  for (const target of targets) {
    if (target.includes(str) || str.includes(target)) {
      return target;
    }
  }

  // Then try fuzzy match
  return fuzzyMatch(str, targets, maxDistance);
}
