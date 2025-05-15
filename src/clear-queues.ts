import { Queue } from 'bullmq';
import dotenv from 'dotenv';

// Load environment variables from .env file
dotenv.config();

const REDIS_URL = process.env.REDIS_URL;

if (!REDIS_URL) {
  console.error('Error: REDIS_URL is not defined in the environment variables for queue clearing.');
  process.exit(1);
}

// Parse Redis URL
let redisConnectionOptions;
try {
    const redisUrl = new URL(REDIS_URL);
    redisConnectionOptions = {
        host: redisUrl.hostname,
        port: parseInt(redisUrl.port, 10),
        password: redisUrl.password ? decodeURIComponent(redisUrl.password) : undefined,
        db: redisUrl.pathname ? parseInt(redisUrl.pathname.substring(1), 10) : 0,
    };
} catch (e: any) {
    console.error(`Error: Invalid REDIS_URL format: ${REDIS_URL}. ${e.message}`);
    process.exit(1);
}


const tweetsQueueName = 'tweets';
const approvedTweetsQueueName = 'tweets-approved';

const queuesToClear = [
  { name: tweetsQueueName, connection: redisConnectionOptions },
  { name: approvedTweetsQueueName, connection: redisConnectionOptions },
];

async function clearAllQueues() {
  console.log('Queue Clearing Script: Starting...');
  let allClearedSuccessfully = true;

  for (const qDef of queuesToClear) {
    const queue = new Queue(qDef.name, { connection: qDef.connection });
    try {
      console.log(`Queue Clearing Script: Obliterating queue: ${qDef.name}...`);
      await queue.obliterate({ force: true });
      console.log(`Queue Clearing Script: Queue ${qDef.name} obliterated successfully.`);
    } catch (error: any) {
      console.error(`Queue Clearing Script: Error obliterating queue ${qDef.name}:`, error.message);
      allClearedSuccessfully = false;
    } finally {
      // It's important to close the connection to allow the script to exit gracefully
      await queue.close();
    }
  }

  if (allClearedSuccessfully) {
    console.log('Queue Clearing Script: All specified queues cleared successfully.');
    process.exit(0); // Exit with success code
  } else {
    console.error('Queue Clearing Script: One or more queues could not be cleared.');
    process.exit(1); // Exit with error code
  }
}

clearAllQueues().catch(error => {
  console.error('Queue Clearing Script: Unhandled error during queue clearing process:', error);
  process.exit(1);
}); 