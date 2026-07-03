/**
 * Kind registry machinery.
 *
 * Holds the `KIND_REGISTRY` map and the resolution logic shared by every
 * built-in kind file and by `AppRegistry`'s deployer-extension path. Pure;
 * DOM-free. Built-in kinds register from `./index.ts`.
 */

import { enumMembershipError } from './helpers.js'

export interface KindOpts {
  format?: string
  enumValues?: string[]
  max?: number
}

/**
 * The definition shape kind opts are extracted from — both
 * `AttributeDefinition` and `PromptFieldDefinition` satisfy it structurally.
 * When a new kind needs another per-definition knob, extend this interface
 * and `KindOpts` together and thread the field through `kindOptsFrom`; call
 * sites never hand-build opts objects, so the extraction has one home.
 */
export interface KindOptsSource {
  format?: string
  enumValues?: string[]
  max?: number
}

/** Extract the `KindOpts` a definition carries for its kind's facets. */
export function kindOptsFrom(def: KindOptsSource): KindOpts {
  return { format: def.format, enumValues: def.enumValues, max: def.max }
}

export interface KindDescriptor {
  htmlInputType: string
  promptType: string
  label: string
  describe(value: unknown, opts?: KindOpts): string
  validate(value: unknown, opts?: KindOpts): string | null
  parse(api: unknown, opts?: KindOpts): unknown
  serialize(internal: unknown, opts?: KindOpts): unknown
  toInput(internal: unknown, opts?: KindOpts): string
  fromInput(raw: string, opts?: KindOpts): unknown
}

/**
 * Declarative DOM rendering hint forwarded from `AppRegistry({ kinds })` to
 * the iframe runtime. Display-only — server-side behavior (parse, validate,
 * describe …) stays on `KindDescriptor`. CSP-safe: the runtime translates
 * these through a closed allowlist of helpers, never by executing inline JS.
 */
export interface KindRenderHint {
  template?: string
  locale?: string
  dateStyle?: 'full' | 'long' | 'medium' | 'short'
  timeStyle?: 'full' | 'long' | 'medium' | 'short'
  badge?: { icon?: string; className?: string }
}

const passthrough: KindDescriptor = {
  htmlInputType: 'text',
  promptType: 'string',
  label: 'Text',
  describe: (v) => (v === null || v === undefined ? '' : String(v)),
  validate: () => null,
  parse: (v) => v,
  serialize: (v) => v,
  toInput: (v) => (v === null || v === undefined ? '' : String(v)),
  fromInput: (v) => (v === '' ? null : v)
}

export const KIND_REGISTRY = new Map<string, KindDescriptor>()

/**
 * Register a kind descriptor, optionally narrowed to a `format` discriminator
 * (e.g. `registerKind('string', isbn, { format: 'isbn' })`). Partial
 * descriptors are merged onto `passthrough` so callers only specify deltas.
 *
 * `enumValues` membership is a definition-level constraint the registry owns:
 * every registered kind's `validate` — built-in or deployer-supplied — first
 * checks the value against `opts.enumValues` when present, then runs the
 * kind's own rules. Kind files never implement membership themselves.
 */
export function registerKind(
  kind: string,
  descriptor: Partial<KindDescriptor>,
  { format }: { format?: string } = {}
): void {
  const k = format ? `${kind.toLowerCase()}:${format.toLowerCase()}` : kind.toLowerCase()
  const merged = { ...passthrough, ...descriptor }
  const kindValidate = merged.validate
  merged.validate = (v, opts) => {
    if (v !== null && v !== undefined && v !== '') {
      const membership = enumMembershipError(v, opts?.enumValues)
      if (membership) return membership
    }
    return kindValidate(v, opts)
  }
  KIND_REGISTRY.set(k, merged)
}

export class UnknownKindError extends Error {
  readonly kind: string | undefined
  readonly format: string | undefined
  constructor(kind: string | undefined, format: string | undefined) {
    const registered = Array.from(KIND_REGISTRY.keys())
      .filter((k) => !k.includes(':'))
      .join(', ')
    super(
      `Unknown kind: kind=${JSON.stringify(kind)} format=${JSON.stringify(
        format
      )}. Registered kinds: ${registered}.`
    )
    this.name = 'UnknownKindError'
    this.kind = kind
    this.format = format
  }
}

/**
 * Look up a kind descriptor by `kind` and optional `format` discriminator.
 * Both arguments are case-insensitive. Resolution order:
 *   1. `kind:format` narrowing (e.g. `string:isbn`)
 *   2. `format` as a top-level kind (e.g. `format: 'url'` on a string attr)
 *   3. `kind` itself
 *
 * Step 2 is what makes JSON-schema-style `format: 'email'` or `format: 'url'`
 * work without requiring deployers to register every narrowing explicitly.
 *
 * Throws `UnknownKindError` if nothing resolves. `validateRegistries` catches
 * every model-driven call site at boot; the throw guards code paths that
 * bypass it (custom apps, hand-built attribute configs in tests) so they fail
 * loudly instead of degrading to a silent text input.
 */
export function getKind(kind: string | undefined, format?: string): KindDescriptor {
  const k = kind?.toLowerCase()
  const f = format?.toLowerCase()
  if (k && f) {
    const narrowed = KIND_REGISTRY.get(`${k}:${f}`)
    if (narrowed) return narrowed
  }
  if (f) {
    const byFormat = KIND_REGISTRY.get(f)
    if (byFormat) return byFormat
  }
  if (k) {
    const base = KIND_REGISTRY.get(k)
    if (base) return base
  }
  throw new UnknownKindError(kind, format)
}

/**
 * Resolve the HTML input type for a definition. A definition carrying
 * `enumValues` renders as a `select` (`checkbox_group` when the kind is
 * `array`); everything else uses its descriptor's `htmlInputType`. This is
 * the one home for enum-driven input widening — form-schema builders call it
 * instead of encoding the rule themselves.
 */
export function resolveInputType(
  kind: string | undefined,
  format: string | undefined,
  opts?: KindOpts
): string {
  if (opts?.enumValues && opts.enumValues.length > 0) {
    return kind?.toLowerCase() === 'array' ? 'checkbox_group' : 'select'
  }
  return getKind(kind, format).htmlInputType
}
