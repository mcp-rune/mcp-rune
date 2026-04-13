# Observability Guide

Structured logging and distributed tracing for MCP servers.

## Structured Logging

All services use JSON structured logging for Loki/Grafana integration.

### Enable Structured Logs

```bash
# Development - opt-in
LOG_FORMAT=json npm run start:engineer:remote

# Production - auto-enabled
NODE_ENV=production npm run start:engineer:remote
```

### Environment Variables

| Variable     | Default | Description                                            |
| ------------ | ------- | ------------------------------------------------------ |
| `LOG_LEVEL`  | `info`  | Log level: `debug`, `info`, `warn`, `error`            |
| `LOG_FORMAT` | `text`  | Log format: `json` or `text` (auto-json in production) |

### Log Format

**Development (text):**

```
2026-01-12 10:30:00 [info] [express] Request completed {"statusCode":200,"duration":"45ms"}
```

**Production (JSON):**

```json
{
  "level": "info",
  "message": "Request completed",
  "timestamp": "2026-01-12T10:30:00.123+0100",
  "app": "mcp-servers",
  "service": "express",
  "method": "POST",
  "path": "/mcp",
  "statusCode": 200,
  "duration": "45ms",
  "requestId": "550e8400-e29b-41d4-a716-446655440000"
}
```

## Request ID Correlation

Request IDs enable distributed tracing across all services in the stack.

### Flow

```
┌─────────────────┐     X-Request-ID      ┌─────────────────┐
│   MCP Client    │ ───────────────────▶  │   mcp-servers   │
│  (Claude Code)  │                       │   (Node.js)     │
└─────────────────┘                       └────────┬────────┘
                                                   │
                                         X-Request-ID (same)
                                                   │
                                                   ▼
                                          ┌─────────────────┐
                                          │    Engineer     │
                                          │   (Rails API)   │
                                          └────────┬────────┘
                                                   │
                                         X-Request-ID (same)
                                                   │
                                                   ▼
                                          ┌─────────────────┐
                                          │    Identity     │
                                          │   (Rails OAuth) │
                                          └─────────────────┘
```

### How It Works

1. **mcp-servers** (Node.js):
   - Reads incoming `X-Request-ID` header (if present)
   - Generates UUID v4 if not present
   - Includes `requestId` in all log entries
   - Passes `X-Request-ID` to Engineer API calls
   - Returns `X-Request-ID` in response header

2. **Engineer/Identity** (Rails):
   - Rails' `ActionDispatch::RequestId` middleware handles `X-Request-ID`
   - Uses incoming header or generates new UUID
   - Lograge includes `request_id` in JSON output
   - `config.log_tags = [ :request_id ]` tags all logs

### Response Header

All responses include the request ID for client reference:

```
X-Request-ID: 550e8400-e29b-41d4-a716-446655440000
```

## Grafana/Loki Queries

### Basic Queries

```logql
# All MCP server logs
{app="mcp-servers"}

# Filter by service
{app="mcp-servers"} | json | service="express"

# HTTP errors only
{app="mcp-servers"} | json | statusCode >= 400

# OAuth flow events
{app="mcp-servers"} | json | service="oauth2"

# MCP session lifecycle
{app="mcp-servers"} | json | message=~"MCP session.*"
```

### Distributed Tracing

Trace a request across all services using request ID:

```logql
# Single request across all services
{app=~"mcp-servers|engineer|identity"} | json | request_id="550e8400-e29b-41d4-a716-446655440000"

# All errors for a request
{app=~"mcp-servers|engineer|identity"} | json | request_id="550e8400-e29b-41d4-a716-446655440000" | level="error"
```

### Performance Analysis

```logql
# Slow requests (>1s)
{app="mcp-servers"} | json | duration > 1000

# Request duration histogram
sum by (path) (rate({app="mcp-servers"} | json | unwrap duration [5m]))
```

### Error Analysis

```logql
# Errors with stack traces
{app="mcp-servers"} | json | level="error" | line_format "{{.message}}: {{.error}}"

# Error rate by service
sum by (service) (rate({app="mcp-servers"} | json | level="error" [5m]))
```

## Log Files

Logs are written to daily rotated files:

| File                           | Contents        | Retention |
| ------------------------------ | --------------- | --------- |
| `logs/combined-YYYY-MM-DD.log` | All logs        | 7 days    |
| `logs/error-YYYY-MM-DD.log`    | Error logs only | 7 days    |

Max file size: 20MB (rotates if exceeded).

## Rails Apps Configuration

Both Engineer and Identity use identical Lograge configuration:

```ruby
# config/initializers/lograge.rb
config.lograge.enabled = ENV["LOGRAGE_ENABLED"] == "true" || Rails.env.production?
config.lograge.formatter = Lograge::Formatters::Json.new

config.lograge.custom_options = lambda do |event|
  {
    app: "engineer",  # or "identity"
    time: Time.current.iso8601,
    request_id: event.payload[:request_id],
    remote_ip: event.payload[:remote_ip],
    user_agent: event.payload[:user_agent],
    params: event.payload[:params]&.except("controller", "action", "format")
  }.compact
end
```

Enable in development:

```bash
LOGRAGE_ENABLED=true bin/rails server
```
