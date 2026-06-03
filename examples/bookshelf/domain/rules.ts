import { BusinessRule } from '@mcp-rune/mcp-rune/domain'

/**
 * A completed book without a rating is a workflow inconsistency: the reader
 * marked the book done but never recorded an opinion. The `rule-violation`
 * summary strategy uses this to surface partial-completion records that need
 * a follow-up.
 *
 * In the bookshelf graph fixture, ~15% of `completed` books deliberately lack
 * `rating` so this rule has real violations to report.
 */
export const COMPLETED_BOOKS_NEED_RATING = new BusinessRule({
  name: 'completed-books-need-rating',
  description: 'A book marked as `completed` must carry a numeric `rating` (1–5).',
  scope: ['book'],
  severity: 'warning',
  tags: ['readability', 'workflow'],
  evaluate(record) {
    const status = record.status as string | undefined
    if (status !== 'completed') {
      return { passed: true, message: 'Rule applies only to completed books.' }
    }
    const rating = record.rating
    if (typeof rating !== 'number') {
      return {
        passed: false,
        message: `Completed book "${record.title ?? record.id}" is missing a rating.`,
        suggestion: 'Set `rating` to an integer 1–5 before marking the book completed.'
      }
    }
    if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
      return {
        passed: false,
        message: `Completed book "${record.title ?? record.id}" has invalid rating ${rating}.`,
        suggestion: 'Set `rating` to an integer 1–5.'
      }
    }
    return { passed: true, message: 'OK' }
  }
})

/**
 * Every book must be associated with an author. The graph fixture intentionally
 * leaves ~5% of books with no `author_id` to make this rule fire alongside
 * `relationship-coverage`.
 */
export const BOOKS_NEED_AUTHOR = new BusinessRule({
  name: 'books-need-author',
  description: 'Every book record must carry a non-null `author_id`.',
  scope: ['book'],
  severity: 'error',
  tags: ['catalog', 'integrity'],
  evaluate(record) {
    const authorId = record.author_id
    if (authorId == null || authorId === '') {
      return {
        passed: false,
        message: `Book "${record.title ?? record.id}" has no author.`,
        suggestion: 'Set `author_id` to the id of an existing author record.'
      }
    }
    return { passed: true, message: 'OK' }
  }
})

export const BOOKSHELF_RULES = [COMPLETED_BOOKS_NEED_RATING, BOOKS_NEED_AUTHOR]
