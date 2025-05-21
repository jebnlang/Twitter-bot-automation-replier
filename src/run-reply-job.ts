import dotenv from 'dotenv';
import { exec } from 'child_process';
import { promisify } from 'util';

// Load environment variables
dotenv.config();

const execPromise = promisify(exec);

// Get configuration from environment variables
// Default to 3 replies per run if not specified
const MAX_REPLIES_PER_RUN = parseInt(process.env.MAX_REPLIES_PER_RUN || '3', 10);

console.log(`Reply Job: Starting with MAX_REPLIES_PER_RUN=${MAX_REPLIES_PER_RUN}`);

// Helper to run a command and log output
async function runCommand(command: string): Promise<void> {
  console.log(`Reply Job: Running command: ${command}`);
  try {
    const { stdout, stderr } = await execPromise(command);
    if (stdout) console.log(`Command output:\n${stdout}`);
    if (stderr) console.error(`Command error output:\n${stderr}`);
  } catch (error: any) {
    console.error(`Reply Job: Error executing command: ${error.message}`);
    if (error.stdout) console.log(`Command output:\n${error.stdout}`);
    if (error.stderr) console.error(`Command error output:\n${error.stderr}`);
    throw error; // Re-throw to handle in the main flow
  }
}

// Main job function
async function runReplyJob() {
  try {
    // Step 1: Clear any previous queues to start fresh
    console.log('Reply Job: Clearing previous queues...');
    await runCommand('ts-node src/clear-queues.ts');

    // Step 2: Run the finder to identify tweets to reply to
    console.log('Reply Job: Running finder to identify tweets...');
    await runCommand(`ts-node src/finder.ts --max-replies=${MAX_REPLIES_PER_RUN} --exit-when-done=true`);

    // Step 3: Run the brain to generate replies for identified tweets
    console.log('Reply Job: Running brain to generate replies...');
    await runCommand('ts-node src/brain.ts --process-all --exit-when-done=true');

    // Step 4: Run the poster to post the approved replies
    console.log('Reply Job: Running poster to post replies...');
    await runCommand('ts-node src/poster.ts --process-all --exit-when-done=true');

    console.log('Reply Job: Completed successfully');
  } catch (error) {
    console.error('Reply Job: Failed with error:', error);
    process.exit(1);
  }

  // Give time for any async operations to complete
  setTimeout(() => {
    console.log('Reply Job: Exiting process');
    process.exit(0);
  }, 2000);
}

// Run the job
runReplyJob(); 