/**
 * SummaryStrategy — pluggable per-page summary generator for analysis_ingest
 * and analysis_summarize.
 *
 * A strategy is a deterministic pure function over a page of records. It
 * never calls the network, an LLM, or any I/O; given the same input it
 * always produces the same output. The framework persists the result as an
 * `analysis_memories` row (embedded for semantic recall) so the LLM can
 * pivot between strategies without re-fetching from the source API.
 */

export interface SummaryInput {
  /** Analysis session id; passed through to the persisted memory row. */
  analysisId: string
  /** Model name being summarized. */
  model: string
  /**
   * Page index (1-based). For callers without natural pagination
   * (nested resources, `analysis_summarize` re-runs) pass 1.
   */
  page: number
  /** Total pages, or null when unknown. */
  totalPages: number | null
  /** Flattened, field-picked records for this page. May be empty. */
  records: ReadonlyArray<Record<string, unknown>>
  /**
   * The caller's `fields` list (post-augmentation). Strategies use this to
   * distinguish requested fields from incidentally-present ones. Absent
   * means "all fields".
   */
  fields?: ReadonlyArray<string>
  /** Per-strategy options forwarded from the tool layer. */
  options?: Readonly<Record<string, unknown>>
}

export interface SummaryOutput {
  /** Text embedded and stored as the memory row's `finding`. */
  finding: string
  /** Structured payload stored on the memory row's metadata column. */
  metadata: Record<string, unknown>
  /**
   * Optional category override. Defaults to `page_summary:<strategy.name>`
   * at the call site. Strategies should leave this undefined unless they
   * have a deliberate reason to break the default scheme.
   */
  category?: string
}

export interface SummaryStrategy {
  /**
   * Globally unique strategy identifier. Lowercase kebab-case
   * (`/^[a-z][a-z0-9-]*$/`). Used as the registry key, the LLM-facing
   * enum value, and the default category suffix.
   */
  readonly name: string
  /**
   * One-line LLM-facing hint, rendered into the tool parameter's
   * description so the model can choose the right strategy.
   */
  readonly description: string
  /**
   * Optional pre-check. Returning `false` skips the strategy silently
   * (no memory is stored, no error is raised). Omit to indicate the
   * strategy always applies.
   */
  appliesTo?(input: SummaryInput): boolean
  /** Pure function over records. Sync or async; no LLM, no network. */
  generate(input: SummaryInput): SummaryOutput | Promise<SummaryOutput>
}
