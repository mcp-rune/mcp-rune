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
 * readers — they call `getKind(name, format)` and consume whatever this
 * directory says. The browser DOM renderer in
 * `src/mcp/apps/shared/kind-renderers.ts` decorates a kind with a
 * `(value, opts) => Node` `format` function; that decoration is layered
 * on top of the descriptor, never a parallel definition. Keep this
 * directory DOM-free.
 *
 * To add a built-in kind: drop a new file here exporting
 * `Partial<KindDescriptor>` and register it below. Missing fields fall
 * back to `passthrough` in `registry.ts`.
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

registerKind('string', string)
registerKind('text', text)
registerKind('integer', integer)
registerKind('decimal', decimal)
registerKind('boolean', boolean)
registerKind('date', date)
registerKind('datetime', datetime)
registerKind('time', time)
registerKind('enum', enumKind)
registerKind('array', array)
registerKind('uuid', uuid)
registerKind('json', json)
registerKind('color', color)
registerKind('email', email)
registerKind('url', url)
registerKind('base64', base64)
registerKind('rating', rating)

export type { KindDescriptor, KindOpts, KindRenderHint } from './registry.js'
export { getKind, registerKind } from './registry.js'
