import { Command } from 'commander'

import { inspectCommand } from './inspect.js'

export async function run(argv: string[]): Promise<void> {
  const program = new Command()

  program.name('mcp-rune').description('mcp-rune framework CLI')

  program
    .command('inspect')
    .description('Open the MCP Inspector pre-wired against the current project')
    .option('--transport <kind>', 'force transport: stdio | http')
    .option('--url <url>', 'connect to this URL (implies http)')
    .option('--port <port>', 'http port (default 4100)')
    .option('--server <path>', 'path to the stdio server entry')
    .action(inspectCommand)

  await program.parseAsync(argv)
}
