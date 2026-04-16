# Bookshelf Example

A minimal mcp-kit server with one model (Book) showing the full framework surface: tools, prompts, validation, and documentation — all generated from a single model definition.

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
      "args": ["tsx", "/path/to/mcp-kit/examples/bookshelf/server.ts"]
    }
  }
}
```

## What You Get

From a **30-line model definition**, the framework registers these tools automatically:

### Tools that work immediately (no API needed)

| Tool                | What it does                                         |
| ------------------- | ---------------------------------------------------- |
| `list_models`       | Discover available models and their schemas          |
| `get_prompt_guide`  | Step-by-step creation guide with field documentation |
| `validate_form`     | Validate collected fields before submitting          |
| `get_form_summary`  | Human-readable + technical summary of form state     |
| `get_filters_guide` | Filter documentation for search                      |

### Tools that need an API backend

| Tool                        | What it does                 |
| --------------------------- | ---------------------------- |
| `create_model`              | Create a book record         |
| `find_model`                | Find a book by ID or search  |
| `update_model`              | Update book attributes       |
| `delete_model`              | Delete a book                |
| `search_records`            | Search with filters          |
| `get_nested_resources`      | Fetch child resources        |
| `bulk_action_models`        | Batch create/update/delete   |
| `bulk_get_nested_resources` | Batch fetch nested resources |

The strategy tools are the most interesting part — they showcase what mcp-kit does that other frameworks don't: **guided form filling with validation feedback, no API calls needed**.

---

## Example Conversations

Below are real interactions showing what the LLM sees and does when connected to this server.

### 1. Discovery — "What can I work with?"

The LLM's first step is usually to discover the available models.

**LLM calls:** `list_models({})`

**Server responds:**

```json
[
  {
    "name": "book",
    "endpoint": "/books",
    "description": "A book in the library",
    "attributes": ["title", "author", "status", "rating", "notes"],
    "required_attributes": ["title", "author"],
    "read_only": false,
    "enum_fields": {
      "status": ["unread", "reading", "completed"]
    }
  }
]
```

The LLM now knows: there's one model called "book" with 5 fields, 2 required, and a status enum.

---

### 2. Getting the Creation Guide

Before creating a record, the LLM fetches the prompt guide to understand the form structure.

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

The LLM reads this guide and follows the recommended workflow: collect fields from the user, validate, summarize, then create.

---

### 3. Validation — "Is this ready to submit?"

After collecting fields from the user, the LLM validates before calling the API.

**LLM calls:** `validate_form({ model: "book", fields: { title: "Clean Code" } })`

**Server responds:**

```json
{
  "valid": false,
  "errors": ["Field 'author' is required but missing"],
  "warnings": [],
  "ready_to_submit": false
}
```

The LLM tells the user: _"I still need the author name before I can create the book."_

After the user provides it:

**LLM calls:** `validate_form({ model: "book", fields: { title: "Clean Code", author: "Robert C. Martin", rating: 5 } })`

**Server responds:**

```json
{
  "valid": true,
  "errors": [],
  "warnings": [],
  "ready_to_submit": true
}
```

---

### 4. Summary — "Here's what I'm about to create"

Before calling the API, the LLM presents a summary for user confirmation.

**LLM calls:** `get_form_summary({ model: "book", fields: { title: "Clean Code", author: "Robert C. Martin", rating: 5 } })`

**Server responds:**

```json
{
  "human": "Creating a book: 'Clean Code' by Robert C. Martin, rated 5/5, status: unread (default)",
  "technical": {
    "model": "book",
    "attributes": {
      "title": "Clean Code",
      "author": "Robert C. Martin",
      "rating": 5
    }
  }
}
```

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

### 5. Creation (requires API backend)

If an API backend is connected:

**LLM calls:** `create_model({ model: "book", attributes: { title: "Clean Code", author: "Robert C. Martin", rating: 5 } })`

**Server responds:**

```json
{
  "status": "created",
  "model": "book",
  "id": "42",
  "data": {
    "id": 42,
    "title": "Clean Code",
    "author": "Robert C. Martin",
    "status": "unread",
    "rating": 5
  }
}
```

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

      Done! Created both books:
      - Clean Code (ID: 42)
      - The Pragmatic Programmer (ID: 43)
```

---

## How the LLM Decides Which Tools to Call

The MCP protocol exposes tool names, descriptions, and input schemas to the LLM. The LLM picks tools based on:

1. **Tool descriptions** — each tool has a description like "Create a new record for a model" that the LLM matches against user intent
2. **Prompt guide** — the `get_prompt_guide` response explicitly tells the LLM the recommended workflow (validate → summarize → create)
3. **Validation feedback** — `validate_form` errors guide the LLM to collect missing fields before retrying

The framework's tool descriptions include model-specific context (server name, model names, required fields) so the LLM can make informed decisions without extra round-trips.

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
├── config.ts               Server wiring (tool + prompt registries)
├── server.ts               StdioServer entry point
└── tsconfig.json
```

## Connecting to a Real API

The strategy tools (guide, validate, summary) work immediately. To enable CRUD tools, inject an API client in `config.ts`:

```typescript
import axios from 'axios'

function createApiClient(token: string): ApiClient {
  const http = axios.create({
    baseURL: 'https://your-api.example.com',
    headers: { Authorization: `Bearer ${token}` }
  })
  return {
    get: (url, params) => http.get(url, { params }).then((r) => r.data),
    post: (url, data) => http.post(url, data).then((r) => r.data),
    patch: (url, data) => http.patch(url, data).then((r) => r.data),
    delete: (url) => http.delete(url).then((r) => r.data)
  }
}
```

mcp-kit doesn't care what API you talk to. It formats payloads according to the configured convention (JSON:API by default, HAL also supported) and normalizes responses automatically.

## Next Steps

- Add more models (Author, Category) — still 10 tools, polymorphic
- Add OAuth for remote access (`HttpServer` + `OAuthService`)
- Add MCP Apps for interactive forms (`AppRegistry`)
- Add domain workflows for multi-step operations
- See the [guides](../../docs/guides/) for deep dives on each feature
