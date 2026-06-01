/**
 * Suggestion helpers for fail-fast schema validation.
 *
 * The boot validator uses `closestMatch` to turn a typo into a
 * "did you mean?" hint — turning `type: 'datetimme'` into
 * `unknown type "datetimme" — did you mean "datetime"?`.
 */

/**
 * Levenshtein distance between two strings. Iterative two-row implementation,
 * O(n * m) time and O(min(n, m)) memory. Lowercase-insensitive.
 */
export function levenshtein(a: string, b: string): number {
  const s = a.toLowerCase()
  const t = b.toLowerCase()
  if (s === t) return 0
  if (s.length === 0) return t.length
  if (t.length === 0) return s.length

  let prev: number[] = Array.from({ length: t.length + 1 }, (_, i) => i)
  let curr: number[] = new Array(t.length + 1)

  for (let i = 1; i <= s.length; i++) {
    curr[0] = i
    for (let j = 1; j <= t.length; j++) {
      const cost = s[i - 1] === t[j - 1] ? 0 : 1
      curr[j] = Math.min(
        curr[j - 1]! + 1, // insertion
        prev[j]! + 1, // deletion
        prev[j - 1]! + cost // substitution
      )
    }
    ;[prev, curr] = [curr, prev]
  }
  return prev[t.length]!
}

/**
 * Return the closest candidate to `input` whose edit distance is at most
 * `maxDistance`, or `null` if nothing qualifies. Ties pick the first match
 * in `candidates` order — callers should sort their list if they want a
 * deterministic preference (e.g. alphabetical).
 */
export function closestMatch(
  input: string,
  candidates: Iterable<string>,
  maxDistance = 3
): string | null {
  let best: string | null = null
  let bestDist = maxDistance + 1
  for (const candidate of candidates) {
    const d = levenshtein(input, candidate)
    if (d < bestDist) {
      best = candidate
      bestDist = d
    }
  }
  return bestDist <= maxDistance ? best : null
}
