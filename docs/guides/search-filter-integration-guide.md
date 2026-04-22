# Search Filter Integration Guide

How to add structured filter search to an MCP server backed by a Rails API. This guide covers both sides of the integration: the Rails API endpoint and the MCP model filter specification.

## Architecture Overview

```
LLM (natural language)
  ↓ get_filters_guide("model")
  ↓ learns available filters
  ↓ translates user intent to structured filters
  ↓
search_records({ model, filters, page, per_page })
  ↓ POST /api/v1/{model}/search
  ↓ { filters: {...}, page, per_page }
  ↓
Rails API
  ↓ applies model scopes
  ↓ paginates
  ↓
{ records: [...], pagination: { page, per_page, total } }
  ↓
search_records_view (MCP App) — OR — analysis memory (map-reduce)
```

The MCP model's `static filters` is the shared contract. The MCP framework derives it into a prompt (via `get_filters_guide`), and the Rails API implements the same filter keys.

> **Note:** This guide covers **direct search** — models with their own search endpoint. For **group search** (multiple models sharing one endpoint, e.g., Library search), see the Search Adapters section in CLAUDE.md. Group search also supports filter pass-through via the same adapter pipeline.

## Step 1: Define Filters on the MCP Model

Add `static filters` to the model class. This single declaration activates three framework features:

- `search_records` tool — accepts the model for filtered search
- `get_filters_guide` tool — generates filter documentation for the LLM
- Search view MCP App — renders paginated results with filter chips

### Filter Types

| Type            | MCP sends                                               | Rails receives                           | Description                          |
| --------------- | ------------------------------------------------------- | ---------------------------------------- | ------------------------------------ |
| `text`          | `"field": "search term"`                                | `params[:filters][:field]`               | Free text search                     |
| `enum`          | `"field": "value"`                                      | `params[:filters][:field]`               | Constrained value                    |
| `relation`      | `"field": "123"`                                        | `params[:filters][:field]`               | ID of related model                  |
| `date_range`    | `"field": { "from": "YYYY-MM-DD", "to": "YYYY-MM-DD" }` | `params.dig(:filters, :field, :from/to)` | Date range (either side optional)    |
| `integer_range` | `"field": { "from": 30, "to": 120 }`                    | `params.dig(:filters, :field, :from/to)` | Numeric range (either side optional) |

### Example: Activity Model

```javascript
// src/{server}/models/activity.js
static filters = {
  theme_id: {
    type: 'relation',
    label: 'Theme',
    relatedModel: 'theme',
    description: 'Filter by theme'
  },
  category_id: {
    type: 'relation',
    label: 'Category',
    relatedModel: 'category',
    description: 'Filter by category within a theme'
  },
  started_at: {
    type: 'date_range',
    label: 'Start Date',
    description: 'Filter by activity start date range'
  },
  duration_minutes: {
    type: 'integer_range',
    label: 'Duration (minutes)',
    description: 'Filter by activity duration in minutes'
  }
}
```

### Filter Name Convention

Filter keys should match the Rails scope parameter names exactly. This lets the Rails controller pass filter values directly to scopes without mapping.

- Relation filters: use the foreign key name (e.g., `theme_id`, not `theme`)
- Range filters: use the column name (e.g., `started_at`, `duration_minutes`)
- Text/enum filters: use the column name (e.g., `status`, `title`)

## Step 2: Add Rails API Search Endpoint

### Route

```ruby
# config/routes.rb
namespace :api do
  namespace :v1 do
    resources :activities do
      collection do
        post :search
      end
    end
  end
end
```

This produces `POST /api/v1/activities/search` — matching the MCP `SearchRecordsTool` convention of `POST {endpoint}/search`.

### Controller Action

```ruby
# app/controllers/api/v1/activities_controller.rb

# POST /api/v1/activities/search
def search
  filters = params.fetch(:filters, {}).permit(
    :theme_id, :category_id, :book_id, :contribution_id,
    started_at: [:from, :to],
    duration_minutes: [:from, :to]
  )

  @page = [(params[:page] || 1).to_i, 1].max
  @per_page = [(params[:per_page] || 50).to_i, 200].min

  scope = effective_user.activities
    .includes(:theme, :category, :books, :contribution, :tags)
    .by_theme(filters[:theme_id])
    .by_category(filters[:category_id])
    .by_book(filters[:book_id])
    .by_contribution(filters[:contribution_id])
    .started_after(filters.dig(:started_at, :from))
    .started_before(filters.dig(:started_at, :to))
    .min_duration(filters.dig(:duration_minutes, :from))
    .max_duration(filters.dig(:duration_minutes, :to))
    .order(started_at: :desc)

  @total = scope.count
  @activities = scope.offset((@page - 1) * @per_page).limit(@per_page)
end
```

Key patterns:

- `params.fetch(:filters, {}).permit(...)` — strong params with nested hash support for range filters
- `filters.dig(:started_at, :from)` — safely extracts range boundaries
- Each scope handles `nil` gracefully (no-op when value is blank)
- Pagination clamped to max 200

### Response Template

```ruby
# app/views/api/v1/activities/search.json.jbuilder
json.records @activities, partial: "api/v1/activities/activity", as: :activity
json.pagination do
  json.page @page
  json.per_page @per_page
  json.total @total
end
```

