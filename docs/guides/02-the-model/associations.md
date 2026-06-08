# Associations

The previous chapter covered single-attribute kinds. This chapter covers the second kind of declaration in a model: how it points at other models. An association is a static field that tells the framework "every record of this type has an FK to a record of that type" — and from that one declaration the framework derives foreign-key columns, pickers, validators, prompt fields, and join logic.

## The two shapes

mcp-rune supports two association shapes, declared in a single `static associations` block.

File: `tasks/models/task.ts`

```ts
import { BaseModel } from '@mcp-rune/mcp-rune/models'
import type { AssociationConfig } from '@mcp-rune/mcp-rune/models'

export class Task extends BaseModel {
  static override associations: AssociationConfig = {
    belongsTo: {
      project: { target_model: 'project', required: true }
    },
    hasMany: {
      tags: { target_model: 'tag', many: true }
    }
  }

  // …attributes…
}
```

- **`belongsTo`** — a single foreign key from this model to another. The framework infers an attribute named `{key}_id` (here, `project_id`) and treats it as required-or-optional according to the association's `required:` flag.
- **`hasMany`** — a collection foreign-key from this model to many records of another. The inferred attribute is `{key}_ids` (here, `tag_ids`), typed as an array. The `many: true` flag is currently redundant with the block label but kept for forward compatibility.

A single model can declare any mix: a `Task` belongs to a `Project` and has many `Tag`s; a `Book` belongs to an `Author` and a `Genre`.

File: `bookshelf/models/book.ts`

```ts
export class Book extends BaseModel {
  static override associations: AssociationConfig = {
    belongsTo: {
      author: { target_model: 'author' },
      genre: { target_model: 'genre' }
    }
  }
  // …
}
```

## What's derived from one association

A single `belongsTo` declaration causes the framework to:

1. **Synthesize the FK attribute** — `project_id` shows up in `find_records({ model: 'task', filters: { project_id: 7 } })` and in the form payload. You don't list it under `attributes:`.
2. **Wire the picker app** — `pick_model_app({ model: 'project' })` becomes the recommended UI for filling `project_id` in `new_task_app` / `edit_task_app`.
3. **Validate the reference** — `validate_form` will fail with a clear error if the supplied `project_id` does not resolve to a real `Project` (subject to the `DataLayer`'s ability to do the lookup; the in-memory stub does it; some HTTP backends defer it to write time).
4. **Drive prompt content** — `get_prompt_guide({ guide_name: 'task' })` lists `project_id` under the _Routing_ section with the right type label and the LLM-facing prompt for using the picker.
5. **Generate the join in docs** — auto-generated docs describe Task ↔ Project with the right cardinality.

`hasMany` is symmetric: `tag_ids` is an array attribute, `multi_pick_model_app({ model: 'tag' })` is the recommended UI, and `validate_form` requires every supplied ID to resolve.

## When to declare it on each side

Both directions of an association are useful, but they serve different purposes.

- Declare `belongsTo` on the **child** (the side that owns the FK). The framework will derive the FK attribute, pickers, and validators from this declaration alone.
- Declare `hasMany` on the **parent** when you want the framework to surface the inverse (e.g., to power "show me this project's tasks" in app navigation, or to drive `find_records` filters from the parent side). You can omit `hasMany` if no consumer of the parent needs the inverse; nothing else in the framework requires symmetry.

The `tasks` server declares both: `Task.belongsTo.project` is the canonical side, and `Project.hasMany.tasks` (in the full example) exists so the project app can list its tasks.

## What associations do NOT do

- They do not load related records eagerly. `find_records({ model: 'task' })` returns task rows with `project_id` populated, not the project object. To pull in related data, use the data layer's `include:` option (see chapter 6) or model-derived attributes (see [Validation and defaults](./validation-and-defaults.md) and the `derived:` block explained in chapter 6).
- They do not enforce referential integrity at write time. The framework validates the FK at form-validate time (via the `DataLayer`'s `find` call) but does not stop a backend from writing an orphan FK — that's a backend concern, not a framework concern.
- They do not modify the table layout in the backend. Conventions and the `DataLayer` adapter decide how `project_id` is serialized to your API (flat REST: `project_id`; JSON:API: `relationships.project.data.id`). Chapter 6 covers conventions.

## A richer association graph

The `bookshelf-graph` example wires `Book ↔ Author ↔ Genre` and uses the resulting graph as the substrate for GraphRAG edge extraction in Part III. The model declarations themselves stay simple — the analysis layer does the rest.

File: `bookshelf-graph/models/book.ts`

```ts
export class Book extends BaseModel {
  static override associations: AssociationConfig = {
    belongsTo: {
      author: { target_model: 'author' },
      genre: { target_model: 'genre' }
    }
  }
  static override attributes: Record<string, AttributeDefinition> = {
    title: { type: 'string', required: true },
    status: { type: 'enum', enumValues: ['unread', 'reading', 'completed'], default: 'unread' },
    rating: { type: 'integer', validation: { min: 1, max: 5 } }
    // …
  }
}
```

The `AnalysisLayer`'s `extractEdges` method consumes this declaration to produce graph edges of the form `(book → author)` and `(book → genre)` — without your needing to write any graph code. See [Retrieval & GraphRAG](../09-retrieval-and-graphrag/retrieval-graphrag.md) for what's downstream of that.

## What's next

The `attributes` block plus the `associations` block together declare _which fields exist_. The next chapter, [Validation and defaults](./validation-and-defaults.md), covers _what makes a field valid_: the `required:`, `default:`, and `validation: { min, max }` knobs, and where in the request lifecycle each one fires.
