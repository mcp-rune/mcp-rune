/**
 * Shared kind taxonomy. Server-side (prompts, validation) AND browser-side
 * (formatters, form rendering) import this directly. Must remain DOM-free —
 * `format()` rendering lives in `src/mcp/apps/shared/formatters.ts`, which
 * decorates these descriptors with the DOM-returning `format` function.
 *
 * One source of truth for how attribute kinds (string, text, integer,
 * decimal, boolean, date, datetime, time, enum, array, uuid, json, color,
 * email, url, base64, rating) move between three representations and how
 * they are described and validated:
 *
 *   API value  ⇄  internal value  ⇄  HTML <input> value
 *      (parse / serialize)         (fromInput / toInput)
 *      describe(internal) -> string   (LLM-facing summary)
 *      validate(internal) -> string | null   (kind-aware errors)
 *
 * Deployers extend the registry with custom kinds via the declarative
 * `FormatterDescriptor` channel on `AppRegistry`, which both the server
 * and the iframe consume through this module.
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

function humanize(str: string): string {
  return str.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
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
  const key = format ? `${kind.toLowerCase()}:${format.toLowerCase()}` : kind.toLowerCase()
  KIND_REGISTRY.set(key, { ...passthrough, ...descriptor })
}

/**
 * Look up a kind descriptor by `kind` and optional `format` discriminator.
 * Both arguments are case-insensitive. Resolution order:
 *   1. `kind:format` narrowing (e.g. `string:isbn`)
 *   2. `format` as a top-level kind (e.g. `format: 'url'` on a string attr)
 *   3. `kind` itself
 *   4. `string` passthrough
 *
 * Step 2 is what makes JSON-schema-style `format: 'email'` or `format: 'url'`
 * work without requiring deployers to register every narrowing explicitly.
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
  return KIND_REGISTRY.get('string')!
}

const pad2 = (n: number): string => String(n).padStart(2, '0')

function parseDate(v: unknown): Date | null {
  if (v == null || v === '') return null
  if (v instanceof Date) return isNaN(v.getTime()) ? null : v
  const d = new Date(v as string | number)
  return isNaN(d.getTime()) ? null : d
}

function dateToISO(v: Date): string {
  return `${v.getUTCFullYear()}-${pad2(v.getUTCMonth() + 1)}-${pad2(v.getUTCDate())}`
}

function dateToInputDateTime(v: Date): string {
  return `${dateToISO(v)}T${pad2(v.getUTCHours())}:${pad2(v.getUTCMinutes())}`
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/

registerKind('string', { label: 'Text' })

registerKind('text', { label: 'Long text', htmlInputType: 'textarea', promptType: 'text' })

registerKind('integer', {
  label: 'Integer',
  htmlInputType: 'number',
  promptType: 'integer',
  parse: (v) => (v === null || v === undefined || v === '' ? null : Number(v)),
  serialize: (v) => v,
  describe: (v) => (v === null || v === undefined ? '' : String(v)),
  toInput: (v) => (v === null || v === undefined ? '' : String(v)),
  fromInput: (v) => (v === '' ? null : Number(v)),
  validate: (v) => {
    if (v === null || v === undefined || v === '') return null
    if (typeof v === 'number' && Number.isInteger(v)) return null
    return 'must be an integer'
  }
})

registerKind('decimal', {
  label: 'Decimal',
  htmlInputType: 'number',
  promptType: 'number',
  parse: (v) => (v === null || v === undefined || v === '' ? null : Number(v)),
  describe: (v) => (v === null || v === undefined ? '' : String(v)),
  toInput: (v) => (v === null || v === undefined ? '' : String(v)),
  fromInput: (v) => (v === '' ? null : Number(v)),
  validate: (v) => {
    if (v === null || v === undefined || v === '') return null
    if (typeof v === 'number' && Number.isFinite(v)) return null
    return 'must be a number'
  }
})

registerKind('boolean', {
  label: 'Yes/No',
  htmlInputType: 'checkbox',
  promptType: 'boolean',
  parse: (v) => v === true || v === 'true' || v === 1 || v === '1',
  serialize: (v) => Boolean(v),
  describe: (v) => (v ? 'Yes' : 'No'),
  toInput: (v) => (v ? 'true' : 'false'),
  fromInput: (v) => v === 'true' || v === 'on',
  validate: (v) => {
    if (v === null || v === undefined || v === '') return null
    if (typeof v === 'boolean') return null
    return 'must be a boolean'
  }
})

registerKind('date', {
  label: 'Date',
  htmlInputType: 'date',
  promptType: 'date',
  parse: parseDate,
  describe: (v) => {
    const d = parseDate(v)
    return d ? dateToISO(d) : ''
  },
  toInput: (v) => {
    const d = v instanceof Date ? v : parseDate(v)
    return d ? dateToISO(d) : ''
  },
  fromInput: (v) => (v ? new Date(`${v}T00:00:00Z`) : null),
  serialize: (v) => {
    const d = v instanceof Date ? v : parseDate(v)
    return d ? dateToISO(d) : null
  },
  validate: (v) => {
    if (v === null || v === undefined || v === '') return null
    return parseDate(v) ? null : 'must be a valid date'
  }
})

registerKind('datetime', {
  label: 'Date & time',
  htmlInputType: 'datetime-local',
  promptType: 'datetime',
  parse: parseDate,
  describe: (v) => {
    const d = parseDate(v)
    return d ? d.toISOString() : ''
  },
  toInput: (v) => {
    const d = v instanceof Date ? v : parseDate(v)
    return d ? dateToInputDateTime(d) : ''
  },
  fromInput: (v) => (v ? new Date(`${v}:00Z`) : null),
  serialize: (v) => {
    const d = v instanceof Date ? v : parseDate(v)
    return d ? d.toISOString() : null
  },
  validate: (v) => {
    if (v === null || v === undefined || v === '') return null
    return parseDate(v) ? null : 'must be a valid datetime'
  }
})

registerKind('time', {
  label: 'Time',
  htmlInputType: 'time',
  promptType: 'time',
  parse: (v) => (v ? String(v) : null),
  describe: (v) => (typeof v === 'string' ? v.substring(0, 5) : ''),
  toInput: (v) => (typeof v === 'string' ? v.substring(0, 5) : ''),
  fromInput: (v) => v || null,
  validate: (v) => {
    if (v === null || v === undefined || v === '') return null
    if (typeof v === 'string' && TIME_RE.test(v)) return null
    return 'must be a valid time (HH:mm or HH:mm:ss)'
  }
})

registerKind('enum', {
  label: 'Choice',
  promptType: 'enum',
  describe: (v) => (v === null || v === undefined ? '' : humanize(String(v)))
})

registerKind('array', {
  label: 'List',
  promptType: 'array',
  parse: (v) => (Array.isArray(v) ? v : v == null ? [] : [v]),
  serialize: (v) => (Array.isArray(v) ? v : []),
  describe: (v) => (Array.isArray(v) ? v.map((x) => humanize(String(x))).join(', ') : ''),
  toInput: (v) => (Array.isArray(v) ? v.join(',') : ''),
  fromInput: (v) =>
    v
      ? String(v)
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean)
      : [],
  validate: (v) => {
    if (v === null || v === undefined || v === '') return null
    return Array.isArray(v) ? null : 'must be an array'
  }
})

registerKind('uuid', {
  label: 'UUID',
  promptType: 'uuid',
  describe: (v) => (v === null || v === undefined ? '' : String(v)),
  validate: (v) => {
    if (v === null || v === undefined || v === '') return null
    if (typeof v === 'string' && UUID_RE.test(v)) return null
    return 'must be a valid UUID'
  }
})

registerKind('json', {
  label: 'JSON',
  htmlInputType: 'textarea',
  promptType: 'object',
  describe: (v) => {
    if (v === null || v === undefined) return ''
    return typeof v === 'string' ? v : JSON.stringify(v)
  },
  toInput: (v) => (typeof v === 'string' ? v : JSON.stringify(v, null, 2)),
  fromInput: (v) => {
    if (!v) return null
    try {
      return JSON.parse(v)
    } catch {
      return v
    }
  },
  validate: (v) => {
    if (v === null || v === undefined || v === '') return null
    if (typeof v !== 'string') return null
    try {
      JSON.parse(v)
      return null
    } catch {
      return 'must be valid JSON'
    }
  }
})

registerKind('color', {
  label: 'Color',
  htmlInputType: 'color',
  promptType: 'string',
  describe: (v) => (v === null || v === undefined ? '' : String(v))
})

registerKind('email', {
  label: 'Email address',
  htmlInputType: 'email',
  promptType: 'string',
  describe: (v) => (v === null || v === undefined ? '' : String(v)),
  validate: (v) => {
    if (v === null || v === undefined || v === '') return null
    if (typeof v === 'string' && EMAIL_RE.test(v)) return null
    return 'must be a valid email address'
  }
})

registerKind('url', {
  label: 'URL',
  htmlInputType: 'url',
  promptType: 'string',
  describe: (v) => (v === null || v === undefined ? '' : String(v)),
  validate: (v) => {
    if (v === null || v === undefined || v === '') return null
    if (typeof v !== 'string') return 'must be a URL string'
    try {
      new URL(v)
      return null
    } catch {
      return 'must be a valid URL'
    }
  }
})

registerKind('base64', {
  label: 'Binary (base64)',
  promptType: 'string',
  describe: () => '(binary)'
})

registerKind('rating', {
  label: 'Rating',
  htmlInputType: 'number',
  promptType: 'integer',
  parse: (v) => Number(v) || 0,
  describe: (v, opts) => {
    const max = opts?.max ?? 5
    const n = Math.max(0, Math.min(max, Number(v) || 0))
    return `${n}/${max}`
  },
  toInput: (v) => String(v ?? ''),
  fromInput: (v) => (v === '' ? null : Number(v)),
  validate: (v, opts) => {
    if (v === null || v === undefined || v === '') return null
    if (typeof v !== 'number' || !Number.isFinite(v)) return 'must be a number'
    const max = opts?.max ?? 5
    if (v < 0 || v > max) return `must be between 0 and ${max}`
    return null
  }
})