The response shape `{ records: [...], pagination: { page, per_page, total } }` is required by `SearchRecordsTool` and the search view MCP App.

## Step 3: Elasticsearch Variant

For servers backed by Elasticsearch (e.g., a downstream MCP server), the Rails search endpoint delegates to ES instead of chaining ActiveRecord scopes.

### Controller Pattern

```ruby
# POST /api/v1/records/search
def search
  filters = params.fetch(:filters, {}).permit(
    :status, :category,
    created_at: [:from, :to],
    score: [:from, :to]
  )

  page = [(params[:page] || 1).to_i, 1].max
  per_page = [(params[:per_page] || 50).to_i, 200].min

  # Build ES query from structured filters
  query = build_es_query(filters)
  results = Record.search(query, page: page, per_page: per_page)

  render json: {
    records: results.records.map(&:as_indexed_json),
    pagination: {
      page: page,
      per_page: per_page,
      total: results.total_count
    }
  }
end

private

def build_es_query(filters)
  must_clauses = []
  filter_clauses = []

  # Text filters → match query
  if filters[:title].present?
    must_clauses << { match: { title: filters[:title] } }
  end

  # Enum filters → term query
  if filters[:status].present?
    filter_clauses << { term: { status: filters[:status] } }
  end

  # Relation filters → term query on foreign key
  if filters[:category_id].present?
    filter_clauses << { term: { category_id: filters[:category_id] } }
  end

  # Date range filters → range query
  if filters[:created_at].present?
    range = {}
    range[:gte] = filters.dig(:created_at, :from) if filters.dig(:created_at, :from).present?
    range[:lte] = filters.dig(:created_at, :to) if filters.dig(:created_at, :to).present?
    filter_clauses << { range: { created_at: range } } if range.present?
  end

  # Integer range filters → range query
  if filters[:score].present?
    range = {}
    range[:gte] = filters.dig(:score, :from).to_i if filters.dig(:score, :from).present?
    range[:lte] = filters.dig(:score, :to).to_i if filters.dig(:score, :to).present?
    filter_clauses << { range: { score: range } } if range.present?
  end

  {
    query: {
      bool: {
        must: must_clauses.presence || [{ match_all: {} }],
        filter: filter_clauses
      }
    }
  }
end
```

### Key Differences from ActiveRecord Variant

| Aspect          | ActiveRecord                                    | Elasticsearch            |
| --------------- | ----------------------------------------------- | ------------------------ |
| Query execution | Scope chaining                                  | ES bool query            |
| Text search     | `LIKE` / SQL                                    | `match` query (analyzed) |
| Enum/relation   | `where()`                                       | `term` filter            |
| Date range      | Two scopes (`started_after` + `started_before`) | Single `range` filter    |
| Integer range   | Two scopes (`min_` + `max_`)                    | Single `range` filter    |
| Pagination      | `offset().limit()`                              | ES `from` + `size`       |
| Total count     | `scope.count`                                   | `results.total_count`    |

### MCP Side: Identical

The MCP model's `static filters` definition is **identical** regardless of whether the Rails API uses ActiveRecord or Elasticsearch. The MCP doesn't know or care about the backend — it sends `{ filters, page, per_page }` and receives `{ records, pagination }`.

## Step 4: What Activates Automatically

Once a model has `static filters`, the following happens with zero additional code:

1. **`search_records` tool** — `_getSearchableModelNames()` includes the model
2. **`get_filters_guide` tool** — generates markdown documentation from the filter spec
3. **`list_models` tool** — shows `filterable_search: { available: true, filter_count: N }`
4. **Search view MCP App** — `SEARCH_VIEW_MODELS` in `apps/index.js` picks up the model (and `LIST_VIEW_MODELS` excludes it)
5. **`find_model` tool** — usage rules direct the LLM to use `search_records` for filterable models

## Step 5: LLM Workflows

### Visual Search (Single Page)

```
User: "Show me activities from last week about React"
  ↓
LLM: get_filters_guide("activity")  → learns filter spec
LLM: search_records({ model: "activity", filters: { started_at: { from: "2024-03-05" } } })
LLM: search_records_view(same args)  → renders paginated table in MCP App
```

### Analysis (Multi-Page Map-Reduce)

```
User: "Analyze my activity patterns for Q1"
  ↓
LLM: get_filters_guide("activity")
LLM: search_records({ filters: { started_at: { from: "2024-01-01", to: "2024-03-31" } }, page: 1 })
LLM: store_analysis_memory({ analysis_id: "q1-review", finding: "...", category: "patterns" })
LLM: search_records({ ..., page: 2 })
LLM: store_analysis_memory({ ... })
  ...iterate pages...
LLM: recall_analysis_memories({ analysis_id: "q1-review" })
LLM: synthesize and present findings
LLM: clear_analysis_memories({ analysis_id: "q1-review" })
```

## Checklist

- [ ] MCP model: Add `static filters` with correct types and keys
- [ ] Rails route: Add `post :search` collection route
- [ ] Rails controller: Add `search` action with filter parsing + pagination
- [ ] Rails view: Add `search.json.jbuilder` with `{ records, pagination }` shape
- [ ] Rails tests: Integration tests for search endpoint
- [ ] MCP tests: Verify filters definition and framework activation
- [ ] E2E: Call `get_filters_guide` → `search_records` → `search_records_view`
