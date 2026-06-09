# Security Policy

## Supported Versions

| Version        | Supported           |
| -------------- | ------------------- |
| Latest minor   | ✓                   |
| Previous minor | Security fixes only |
| Older          | ✗                   |

## Reporting a Vulnerability

Please **do not** open a public GitHub issue for security vulnerabilities.

Report vulnerabilities by emailing **david@mcp-rune.dev** with:

- A description of the vulnerability and its potential impact
- Steps to reproduce or a proof-of-concept
- Affected versions

You will receive an acknowledgement within 48 hours. If confirmed, a fix will be released as a patch version and credited to you (unless you prefer to remain anonymous).

## Supply Chain Security

This project uses [Socket Security](https://socket.dev) to detect supply chain risks in npm dependencies (malicious packages, protestware, typosquatting, dependency confusion, and similar threats).

**Running a scan locally:**

```bash
npm install -g socket  # install once
socket login           # authenticate via browser (one-time)
socket scan create     # run the scan
```

**Auditing a specific package before adding it:**

```bash
npx socket info <package-name>
```

**Automated scanning** is handled via the [Socket GitHub App](https://github.com/apps/socket-security), which scans every pull request and flags new dependency risks before merge.

If a scan surfaces a high-severity finding, treat it the same as a vulnerability report: pin or replace the affected dependency, release a patch version, and document it in the changelog.

## Scope

This policy covers the `@mcp-rune/mcp-rune` npm package and its source at [github.com/mcp-rune/mcp-rune](https://github.com/mcp-rune/mcp-rune).
