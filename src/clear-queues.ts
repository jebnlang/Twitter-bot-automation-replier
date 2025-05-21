import { Queue } from 'bullmq';
import dotenv from 'dotenv';

// Load environment variables from .env file
dotenv.config();

console.log('[ClearQueues] Script started. Attempting to load REDIS_URL...');

const REDIS_URL = process.env.REDIS_URL;
console.log(`[ClearQueues] REDIS_URL loaded: ${REDIS_URL}`);

if (!REDIS_URL) {
  console.error('[ClearQueues] Error: REDIS_URL is not defined in the environment variables for queue clearing.');
  process.exit(1);
}

// Parse Redis URL
let redisConnectionOptions;
try {
    console.log('[ClearQueues] Parsing REDIS_URL...');
    const redisUrl = new URL(REDIS_URL);
    redisConnectionOptions = {
        host: redisUrl.hostname,
        port: parseInt(redisUrl.port, 10),
        password: redisUrl.password ? decodeURIComponent(redisUrl.password) : undefined,
        db: redisUrl.pathname ? parseInt(redisUrl.pathname.substring(1), 10) : 0,
    };
    console.log('[ClearQueues] REDIS_URL parsed successfully:', redisConnectionOptions);
} catch (e: any) {
    console.error(`[ClearQueues] Error: Invalid REDIS_URL format: ${REDIS_URL}. ${e.message}`);
    process.exit(1);
}


const tweetsQueueName = 'tweets';
const approvedTweetsQueueName = 'tweets-approved';

const queuesToClear = [
  { name: tweetsQueueName, connection: redisConnectionOptions },
  { name: approvedTweetsQueueName, connection: redisConnectionOptions },
];

async function clearAllQueues() {
  console.log('[ClearQueues] clearAllQueues function starting...');
  let allClearedSuccessfully = true;

  for (const qDef of queuesToClear) {
    let queue: Queue | null = null;
    try {
      console.log(`[ClearQueues] Attempting to connect to queue: ${qDef.name} with options:`, qDef.connection);
      queue = new Queue(qDef.name, { connection: qDef.connection });
      console.log(`[ClearQueues] Successfully connected to queue: ${qDef.name}. Obliterating...`);
      await queue.obliterate({ force: true });
      console.log(`[ClearQueues] Queue ${qDef.name} obliterated successfully.`);
    } catch (error: any) {
      console.error(`[ClearQueues] Error processing queue ${qDef.name}:`, error.message);
      allClearedSuccessfully = false;
    } finally {
      if (queue) {
        console.log(`[ClearQueues] Closing connection for queue ${qDef.name}...`);
        await queue.close();
        console.log(`[ClearQueues] Connection closed for queue ${qDef.name}.`);
      } else {
        console.log(`[ClearQueues] Queue object for ${qDef.name} was not instantiated, nothing to close.`);
      }
    }
  }

  if (allClearedSuccessfully) {
    console.log('[ClearQueues] All specified queues cleared successfully.');
    process.exit(0); // Exit with success code
  } else {
    console.error('[ClearQueues] One or more queues could not be cleared.');
    process.exit(1); // Exit with error code
  }
}

clearAllQueues().catch(error => {
  console.error('[ClearQueues] Unhandled error during queue clearing process:', error);
  process.exit(1);
}); 