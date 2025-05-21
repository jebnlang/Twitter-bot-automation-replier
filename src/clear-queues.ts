import { Queue } from 'bullmq';
import dotenv from 'dotenv';

// Load environment variables from .env file
dotenv.config();

console.log('[ClearQueues] Script started. Attempting to load Redis connection info...');

// Try to get Redis URL from multiple possible environment variables
const REDIS_URL = process.env.REDIS_URL || process.env.REDIS_PUBLIC_URL;
console.log(`[ClearQueues] REDIS_URL loaded: ${REDIS_URL}`);

// Fallback to constructing URL from components if needed
if (!REDIS_URL) {
  console.log('[ClearQueues] No Redis URL found, attempting to construct from components...');
  
  const host = process.env.REDISHOST || 'localhost';
  const port = process.env.REDISPORT || '6379';
  const password = process.env.REDISPASSWORD ? `:${process.env.REDISPASSWORD}@` : '';
  const user = process.env.REDISUSER ? `${process.env.REDISUSER}:` : '';
  
  const constructedUrl = `redis://${user}${password}${host}:${port}`;
  console.log(`[ClearQueues] Constructed Redis URL: ${constructedUrl}`);
  
  // Set REDIS_URL to the constructed URL
  process.env.REDIS_URL = constructedUrl;
}

if (!process.env.REDIS_URL) {
  console.error('[ClearQueues] Error: Could not determine Redis connection info from environment variables.');
  process.exit(1);
}

// Parse Redis URL
let redisConnectionOptions;
try {
    console.log('[ClearQueues] Parsing REDIS_URL...');
    const redisUrl = new URL(process.env.REDIS_URL);
    redisConnectionOptions = {
        host: redisUrl.hostname,
        port: parseInt(redisUrl.port, 10),
        password: redisUrl.password ? decodeURIComponent(redisUrl.password) : undefined,
        db: redisUrl.pathname ? parseInt(redisUrl.pathname.substring(1), 10) : 0,
        // Add connection timeout
        connectTimeout: 5000, // 5 seconds timeout
        maxRetriesPerRequest: 2
    };
    console.log('[ClearQueues] REDIS_URL parsed successfully:', redisConnectionOptions);
} catch (e: any) {
    console.error(`[ClearQueues] Error: Invalid REDIS_URL format: ${process.env.REDIS_URL}. ${e.message}`);
    process.exit(1);
}


const tweetsQueueName = 'tweets';
const approvedTweetsQueueName = 'tweets-approved';

const queuesToClear = [
  { name: tweetsQueueName, connection: redisConnectionOptions },
  { name: approvedTweetsQueueName, connection: redisConnectionOptions },
];

// Set a global timeout to ensure the script exits even if Redis operations hang
const GLOBAL_TIMEOUT_MS = 10000; // 10 seconds
const globalTimeout = setTimeout(() => {
  console.error('[ClearQueues] Global timeout reached. Forcing exit.');
  process.exit(1);
}, GLOBAL_TIMEOUT_MS);

// Ensure the timeout is cleared if we exit normally
globalTimeout.unref();

async function clearAllQueues() {
  console.log('[ClearQueues] clearAllQueues function starting...');
  let allClearedSuccessfully = true;

  for (const qDef of queuesToClear) {
    let queue: Queue | null = null;
    try {
      console.log(`[ClearQueues] Attempting to connect to queue: ${qDef.name} with options:`, qDef.connection);
      queue = new Queue(qDef.name, { connection: qDef.connection });
      
      // Set a timeout for the obliterate operation
      const obliteratePromise = queue.obliterate({ force: true });
      const timeoutPromise = new Promise((_, reject) => 
        setTimeout(() => reject(new Error(`Obliterate operation timed out for queue ${qDef.name}`)), 5000)
      );
      
      console.log(`[ClearQueues] Connected to queue: ${qDef.name}. Obliterating with timeout...`);
      await Promise.race([obliteratePromise, timeoutPromise]);
      console.log(`[ClearQueues] Queue ${qDef.name} obliterated successfully.`);
    } catch (error: any) {
      console.error(`[ClearQueues] Error processing queue ${qDef.name}:`, error.message);
      allClearedSuccessfully = false;
    } finally {
      if (queue) {
        try {
          console.log(`[ClearQueues] Closing connection for queue ${qDef.name}...`);
          await Promise.race([
            queue.close(), 
            new Promise((_, reject) => setTimeout(() => reject(new Error('Close timed out')), 3000))
          ]);
          console.log(`[ClearQueues] Connection closed for queue ${qDef.name}.`);
        } catch (error: any) {
          console.error(`[ClearQueues] Error closing queue ${qDef.name}:`, error.message);
        }
      } else {
        console.log(`[ClearQueues] Queue object for ${qDef.name} was not instantiated, nothing to close.`);
      }
    }
  }

  // Clear the global timeout since we're exiting properly
  clearTimeout(globalTimeout);

  if (allClearedSuccessfully) {
    console.log('[ClearQueues] All specified queues cleared successfully.');
    process.exit(0); // Exit with success code
  } else {
    console.error('[ClearQueues] One or more queues could not be cleared, but we are continuing.');
    process.exit(0); // Still exit with success code to allow the process to continue
  }
}

clearAllQueues().catch(error => {
  console.error('[ClearQueues] Unhandled error during queue clearing process:', error);
  // Clear the global timeout since we're exiting
  clearTimeout(globalTimeout);
  process.exit(1);
}); 