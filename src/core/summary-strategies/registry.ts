/**
 * SummaryStrategyRegistry — owns the set of strategies available to
 * `analysis_ingest` and `analysis_summarize`.
 *
 * One registry per `ToolRegistry` instance. Seeded with the built-ins at
 * construction; `ApiExtension`s contribute more via the
 * `registerSummaryStrategy` collector. Strategy names are globally unique
 * across built-ins and all extensions; collisions throw at boot with both
 * owner keys in the error message.
 */

import type { SummaryStrategy } from './types.js'

const NAME_RE = /^[a-z][a-z0-9-]*$/
const BUILT_IN_OWNER = '<built-in>'

export class SummaryStrategyRegistry {
  private readonly _byName = new Map<string, SummaryStrategy>()
  private readonly _owners = new Map<string, string>()

  constructor(initial: ReadonlyArray<SummaryStrategy> = []) {
    for (const strategy of initial) {
      this._registerInternal(BUILT_IN_OWNER, strategy)
    }
  }

  /**
   * Register a strategy contributed by a specific owner (an extension key,
   * or `<built-in>`). Throws on duplicate name or invalid format.
   */
  register(ownerKey: string, strategy: SummaryStrategy): void {
    this._registerInternal(ownerKey, strategy)
  }

  get(name: string): SummaryStrategy | undefined {
    return this._byName.get(name)
  }

  has(name: string): boolean {
    return this._byName.has(name)
  }

  names(): string[] {
    return [...this._byName.keys()]
  }

  all(): SummaryStrategy[] {
    return [...this._byName.values()]
  }

  /** @internal — for diagnostic logging. */
  ownerOf(name: string): string | undefined {
    return this._owners.get(name)
  }

  private _registerInternal(ownerKey: string, strategy: SummaryStrategy): void {
    if (!NAME_RE.test(strategy.name)) {
      throw new Error(
        `SummaryStrategy name "${strategy.name}" (from "${ownerKey}") must match ${NAME_RE} ` +
          `(lowercase kebab-case, starting with a letter).`
      )
    }
    const existingOwner = this._owners.get(strategy.name)
    if (existingOwner !== undefined) {
      throw new Error(
        `SummaryStrategy "${strategy.name}" attempted by "${ownerKey}" is already ` +
          `registered by "${existingOwner}". Strategy names must be globally unique.`
      )
    }
    this._byName.set(strategy.name, strategy)
    this._owners.set(strategy.name, ownerKey)
  }
}
