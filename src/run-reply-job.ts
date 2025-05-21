import dotenv from 'dotenv';
import { exec } from 'child_process';
// We'll use the callback version of exec for better error logging

// Load environment variables
dotenv.config();

// Get configuration from environment variables
// Default to 3 replies per run if not specified
const MAX_REPLIES_PER_RUN = parseInt(process.env.MAX_REPLIES_PER_RUN || '3', 10);

// Determine if we're in production (Railway) or development environment
const isProd = process.env.RAILWAY_STATIC_URL || process.env.RAILWAY_SERVICE_NAME;
const scriptPrefix = isProd ? 'node dist/' : 'ts-node src/';
const scriptExtension = isProd ? '.js' : '.ts';

console.log(`Reply Job: Starting with MAX_REPLIES_PER_RUN=${MAX_REPLIES_PER_RUN} in ${isProd ? 'production' : 'development'} mode`);

// Helper to run a command and log output
async function runCommand(command: string): Promise<void> {
  return new Promise((resolve, reject) => {
    console.log(`Reply Job: Running command: ${command}`);
    const process = exec(command, (error, stdout, stderr) => {
      if (stdout) {
        console.log(`[Command Output - ${command}]\n${stdout}`);
      }
      if (stderr) {
        console.error(`[Command Stderr - ${command}]\n${stderr}`);
      }
      if (error) {
        console.error(`[Command Error - ${command}] Execution failed:`, error);
        reject(error); // Reject the promise if exec returns an error
      } else {
        resolve(); // Resolve the promise on successful execution
      }
    });

    process.on('exit', (code, signal) => {
        console.log(`[Command Exit - ${command}] Process exited with code ${code} and signal ${signal}`);
    });
  });
}

// Main job function
async function runReplyJob() {
  try {
    // Step 1: Clear any previous queues to start fresh
    console.log('Reply Job: Clearing previous queues...');
    await runCommand(`${scriptPrefix}clear-queues${scriptExtension}`);

    // Step 2: Run the finder to identify tweets to reply to
    console.log('Reply Job: Running finder to identify tweets...');
    await runCommand(`${scriptPrefix}finder${scriptExtension} --max-replies=${MAX_REPLIES_PER_RUN} --exit-when-done=true`);

    // Step 3: Run the brain to generate replies for identified tweets
    console.log('Reply Job: Running brain to generate replies...');
    await runCommand(`${scriptPrefix}brain${scriptExtension} --process-all --exit-when-done=true`);

    // Step 4: Run the poster to post the approved replies
    console.log('Reply Job: Running poster to post replies...');
    await runCommand(`${scriptPrefix}poster${scriptExtension} --process-all --exit-when-done=true`);

    console.log('Reply Job: Completed successfully');
  } catch (error) {
    console.error('Reply Job: Failed with an error during one of the steps.'); // More generic error here as specific errors are logged by runCommand
    process.exit(1);
  }

  // Give time for any async operations to complete
  setTimeout(() => {
    console.log('Reply Job: Exiting process after successful run or caught error in runCommand.');
    process.exit(0);
  }, 2000);
}

// Run the job
runReplyJob(); 