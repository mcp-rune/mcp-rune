/**
 * Deterministic book-fixture generator used by the bookshelf example to
 * showcase the five built-in summary strategies on a non-trivial dataset.
 *
 * The shape is intentionally varied so every strategy has something to
 * say on a single pass over the data:
 *
 *   - `distribution`      → spread of `status`, `genre_id`, `rating`.
 *   - `coverage`          → ~25% of records intentionally miss `rating`,
 *                            ~40% miss `notes` — both above the strategy's
 *                            50% flag threshold on certain pages.
 *   - `anomaly`           → ~1% of records carry a very high `pages` count
 *                            so the z-score path lights up.
 *   - `temporal`          → `created_at` / `updated_at` spread across ~24
 *                            months with deliberate gap regions.
 *   - `entity-extraction` → `genre_id` is a stable foreign-key-shaped field
 *                            with a small enum, so the FK crosswalk has a
 *                            meaningful top-N.
 *
 * No `Math.random()` — uses a small seeded PRNG so the same `count`
 * produces byte-identical output across runs (the checked-in
 * `books.5000.json` is exactly `generateBookFixtures(5000)`).
 */

import type { StubFixtures } from '@mcp-rune/mcp-rune/core'

const AUTHORS = [
  'Robert C. Martin',
  'Martin Fowler',
  'Kent Beck',
  'Erich Gamma',
  'Andrew Hunt',
  'David Thomas',
  'Sandi Metz',
  'Michael Feathers',
  'Eric Evans',
  'Gerald Weinberg'
] as const

const STATUSES = ['unread', 'reading', 'completed'] as const

const GENRES = [
  'g-software',
  'g-architecture',
  'g-management',
  'g-testing',
  'g-databases',
  'g-distributed'
] as const

const TITLE_NOUNS = [
  'Patterns',
  'Refactoring',
  'Code',
  'Practices',
  'Systems',
  'Design',
  'Architecture',
  'Workflows',
  'Testing',
  'Deployment',
  'Observability',
  'Models',
  'Contracts',
  'Protocols'
]

const TITLE_ADJECTIVES = [
  'Clean',
  'Pragmatic',
  'Resilient',
  'Distributed',
  'Reactive',
  'Idiomatic',
  'Deliberate',
  'Layered',
  'Composable',
  'Declarative'
]

// Anchor the temporal window at a fixed point so the dataset is stable
// regardless of when the example is run. Quickstart docs read the year
// out of this constant — keep both in sync if you change it.
const TEMPORAL_ORIGIN = Date.UTC(2024, 0, 1)
const TEMPORAL_SPAN_MS = 24 * 30 * 24 * 60 * 60 * 1000 // ~24 months

// Tiny LCG. Sufficient for a stable, deterministic shuffle; not for crypto.
function makeRng(seed: number): () => number {
  let state = seed >>> 0
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0
    return state / 0x100000000
  }
}

function pick<T>(rng: () => number, arr: ReadonlyArray<T>): T {
  return arr[Math.floor(rng() * arr.length)]!
}

