# Defining a model

A Model in mcp-rune is a `BaseModel` subclass that declares — in static fields — everything the framework needs to know about one entity in your domain. No runtime configuration files, no decorators, no schema-builder DSL: just a TypeScript class with a few static properties.

The smallest realistic model in the examples repo is `Tag` from the `tasks` server. It's a fine starting point because every part of its declaration is mandatory or near-mandatory.

File: `tasks/models/tag.ts`

```ts
import { BaseModel } from '@mcp-rune/mcp-rune/models'
import type { AttributeDefinition } from '@mcp-rune/mcp-rune/models'

export class Tag extends BaseModel {
  static override description = 'A label that can be applied to many tasks'
  static override api = { endpoint: 'tags' }

  static override attributes: Record<string, AttributeDefinition> = {
    name: {
      type: 'string',
      required: true,
      description: 'Short, lowercase label',
      examples: ['urgent', 'frontend', 'blocked', 'review']
    },
    color: {
      type: 'enum',
      enumValues: ['red', 'orange', 'yellow', 'green', 'blue', 'purple', 'gray'],
      default: 'gray',
      description: 'Display color in clients that render tags'
    }
  }

  static get attributesConfig(): Record<string, AttributeDefinition> {
    return this.attributes
  }

  override get displayValue(): string {
    return String(this.data.name)
  }
}
```

That's the entire declaration. Register it once in your server's `config.ts` and the framework derives a working `Tag` resource: `find_records({ model: "tag" })`, `create_model({ model: "tag", attributes: { ... } })`, the form prompt, validation feedback, a list app, a picker app — none of which you wrote.

## The four fields the framework reads

A `BaseModel` subclass communicates with the framework through four static fields. Two are required, two are optional but almost always present.

### `description` (required in practice)

A one-line human description. The framework surfaces it in `list_models`, in the prompt's section intro, in app headers, and in the auto-generated docs. Write it as if a human reading the tool list would see it — because that's exactly what an LLM sees.

### `api` (required)

Tells the `DataLayer` which endpoint backs this model and, optionally, which wire convention to use.

```ts
static override api = { endpoint: 'tags' }
// or
static override api = { endpoint: 'tasks', convention: jsonApiConvention }
```

The `endpoint` is a logical name — the actual URL is composed by the `DataLayer` adapter (`http://api.example.com/tasks`, or the in-memory stub's internal map, or whatever you've wired). The optional `convention` selects the wire shape (flat REST, JSON:API, your own); when omitted, the server's `defaultConvention` (set on the `DataLayer`, see chapter 6) is used. Per-model conventions override the default for that model only.

### `attributes` (required)

The map from attribute name to `AttributeDefinition`. This is where the model earns its title as the single source of truth — the next chapter ([Attributes and kinds](./attributes-and-kinds.md)) covers it in detail.

A `static get attributesConfig()` getter mirrors `attributes` and exists for the prompt-derivation framework; treat it as boilerplate you copy alongside `attributes` until it goes away in a future release.

### `displayValue` (recommended)

An instance getter that returns the human-readable label for one record. It's what `pick_model_app` and `multi_pick_model_app` render in the picker, what `view_selection_app` echoes back, and what the framework falls back to when summarizing a record in any context.

```ts
override get displayValue(): string {
  return `${this.data.title} by ${this.data.author}`
}
```

Omit it and the framework uses `id` — which works but tells the human nothing.

## Try it — add a second model

> Verified against rune CLI 0.11.0 · @mcp-rune/mcp-rune 0.104.1 · Node 24.

The `Tag` declaration above is the example. Now add it to your own scaffold and watch the framework wire it up for free.

**1. Add the model**

From the `bookshelf-tour` project you scaffolded in the [Quickstart](../01-getting-started/quickstart.md):

```bash
rune add model Tag --attrs name:string,color:string
```

Expected output:

```
✓ added model Tag
  + src/models/tag.ts
  + src/prompts/tag-prompt.ts
  ~ src/models/index.ts
  ~ src/prompts/index.ts

Edit src/models/tag.ts to declare attributes.
```

Four files: two new (`tag.ts` and `tag-prompt.ts`), two patched (`src/models/index.ts` and `src/prompts/index.ts` now also export `Tag` and register `TagPrompt`). You didn't touch the registry — the CLI did.

**2. Inspect what was generated**

```bash
cat src/models/tag.ts
```

