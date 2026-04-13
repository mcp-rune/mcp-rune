import { StdioServer } from 'mcp-kit/server'
import { mcpConfig } from './config.js'

// For local dev, provide a dummy token (no real API backend in this example)
const ACCESS_TOKEN = process.env.ACCESS_TOKEN || 'demo-token'

const server = new StdioServer({
  accessToken: ACCESS_TOKEN,
  mcp: mcpConfig
})

server.start()
