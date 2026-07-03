/**
 * pgvector Schema-Mismatch Hints
 *
 * Turns opaque Postgres schema errors into self-explaining ones. When the
 * analysis migrations have not been applied, the ingested-records queries fail
 * with `column "embedding" does not exist` (42703) or `relation "..." does not
 * exist` (42P01) — meaningless to an LLM tool caller. `withSchemaHint` appends
 * remediation so the surfaced error names the fix.
 *
 * This is defense-in-depth: the startup guard (`assertMigrationsCurrent`) should
 * already abort boot before any tool runs against an out-of-date schema.
 */

/** undefined_column, undefined_table — almost always unapplied migrations. */
const SCHEMA_MISMATCH_CODES = new Set(['42703', '42P01'])

const REMEDIATION = 'the analysis schema is missing or out of date — run `npm run db:migrate`'

/**
 * Run a pgvector operation, rethrowing schema-mismatch errors with remediation.
 * Non-schema errors pass through untouched.
 */
export async function withSchemaHint<T>(op: () => Promise<T>): Promise<T> {
  try {
    return await op()
  } catch (err) {
    const code = (err as { code?: string }).code
    if (code && SCHEMA_MISMATCH_CODES.has(code)) {
      const original = err instanceof Error ? err.message : String(err)
      const wrapped = new Error(`${original} — ${REMEDIATION}`) as Error & { code?: string }
      wrapped.code = code
      if (err instanceof Error && err.stack) wrapped.stack = err.stack
      throw wrapped
    }
    throw err
  }
}