Expected output:

```ts
import type { AttributeDefinition } from '@mcp-rune/mcp-rune/models'
import { BaseModel } from '@mcp-rune/mcp-rune/models'

export class Tag extends BaseModel {
  static override description = 'A Tag record'
  static override api = { endpoint: 'tags' }

  static override attributes: Record<string, AttributeDefinition> = {
    name: {
      type: 'string',
      description: 'name'
    },
    color: {
      type: 'string',
      description: 'color'
    }
  }

  static get attributesConfig(): Record<string, AttributeDefinition> {
    return this.attributes
  }
}
```

Match it against the four fields above: `description` and `api` are filled with safe defaults the scaffold picked from the model name; `attributes` was filled from the `--attrs` flag; `attributesConfig` is the mirror getter the prompt-derivation framework still reads. `displayValue` is not generated — the framework will fall back to `id` until you add one.

**3. Watch the framework adopt it**

Re-run the Inspector (or call via stdio JSON-RPC) and invoke `list_models` with `{}`. Expect the tag row right next to book:

```json
{
  "name": "tag",
  "endpoint": "tags",
  "description": "A Tag record",
  "attributes": ["name", "color"],
  "required_attributes": [],
  "read_only": false
}
```

Then call `get_prompt_guide` with `{ "guide_name": "tag" }` and notice that every word of the guide is derived from the file you just read — no template, no manual wiring.

**Observe:** registering one class — by way of the CLI patching one line into `src/models/index.ts` — added a fully-functional resource. Every polymorphic tool that worked against `book` works against `tag` too. Now the rest of this guide tells you what each piece of that file is doing.

## A richer example

When a model has associations, the declaration grows by one field. `Task` from the `tasks` server adds a `belongsTo` to `Project` and a `hasMany` to `Tag`:

File: `tasks/models/task.ts`

```ts
export class Task extends BaseModel {
  static override description = 'A single unit of work, scoped to a project, optionally tagged'
  static override api = { endpoint: 'tasks', convention: jsonApiConvention }

  static override associations: AssociationConfig = {
    belongsTo: {
      project: { target_model: 'project', required: true }
    },
    hasMany: {
      tags: { target_model: 'tag', many: true }
    }
  }

  static override attributes: Record<string, AttributeDefinition> = {
    title: {
      type: 'string',
      required: true,
      description: 'One-line summary of the task'
    },
    status: {
      type: 'enum',
      enumValues: ['todo', 'doing', 'done'],
      default: 'todo'
    }
    // …
  }
}
```

The `associations` declaration is enough for the framework to derive `project_id` and `tag_ids` as additional attributes on the form, wire pickers for them, validate that `project_id` references a real `Project`, and emit the foreign-key column in the auto-generated docs. Associations get their own chapter ([Associations](./associations.md)) where the full mechanics are explained.

## What you didn't have to write

The 30-line `Tag` declaration above gives the framework everything it needs to generate, without one more line of your code:

- **Six polymorphic CRUD tools** that include `Tag` automatically: `list_models`, `find_records`, `create_model`, `update_model`, `delete_model`, `bulk_action_models`.
- **Three form-strategy tools** wired to `Tag` validation: `get_prompt_guide`, `validate_form`, `get_form_summary`.
- **Two optional search tools** (`search_records`, `get_filters_guide`) when the `search` ApiExtension is registered.
- **Seven default MCP apps** keyed to `Tag`: `find_model_app`, `show_model_app`, `new_model_app`, `edit_model_app`, `pick_model_app`, `multi_pick_model_app`, `view_selection_app`.
- A **prompt guide** rendered by `get_prompt_guide({ guide_name: 'tag' })` with the required/optional fields, enum values, and examples baked in.
- **Validation** that rejects an unknown `color` value or a missing `name` before any backend call.
- **Auto-generated docs** describing the `Tag` resource in the same shape an OpenAPI viewer would render.

Every one of those surfaces is a _projection_ of the same `static attributes` block. Change `name`'s `required` from `true` to `false` and all of them update on next boot.

## What's next

You've seen the shape of a Model. The next chapter, [Attributes and kinds](./attributes-and-kinds.md), goes one level deeper: what `type: 'enum'` actually means inside the framework, how a value moves through API ⇄ internal ⇄ HTML representations, and how to extend the kind taxonomy with your own types (ISBN, currency, hex color, …).
