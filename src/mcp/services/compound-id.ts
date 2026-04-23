/**
 * Compound ID utilities — parse and build path-based compound IDs.
 *
 * Compound IDs mirror REST URL paths, encoding the full resource hierarchy:
 *   "titles/42/assets/7" → parent "titles/42", child "assets/7"
 *
 * Simple IDs (no "/") pass through unchanged.
 */

// ============================================================================
// Types
// ============================================================================

/** A single resource/id segment in a compound path. */
export interface IdSegment {
  resource: string
  id: string
}

/** Result of parsing a record ID string. */
export interface ParsedId {
  /** Ordered resource/id pairs (empty for simple IDs). */
  segments: IdSegment[]
  /** The leaf (innermost) record ID. */
  leafId: string
  /** Collection path (everything before the leaf ID). */
  collectionPath: string
  /** Full record path including leaf ID. */
  recordPath: string
  /** Whether this ID encodes a nested hierarchy. */
  isCompound: boolean
}

// ============================================================================
// Functions
// ============================================================================

/**
 * Parse a record ID string into its compound structure.
 *
 * A compound ID has the shape "resource1/id1/resource2/id2/…" — an even
 * number of slash-separated tokens forming (resource, id) pairs.
 * A simple ID has no slashes and is treated as a plain leaf ID.
 *
 * @param recordId   The record ID string (simple or compound).
 * @param endpoint   The model's endpoint (used to build collectionPath for simple IDs).
 */
export function parseId(recordId: string, endpoint: string): ParsedId {
  if (!recordId.includes('/')) {
    return {
      segments: [],
      leafId: recordId,
      collectionPath: endpoint,
      recordPath: `${endpoint}/${recordId}`,
      isCompound: false
    }
  }

  const parts = recordId.split('/')
  const segments: IdSegment[] = []

  // Pairs of (resource, id)
  for (let i = 0; i + 1 < parts.length; i += 2) {
    segments.push({ resource: parts[i]!, id: parts[i + 1]! })
  }

  const leafId = segments[segments.length - 1]!.id
  const collectionPath = parts.slice(0, -1).join('/')
  const recordPath = recordId

  return { segments, leafId, collectionPath, recordPath, isCompound: true }
}

/**
 * Build a compound record ID from parent and child context.
 *
 * @example buildCompoundId('titles', '42', 'assets', '7') → 'titles/42/assets/7'
 */
export function buildCompoundId(
  parentEndpoint: string,
  parentId: string,
  childEndpoint: string,
  childId: string
): string {
  return `${parentEndpoint}/${parentId}/${childEndpoint}/${childId}`
}

/**
 * Build a collection path for nested resources under a parent.
 *
 * @example buildCollectionPath('titles', '42', 'assets') → 'titles/42/assets'
 */
export function buildCollectionPath(
  parentEndpoint: string,
  parentId: string,
  childEndpoint: string
): string {
  return `${parentEndpoint}/${parentId}/${childEndpoint}`
}
