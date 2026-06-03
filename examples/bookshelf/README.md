# Bookshelf Example

A minimal mcp-rune server with one model (Book) showing the full framework
surface: tools, prompts, validation, interactive apps, and documentation —
all generated from a single model definition. Backed by an **in-memory
DataLayer adapter**, so every tool works out of the box with zero external
infrastructure.

## Quick Start

```bash
cd examples/bookshelf
npm install
npx @modelcontextprotocol/inspector -- npx tsx server.ts
```

Or configure Claude Desktop (`claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "bookshelf": {
      "command": "npx",
      "args": ["tsx", "/path/to/mcp-rune/examples/bookshelf/server.ts"]
    }
  }
}
```

## What You Get

From a **30-line model definition**, the framework registers nine tools that
all work immediately — no API, no database, no auth setup:

| Tool                 | What it does                                         |
| -------------------- | ---------------------------------------------------- |
| `list_models`        | Discover available models and their schemas          |
| `get_prompt_guide`   | Step-by-step creation guide with field documentation |
| `validate_form`      | Validate collected fields before submitting          |
| `get_form_summary`   | Human-readable + technical summary of form state     |
| `find_records`       | Find by ID or list records                           |
| `create_model`       | Create a book record                                 |
| `update_model`       | Update book attributes                               |
| `delete_model`       | Delete a book                                        |
| `bulk_action_models` | Batch create/update/delete                           |

CRUD operations are served by `InMemoryDataLayer` — the same adapter the
framework's own tests use. Three seed books (`Clean Code`, `The Pragmatic
Programmer`, `Design Patterns`) are pre-loaded so `find_records` returns
something interesting on first run. State is per-process and resets when
you restart the server.

The strategy tools are the most interesting part — they showcase what
mcp-rune does that other frameworks don't: **guided form filling with
validation feedback, derived directly from the model schema**.

---

## Example Conversations

Below are real interactions showing what the LLM sees and does when connected
to this server.

### 1. Discovery — "What can I work with?"

The LLM's first step is usually to discover the available models.

**LLM calls:** `list_models({})`

**Server responds:**

```json
[
  {
    "name": "book",
    "endpoint": "books",
    "description": "A book in the library",
    "attributes": ["title", "author", "status", "rating", "notes"],
    "required_attributes": ["title", "author"],
    "read_only": false,
    "enum_fields": ["status"]
  }
]
```

The LLM now knows: there's one model called "book" with 5 fields, 2 required,
and a status enum.

---

### 2. Getting the Creation Guide

Before creating a record, the LLM fetches the prompt guide to understand the
form structure.

**LLM calls:** `get_prompt_guide({ guide_name: "book" })`

**Server responds** (markdown):

```markdown
# Book Creation Guide

Create a new book in your library.

## Workflow

● 1. Book Identity — title, author
↳ Core information that identifies the book (required)
○ 2. Reading Status — status, rating, notes
↳ Your reading progress and impressions

## Guidance

This is a hybrid model (5 fields in 2 groups).

Recommended approach:

1. Collect all required fields (title, author)
2. Ask about optional fields (status, rating, notes)
3. Validate with validate_form before creating
4. Present a summary with get_form_summary
5. Create with create_model

## Section 1: Book Identity (required)

### title (string) — required

Book title
Examples: "Clean Code", "Design Patterns", "The Pragmatic Programmer"

### author (string) — required

Author name
Examples: "Robert C. Martin", "Kent Beck"

## Section 2: Reading Status

### status (enum)

Current reading status
Valid values: unread, reading, completed
Default: unread

### rating (integer)

Your rating from 1 to 5
Validation: min=1, max=5

### notes (text)

Personal notes about the book

## Attribute Reference

| Attribute | Type    | Required | Valid Values               |
| --------- | ------- | -------- | -------------------------- |
| title     | string  | Yes      |                            |
| author    | string  | Yes      |                            |
| status    | enum    | No       | unread, reading, completed |
| rating    | integer | No       | 1-5                        |
| notes     | text    | No       |                            |

## Tool Usage

create_model({
model: "book",
attributes: {
title: "...", // required
author: "...", // required
status: "unread", // optional, default: unread
rating: 4, // optional, 1-5
notes: "..." // optional
}
})
```

The LLM reads this guide and follows the recommended workflow: collect fields
from the user, validate, summarize, then create.

---

### 3. Validation — "Is this ready to submit?"

After collecting fields from the user, the LLM validates before calling the
underlying tool.

**LLM calls:** `validate_form({ model: "book", fields: { title: "Clean Code" } })`

**Server responds:**

```json
{
  "valid": false,
  "ready_to_submit": false,
  "errors": [{ "field": "author", "message": "Author name is required" }],
  "warnings": ["Using default for status: unread"],
  "computed": { "status": "unread" },
  "fields": { "status": "unread", "title": "Clean Code" }
}
```

The LLM tells the user: _"I still need the author name before I can create
the book."_

After the user provides it:

**LLM calls:** `validate_form({ model: "book", fields: { title: "Clean Code", author: "Robert C. Martin", rating: 5 } })`

**Server responds:**

```json
{
  "valid": true,
  "ready_to_submit": true,
  "errors": [],
  "warnings": [],
  "fields": { "status": "unread", "title": "Clean Code", "author": "Robert C. Martin", "rating": 5 }
}
```

---

### 4. Summary — "Here's what I'm about to create"

Before calling the data tool, the LLM presents a summary for user
confirmation.

**LLM calls:** `get_form_summary({ model: "book", fields: { title: "Clean Code", author: "Robert C. Martin", rating: 5 } })`

The LLM presents the human-readable summary:

> _I'm about to create this book:_
>
> - **Title:** Clean Code
> - **Author:** Robert C. Martin
> - **Rating:** 5/5
> - **Status:** unread (default)
>
> _Shall I go ahead?_

---

### 5. Creation

**LLM calls:** `create_model({ model: "book", attributes: { title: "Clean Code", author: "Robert C. Martin", rating: 5 } })`

**Server responds:**

```json
{
  "status": "created",
  "model": "book",
  "id": 4
}
```

The record now lives in the in-memory store alongside the three seed books
(IDs 1–3). `find_records({ model: "book", id: "4" })` returns it back.

---

### 6. Full Conversation Flow

Here's how a natural conversation looks end-to-end:

```
User: I want to add some books to my library

LLM:  [calls list_models() — discovers "book" model]
      I can help you add books! Each book needs a title and author.
      You can also set a reading status (unread/reading/completed),
      a rating (1-5), and personal notes. What books would you like to add?

User: Clean Code by Robert Martin — I'd rate it 5 stars. And I'm
      currently reading The Pragmatic Programmer.

LLM:  [calls validate_form() for each book]
      [calls get_form_summary() for each book]

      I'll create two books:

      1. **Clean Code** by Robert C. Martin — rated 5/5, status: unread
      2. **The Pragmatic Programmer** — I need the author name. Who wrote it?

User: Andrew Hunt and David Thomas

LLM:  [calls validate_form() — now all valid]
      [calls get_form_summary()]

      Both are ready:

      1. **Clean Code** by Robert C. Martin — rating: 5/5
      2. **The Pragmatic Programmer** by Andrew Hunt and David Thomas
         — status: reading

      Shall I create them?

User: Yes

LLM:  [calls bulk_action_models({
         model: "book",
         action: "create",
         records: [
           { title: "Clean Code", author: "Robert C. Martin", rating: 5 },
           { title: "The Pragmatic Programmer",
             author: "Andrew Hunt and David Thomas", status: "reading" }
         ]
       })]

      Done! Created both books.
```

---

## How the LLM Decides Which Tools to Call

The MCP protocol exposes tool names, descriptions, and input schemas to the
LLM. The LLM picks tools based on:

1. **Tool descriptions** — each tool has a description like "Create a new
   record for a model" that the LLM matches against user intent
2. **Prompt guide** — the `get_prompt_guide` response explicitly tells the
   LLM the recommended workflow (validate → summarize → create)
3. **Validation feedback** — `validate_form` errors guide the LLM to collect
   missing fields before retrying

The framework's tool descriptions include model-specific context (server
name, model names, required fields) so the LLM can make informed decisions
without extra round-trips.

## Tool Response Format

All tools return the same MCP format:

```json
{
  "content": [{ "type": "text", "text": "Markdown or JSON content" }]
}
```

Error responses include `isError: true`:

```json
{
  "content": [{ "type": "text", "text": "Error: Unknown model 'magazine'. Available: book" }],
  "isError": true
}
```

---

## Project Structure

```
bookshelf/
├── models/
│   └── book.ts             Model definition (attributes, types, validation)
├── prompts/
│   └── book-prompt.ts      Prompt with hybrid strategy and field groups
├── config.ts               Server wiring (ToolRegistry + in-memory DataLayer)
├── server.ts               StdioServer entry point
└── tsconfig.json
```

## Swapping in a Real Backend

The example uses `createInMemoryDataLayer({ fixtures })` to back every CRUD
tool with an in-process Map. The seam between `DataLayer` and `ApiClient` is
opaque to tools, prompts, and apps — swapping to HTTP is a one-line factory
change.

To wire to a real API:

1. Remove the `dataLayer` argument from `new ToolRegistry({ ... })` in
   `config.ts`. The default factory wraps `ModelService` + `ApiClient`.
2. Replace the stub `createApiClient` with a real one that builds an
   authenticated HTTP client from the bearer token. See
   [`docs/guides/api-client-guide.md`](../../docs/guides/api-client-guide.md).
3. Make sure your backend serves the model under the configured endpoint
   (`books`) and matches the convention (JSON:API by default; HAL also
   supported). See
   [`docs/guides/api-convention-guide.md`](../../docs/guides/api-convention-guide.md).

For the full adapter-swap pattern (in-memory stub, third-party library
wrapper, custom implementation), see
[`docs/guides/data-layer-guide.md`](../../docs/guides/data-layer-guide.md)
("Swapping the Adapter").

## MCP Apps (interactive UI)

This example wires `createDefaultAppRegistry` in `config.ts` so the server
serves all six framework apps out of the box: list view, record detail,
create/update forms, multi-pick-model-app picker, search view, and autocomplete
picker. Each app's UI is a vanilla-JS bundle the host renders in an iframe.

Per-deployment theming and custom-kind formatters slot in through the same
helper — see the commented options in `config.ts`. The descriptor channel is
the single source of truth: each entry drives iframe DOM rendering, the form
HTML input type, the prompt-side type label, and `validate_form` errors.

```ts
const appRegistry = createDefaultAppRegistry({
  modelClasses: MODEL_CLASSES,
  namespace: 'bookshelf',
  themeOverrides: { cssVariables: { '--color-accent': '#0a84ff' } },
  formatters: {
    date: { display: { locale: 'en-GB' } },
    'string:isbn': {
      label: 'ISBN',
      htmlInputType: 'text',
      promptType: 'string',
      validation: { pattern: '^[0-9-]+$', minLength: 10, maxLength: 17 },
      display: { template: 'ISBN: {value}' }
    }
  }
})
```

## Dataset switch — `BOOKSHELF_DATASET`

Out of the box the server seeds 3 hand-picked starter books. Set
`BOOKSHELF_DATASET` to choose a bigger fixture for the analysis tools:

| Value     | Records                           | Shape                                                                                                                                                                                                                                                                   |
| --------- | --------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| _(unset)_ | 3 books                           | Hand-picked starter set for the CRUD tour                                                                                                                                                                                                                               |
| `large`   | 5,000                             | Procedurally generated books with signal for the field-level strategies                                                                                                                                                                                                 |
| `json`    | 5,000                             | Same dataset, loaded from `fixtures/books.5000.json`                                                                                                                                                                                                                    |
| `graph`   | 500 books + 10 authors + 6 genres | **Full graph mode** — books carry `author_id` / `genre_id`, the server wires a `DomainRegistry` with two concepts and two business rules. Used by the GraphRAG-aware analysis strategies and the [Analysis Quickstart](../../docs/guides/analysis-quickstart-guide.md). |

The `graph` mode is what makes the bookshelf a complete GraphRAG demo. The fixture intentionally bakes in:

- **~5% of books missing `author_id`** — `relationship-coverage` reports the gap on `belongsTo:author`, and the `books-need-author` business rule fires on the same records.
- **~15% of completed books missing `rating`** — the `completed-books-need-rating` business rule fires; `rule-violation` lists the failing IDs per page.
- **Two `DomainConcept`s**: `reading-pipeline` (book + genre) and `catalogue` (book + author + genre). `concept-touch` reports per-concept coverage; the gap is the missing-author records.
- **Stable text content per book** (varied adjective + noun + index) so `semantic-cluster` produces meaningful groupings.

To run it:

```bash
DATABASE_URL=postgres://bookshelf:bookshelf@localhost:5432/bookshelf \
ANALYSIS_ENABLED=true \
BOOKSHELF_DATASET=graph \
npx @modelcontextprotocol/inspector -- npx tsx server.ts
```

See the [Analysis Quickstart](../../docs/guides/analysis-quickstart-guide.md)
for the full end-to-end recipe walking every summary strategy plus the
composable graph stratifiers (`concept` / `edge` / `cluster`) on
`analysis_query mode:"sample"`.

## Next Steps

- Add more models (Author, Category) — same nine tools, polymorphic
- Enable search (`search_records`, `get_filters_guide`) by registering the
  `search` ApiExtension — see
  [`docs/guides/search-adapter-guide.md`](../../docs/guides/search-adapter-guide.md)
- Add OAuth for remote access (`HttpServer` + `OAuthService`)
- Customize the apps' theming or register custom attribute kinds via
  `themeOverrides` / `formatters` on `createDefaultAppRegistry`
- See the [guides](../../docs/guides/) for deep dives on each feature
