import {
  assertMigrationsCurrent,
  getPendingMigrations,
  migrations,
  PendingMigrationsError
} from '../../../src/db/migrations.js'

/** Build a fake pool whose `schema_migrations` query returns the given versions. */
function poolWithApplied(versions: string[]) {
  return {
    query: vi.fn(() => Promise.resolve({ rows: versions.map((version) => ({ version })) }))
  } as any
}

/** Build a fake pool whose query rejects with the given Postgres error code. */
function poolThatThrows(code: string) {
  return {
    query: vi.fn(() => Promise.reject(Object.assign(new Error('boom'), { code })))
  } as any
}

const ALL_VERSIONS = migrations.map((m) => m.version)
const CORE_VERSIONS = migrations.filter((m) => m.feature === 'core').map((m) => m.version)

describe('db/migrations — getPendingMigrations', () => {
  it('returns nothing when every migration is applied', async () => {
    const pending = await getPendingMigrations(poolWithApplied(ALL_VERSIONS))
    expect(pending).toEqual([])
  })

  it('returns the unapplied migrations in order', async () => {
    const pending = await getPendingMigrations(poolWithApplied(['001', '002']))
    expect(pending.map((m) => m.version)).toEqual(
      ALL_VERSIONS.filter((v) => v !== '001' && v !== '002')
    )
  })

  it('scopes to declared features — analysis migrations are not required when only core is provisioned', async () => {
    // Only core migrations applied; a core-only server must report no drift.
    const pending = await getPendingMigrations(poolWithApplied(CORE_VERSIONS), {
      features: ['core']
    })
    expect(pending).toEqual([])
  })

  it('flags analysis migrations once analysis is provisioned', async () => {
    const pending = await getPendingMigrations(poolWithApplied(CORE_VERSIONS), {
      features: ['core', 'analysis']
    })
    expect(pending.every((m) => m.feature === 'analysis')).toBe(true)
    expect(pending.length).toBeGreaterThan(0)
  })

  it('treats a missing schema_migrations table (42P01) as nothing applied', async () => {
    const pending = await getPendingMigrations(poolThatThrows('42P01'))
    expect(pending.map((m) => m.version)).toEqual(ALL_VERSIONS)
  })

  it('rethrows non-undefined-table query errors', async () => {
    await expect(getPendingMigrations(poolThatThrows('28000'))).rejects.toThrow('boom')
  })
})

describe('db/migrations — assertMigrationsCurrent', () => {
  it('resolves when current', async () => {
    await expect(assertMigrationsCurrent(poolWithApplied(ALL_VERSIONS))).resolves.toBeUndefined()
  })

  it('throws PendingMigrationsError naming the pending migrations and remediation', async () => {
    const err = await assertMigrationsCurrent(poolWithApplied([])).catch((e) => e)
    expect(err).toBeInstanceOf(PendingMigrationsError)
    expect(err.message).toContain('npm run db:migrate')
    expect(err.message).toContain('001_create_oauth_sessions')
    expect(err.pending).toHaveLength(migrations.length)
  })
})
