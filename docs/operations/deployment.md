# Deployment Guide

Deploy Engineer MCP server to Hostinger VPS using Kamal.

## Quick Reference

Run all commands from the project root directory:

```bash
kamal setup      # First-time deploy
kamal deploy     # Deploy latest code
kamal logs       # View logs
kamal shell      # Open shell in container
kamal db-migrate # Run database migrations
```

## Architecture

```
┌─────────────────────────────────────────────────────────────────────────┐
│                          Hostinger VPS                                  │
│                         (46.202.170.228)                                │
│                                                                         │
│  ┌─────────────┐   ┌─────────────┐   ┌─────────────┐                   │
│  │  Identity   │   │  Engineer   │   │Engineer MCP │                   │
│  │  (Rails)    │   │  (Rails)    │   │  (Node.js)  │                   │
│  │  /identity  │   │  /engineer  │   │/engineer-mcp│                   │
│  │  :3000      │   │  :80        │   │   :4100     │                   │
│  └──────┬──────┘   └──────┬──────┘   └──────┬──────┘                   │
│         │                 │                 │                           │
│         └────────────┬────┴─────────────────┘                           │
│                      │                                                  │
│              ┌───────▼───────┐                                          │
│              │   MySQL 8.0   │                                          │
│              │  identity-db  │                                          │
│              └───────────────┘                                          │
│                                                                         │
│              ┌───────────────┐                                          │
│              │ Kamal Proxy   │ ◄── https://dsaenz.dev/*                 │
│              │ (SSL/Routing) │                                          │
│              └───────────────┘                                          │
└─────────────────────────────────────────────────────────────────────────┘
```

## Prerequisites

| Tool   | Version | Installation                        |
| ------ | ------- | ----------------------------------- |
| Kamal  | 2.x     | `gem install kamal`                 |
| Docker | 24+     | https://docs.docker.com/get-docker/ |

## First-Time Setup

### 1. Set Environment Variables

```bash
export KAMAL_REGISTRY_PASSWORD=<docker-hub-token>
export MYSQL_PASSWORD=<mysql-root-password>
export OAUTH_CLIENT_ID=<client-id>
export OAUTH_CLIENT_SECRET=<client-secret>
```

### 2. Deploy

```bash
kamal setup
```

### 3. Create Database

The migration script creates tables but not the database itself. SSH into the droplet and create it:

```bash
ssh root@46.202.170.228
docker exec -it identity-db mysql -u root -p -e "CREATE DATABASE IF NOT EXISTS mcp_servers CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;"
```

Enter the MySQL root password when prompted.

### 4. Run Migrations

```bash
kamal db-migrate
```

### 5. Verify

```bash
curl https://dsaenz.dev/engineer-mcp/health
# {"status":"ok","service":"engineer-mcp","transport":"streamable-http","activeSessions":0}
```

## Infrastructure Prerequisites

These steps are done once during initial infrastructure setup:

1. **OAuth Application** - Create "Engineer MCP" application in Identity's Doorkeeper admin
2. **MCP Database** - Created via step 3 above (`CREATE DATABASE mcp_servers`)

## Subsequent Deployments

```bash
kamal deploy
```

## Environment Variables

| Variable                  | Description          |
| ------------------------- | -------------------- |
| `KAMAL_REGISTRY_PASSWORD` | Docker Hub token     |
| `MYSQL_PASSWORD`          | MySQL root password  |
| `OAUTH_CLIENT_ID`         | OAuth2 client ID     |
| `OAUTH_CLIENT_SECRET`     | OAuth2 client secret |

All other environment variables are configured in `config/deploy.yml`.

## Docker

### Signal Handling

The Dockerfile uses `exec node` to ensure the Node.js process receives SIGTERM
directly from Docker/Kamal during deployments. The `HttpServer` handles both
SIGTERM and SIGINT, gracefully closing MCP sessions and HTTP connections before
exiting.

### Health Check

The container includes a Docker HEALTHCHECK that polls the `/health` endpoint.
Kamal-proxy also performs its own health check at the path configured in
`config/deploy.yml` before routing traffic to a new container.

## Troubleshooting

### Container won't start

```bash
kamal logs
```

Check for missing environment variables or MySQL connection issues.

### Health check failing

```bash
curl -v https://dsaenz.dev/engineer-mcp/health
kamal app details
```

### OAuth errors

Verify the OAuth application exists in Identity's Doorkeeper applications with name "Engineer MCP".

### MySQL connection issues

```bash
kamal shell
# In container:
node -e "require('mysql2').createConnection({host:'identity-db',user:'root',password:process.env.MYSQL_PASSWORD}).connect(e => console.log(e || 'OK'))"
```