function generateBook(rng: () => number, i: number): Record<string, unknown> {
  const id = String(i)
  const title = `${pick(rng, TITLE_ADJECTIVES)} ${pick(rng, TITLE_NOUNS)} #${i}`
  const author = pick(rng, AUTHORS)
  const status = pick(rng, STATUSES)
  const genre_id = pick(rng, GENRES)

  // Coverage: ~25% miss `rating`, ~40% miss `notes`.
  const hasRating = rng() > 0.25
  const hasNotes = rng() > 0.4

  // Anomaly: 1% of records carry a very high `pages` count.
  const isPageOutlier = rng() < 0.01
  const pages = isPageOutlier ? 2000 + Math.floor(rng() * 1500) : 120 + Math.floor(rng() * 400)

  // Temporal: spread across ~24 months around TEMPORAL_ORIGIN. A 60-day
  // gap mid-window gives the temporal strategy a real gap to surface.
  let offsetMs = Math.floor(rng() * TEMPORAL_SPAN_MS)
  const gapStart = TEMPORAL_SPAN_MS / 2 - 30 * 24 * 60 * 60 * 1000
  const gapEnd = TEMPORAL_SPAN_MS / 2 + 30 * 24 * 60 * 60 * 1000
  if (offsetMs > gapStart && offsetMs < gapEnd) offsetMs -= 60 * 24 * 60 * 60 * 1000
  if (offsetMs < 0) offsetMs += TEMPORAL_SPAN_MS
  const createdAt = new Date(TEMPORAL_ORIGIN + offsetMs).toISOString()
  const updatedAt = new Date(
    TEMPORAL_ORIGIN + offsetMs + Math.floor(rng() * 14 * 24 * 60 * 60 * 1000)
  ).toISOString()

  const record: Record<string, unknown> = {
    id,
    title,
    author,
    status,
    genre_id,
    pages,
    created_at: createdAt,
    updated_at: updatedAt
  }
  if (hasRating) {
    // Skew toward 4–5 so 1–2 stars are genuine outliers (good signal for anomaly).
    const r = rng()
    record.rating = r < 0.05 ? 1 : r < 0.12 ? 2 : r < 0.25 ? 3 : r < 0.6 ? 4 : 5
  }
  if (hasNotes) {
    record.notes = `Notes on ${record.title} — chapter highlights and follow-ups.`
  }
  return record
}

/**
 * Generate `count` book records keyed by id (as strings, "1".."count").
 * Deterministic: the same `count` and `seed` produce the same output.
 */
export function generateBookFixtures(count: number, seed = 0xb00c): StubFixtures {
  const rng = makeRng(seed)
  const book: Record<string, Record<string, unknown>> = {}
  for (let i = 1; i <= count; i++) {
    book[String(i)] = generateBook(rng, i)
  }
  return { book }
}

/**
 * Generate a graph-shaped fixture: separate `author`, `genre`, and `book`
 * collections with proper FK relationships. Each book has both `author_id`
 * and `genre_id`. Used by analysis_ingest with `hop_depth: 1` so the
 * multi-hop fetcher pulls authors + genres into the same session.
 *
 * Exercises:
 *   - declared belongsTo edges (book → author, book → genre)
 *   - record embeddings (text fields per record)
 *   - relationship-coverage (~5% of books deliberately lack author_id to
 *     produce a coverage gap)
 */
export function generateGraphFixtures(bookCount = 500, seed = 0xc0de): StubFixtures {
  const rng = makeRng(seed)

  const genre: Record<string, Record<string, unknown>> = {}
  for (let i = 0; i < GENRES.length; i++) {
    const id = GENRES[i]!
    genre[id] = {
      id,
      name: id.replace('g-', '').replace(/^./, (c) => c.toUpperCase()),
      slug: id.replace('g-', ''),
      description: `Books in the ${id.replace('g-', '')} space.`
    }
  }

  const author: Record<string, Record<string, unknown>> = {}
  for (let i = 0; i < AUTHORS.length; i++) {
    const id = `a-${i + 1}`
    author[id] = {
      id,
      name: AUTHORS[i],
      nationality: pick(rng, ['American', 'British', 'Canadian', 'German', 'Dutch']),
      birth_year: 1940 + Math.floor(rng() * 50)
    }
  }
  const authorIds = Object.keys(author)

  const book: Record<string, Record<string, unknown>> = {}
  for (let i = 1; i <= bookCount; i++) {
    const base = generateBook(rng, i)
    const author_id = rng() > 0.05 ? pick(rng, authorIds) : null
    base.author_id = author_id
    // Keep the existing `author` denormalized name for backwards compat
    // (some quickstarts and the existing strategies expect it).
    if (author_id) {
      base.author = (author[author_id] as { name: string }).name
    }
    // Strip rating off ~15% of completed books so rule-violation surfaces
    // a real workflow gap on the bookshelf demo. Other statuses keep
    // their rating untouched.
    if (base.status === 'completed' && rng() < 0.15) {
      delete base.rating
    }
    book[String(i)] = base
  }

  return { book, author, genre }
}
