export interface CommandLineArgs {
  maxReplies: number;
  exitWhenDone: boolean;
  processAll: boolean;
}

/**
 * Parses command line arguments for the Twitter bot components
 */
export function parseCommandLineArgs(): CommandLineArgs {
  const args = process.argv.slice(2);
  const result: CommandLineArgs = {
    maxReplies: parseInt(process.env.MAX_REPLIES_PER_RUN || '3', 10),
    exitWhenDone: false,
    processAll: false
  };

  for (const arg of args) {
    const maxRepliesMatch = arg.match(/^--max-replies=(\d+)$/);
    if (maxRepliesMatch) {
      result.maxReplies = parseInt(maxRepliesMatch[1], 10);
      continue;
    }

    if (arg === '--exit-when-done' || arg === '--exit-when-done=true') {
      result.exitWhenDone = true;
      continue;
    }

    if (arg === '--process-all' || arg === '--process-all=true') {
      result.processAll = true;
      continue;
    }
  }

  return result;
}

/**
 * Logs the command line arguments that were parsed
 */
export function logCommandLineArgs(componentName: string, args: CommandLineArgs): void {
  console.log(`${componentName}: Command line arguments:`);
  console.log(`  Max Replies: ${args.maxReplies}`);
  console.log(`  Exit When Done: ${args.exitWhenDone}`);
  console.log(`  Process All: ${args.processAll}`);
} 