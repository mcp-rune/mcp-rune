/**
 * Kinds — the `type` values you write in a model's `static attributes`.
 *
 *   class Activity extends BaseModel {
 *     static attributes = {
 *       title:     { type: 'string',  required: true },
 *       startedAt: { type: 'datetime' },
 *       rating:    { type: 'integer', format: 'rating', max: 5 }
 *     }
 *   }
 *
 * Each `type:` literal above is a kind. This directory is the single
 * source of truth for what every supported kind means end-to-end:
 *
 *   API value  ⇄  internal value  ⇄  HTML <input> value
 *      parse / serialize            toInput / fromInput
 *      describe(internal)   -> string         (LLM-facing summary)
 *      validate(internal)   -> string | null  (kind-aware errors)
 *      label / htmlInputType / promptType    (form + prompt metadata)
 *
 * One place, one responsibility. `prompts/` and `apps/` are downstream
 * readers — kinds are shared vocabulary (ADR 0009): they call
 * `getKind(name, format)`, build opts with `kindOptsFrom(definition)`, and
 * resolve input widening with `resolveInputType`, consuming whatever this
 * directory says. The browser DOM renderer in
 * `src/mcp/apps/shared/kind-renderers.ts` decorates a kind with a
 * `(value, opts) => Node` `format` function; that decoration is layered
 * on top of the descriptor, never a parallel definition. Keep this
 * directory DOM-free.
 *
 * To add a built-in kind: drop a new file here exporting
 * `Partial<KindDescriptor>` and add it to `BUILT_IN_KINDS` below. Missing
 * fields fall back to `passthrough` in `registry.ts`.
 *
 * To add a deployer-defined kind: pass it via the `kinds:` option to
 * `new AppRegistry(apps, { kinds: { isbn: { …, render: { … } } } })`.
 * AppRegistry calls `registerKind` for behavior and forwards `render`
 * to the browser renderer registry. There is no other extension path.
 */

import { array } from './array.js'
import { base64 } from './base64.js'
import { boolean } from './boolean.js'
import { color } from './color.js'
import { date } from './date.js'
import { datetime } from './datetime.js'
import { decimal } from './decimal.js'
import { email } from './email.js'
import { enumKind } from './enum.js'
import { integer } from './integer.js'
import { json } from './json.js'
import { rating } from './rating.js'
import { registerKind } from './registry.js'
import { string } from './string.js'
import { text } from './text.js'
import { time } from './time.js'
import { url } from './url.js'
import { uuid } from './uuid.js'

const BUILT_IN_KINDS = {
  string,
  text,
  integer,
  decimal,
  boolean,
  date,
  datetime,
  time,
  enum: enumKind,
  array,
  uuid,
  json,
  color,
  email,
  url,
  base64,
  rating
} as const

for (const [name, descriptor] of Object.entries(BUILT_IN_KINDS)) {
  registerKind(name, descriptor)
}

/**
 * Names of the built-in kinds. The live registry (built-ins plus
 * `registerKind` extensions) is the runtime source of truth —
 * `validateRegistries` enforces membership against it at boot. This type
 * exists so TypeScript deployers get completion on `AttributeDefinition.type`
 * without the union closing the extensible set.
 */
export type KnownKind = keyof typeof BUILT_IN_KINDS

export type { KindDescriptor, KindOpts, KindOptsSource, KindRenderHint } from './registry.js'
export {
  getKind,
  kindOptsFrom,
  registerKind,
  resolveInputType,
  UnknownKindError
} from './registry.js'
