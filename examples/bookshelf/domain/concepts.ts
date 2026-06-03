import { DomainConcept } from '@mcp-rune/mcp-rune/domain'

/**
 * A book's reading pipeline spans the book itself + its genre (subject area).
 * The `concept-touch` summary strategy uses this to ask: how many books in
 * this page have ≥1 edge into the `genre` model? Combined with
 * relationship-coverage, this surfaces records that the catalog has lost
 * connection to a real subject classification.
 */
export const READING_PIPELINE_CONCEPT = new DomainConcept({
  name: 'reading-pipeline',
  title: 'Book → Genre',
  description:
    'A book belongs to a genre. Reading-pipeline coverage means a book is connected to ' +
    'at least one classified genre so it can be surfaced in recommendations and reading lists.',
  models: ['book', 'genre'],
  tags: ['catalog', 'classification'],
  details: {
    process:
      'When a book lacks a genre edge it is invisible to the genre browser and any ' +
      'recommendation flow that filters by topic.',
    tips: [
      'Pair `concept-touch` with `relationship-coverage` to see which edge types fail to land.',
      'Pair with `concept` stratifier sampling to spot-check the gap records directly.'
    ]
  }
})

/**
 * The catalogue concept spans book + author + genre — three-way participation.
 * Used by `concept-touch` to surface books where any one of those edges is
 * missing, even when one or two are present.
 */
export const CATALOGUE_CONCEPT = new DomainConcept({
  name: 'catalogue',
  title: 'Book → Author × Genre',
  description:
    'A fully cataloged book is connected to both an author and a genre. Partial ' +
    'catalog coverage hurts search, discovery, and analytics.',
  models: ['book', 'author', 'genre'],
  tags: ['catalog', 'completeness']
})

export const BOOKSHELF_CONCEPTS = [READING_PIPELINE_CONCEPT, CATALOGUE_CONCEPT]
