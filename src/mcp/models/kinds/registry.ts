/**
 * Kind registry machinery.
 *
 * Holds the `KIND_REGISTRY` map and the resolution logic shared by every
 * built-in kind file and by `AppRegistry`'s deployer-extension path. Pure;
 * DOM-free. Built-in kinds register from `./index.ts`.
 */

export interface KindOpts {
  format?: string
  enumValues?: string[]
  max?: number
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
 */
export function registerKind(
  kind: string,
  descriptor: Partial<KindDescriptor>,
  { format }: { format?: string } = {}
): void {
  const k = format ? `${kind.toLowerCase()}:${format.toLowerCase()}` : kind.toLowerCase()
  KIND_REGISTRY.set(k, { ...passthrough, ...descriptor })
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
