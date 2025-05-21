import { Worker, Queue, Job } from 'bullmq';
import dotenv from 'dotenv';
import OpenAI from 'openai';
import fs from 'fs/promises';
import path from 'path';
import Redis from 'ioredis';
import { parseCommandLineArgs, logCommandLineArgs } from './cmd-utils';

// Load environment variables
dotenv.config();

// Parse command line args
const cmdArgs = parseCommandLineArgs();
logCommandLineArgs('Brain Agent', cmdArgs);

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const REDIS_URL = process.env.REDIS_URL;

// To switch personas, change the filename in the line below:
// e.g., 'persona.md' or 'persona_2.md'
// const DEFAULT_PERSONA_FILENAME = 'persona_2.md'; // <--- EDIT THIS LINE TO SWITCH PERSONA
// const PERSONA_FILE_PATH = process.env.PERSONA_PATH || DEFAULT_PERSONA_FILENAME;

// Persona filename is controlled by the BRAIN_PERSONA_FILENAME environment variable
const BRAIN_PERSONA_FILENAME = process.env.BRAIN_PERSONA_FILENAME || 'persona_2.md'; // Default to persona_2.md if not set
const PERSONA_FILE_PATH = path.resolve(BRAIN_PERSONA_FILENAME); // Resolve to an absolute path

if (!OPENAI_API_KEY) {
  console.error('Brain Agent: Error - OPENAI_API_KEY is not defined. Please set it in your .env file.');
  process.exit(1);
}

if (!REDIS_URL) {
  console.error('Brain Agent: Error - REDIS_URL is not defined.');
  process.exit(1);
}

// Initialize Redis Client for duplicate checking
const redisClient = new Redis(REDIS_URL, {
  maxRetriesPerRequest: null, // Important for scripts that shouldn't exit on initial connection failure
  enableReadyCheck: false
});
const REPLIED_TWEETS_SET_KEY = 'replied_tweet_urls';

redisClient.on('error', (err) => console.error('Brain Agent: Redis Client Error', err));

// Initialize OpenAI Client
const openai = new OpenAI({
  apiKey: OPENAI_API_KEY,
});

// --- Queue Definitions ---
const redisConnectionOptions = {
  host: new URL(REDIS_URL).hostname,
  port: parseInt(new URL(REDIS_URL).port, 10),
  password: new URL(REDIS_URL).password ? decodeURIComponent(new URL(REDIS_URL).password) : undefined,
  db: new URL(REDIS_URL).pathname ? parseInt(new URL(REDIS_URL).pathname.substring(1), 10) : 0,
};

// Queue to consume tweets from (populated by Finder)
const tweetsQueueName = 'tweets';

// Get queue instance for checking counts
const tweetsQueue = new Queue(tweetsQueueName, {
  connection: redisConnectionOptions,
});

// Queue to send tweets with drafted replies to (consumed by Poster)
const approvedTweetsQueueName = 'tweets-approved';
const approvedTweetsQueue = new Queue(approvedTweetsQueueName, {
  connection: redisConnectionOptions,
});

// --- Persona Loading ---
let personaContent: string = 'Default persona: Be helpful and concise.'; // Fallback persona
async function loadPersona() {
  try {
    // const fullPath = path.resolve(PERSONA_FILE_PATH); // PERSONA_FILE_PATH is already resolved
    console.log(`Brain Agent: Loading persona from ${PERSONA_FILE_PATH}`);
    personaContent = await fs.readFile(PERSONA_FILE_PATH, 'utf8');
    console.log('Brain Agent: Persona loaded successfully.');
  } catch (error) {
    console.error(`Brain Agent: Error loading persona file from ${PERSONA_FILE_PATH}. Using fallback persona.`, error);
  }
}

// --- Main Worker Logic ---
async function processTweetJob(job: Job<any, any, string>) {
  const tweetUrl = job.data.url;
  if (!tweetUrl) {
    console.warn(`Brain Agent: Job ID ${job.id} missing tweet URL. Skipping.`);
    return; // Or throw error to mark job as failed if URL is always expected
  }

  try {
    const isMember = await redisClient.sismember(REPLIED_TWEETS_SET_KEY, tweetUrl);
    if (isMember) {
      console.log(`Brain Agent: Tweet ${tweetUrl} (Job ID ${job.id}) has already been replied to. Skipping.`);
      return; // Acknowledge job, don't process further
    }
  } catch (redisError) {
    console.error(`Brain Agent: Redis error checking for duplicate tweet ${tweetUrl} (Job ID ${job.id}). Proceeding with caution (may duplicate).`, redisError);
    // Decide if you want to stop or proceed. For now, proceeding with a warning.
  }

  console.log(`\nBrain Agent: Received job ID ${job.id} for tweet URL: ${tweetUrl}`);
  console.log(`Brain Agent: Original tweet text (from Finder): "${job.data.originalText}"`);
  console.log(`Brain Agent: Views: ${job.data.views}`);
  console.log(`Brain Agent: Using persona: "${personaContent.substring(0, 100)}..."`);

  // --- Step 1: Fetch full tweet content (Placeholder) ---
  // For now, we'll just use the originalText provided by the Finder.
  // Later, this could involve scraping the tweet URL for replies or full context.
  const fullTweetContent = job.data.originalText;
  console.log('Brain Agent: Using provided text as full tweet content for now.');

  // --- Step 2: Draft reply using OpenAI ---
  let draftedReply = 'Error: AI reply generation failed.'; // Default on error
  try {
    console.log('Brain Agent: Calling OpenAI API to draft reply...');
    const completion = await openai.chat.completions.create({
      model: 'gpt-4o', // As per spec
      messages: [
        { role: 'system', content: personaContent },
        {
          role: 'user',
          content: `Tweet to reply to:\n"""\n${fullTweetContent}\n"""\n\nDraft your reply based on the persona provided in the system message. If the tweet is sharing knowledge (like a course, tutorial, or educational content), keep the reply very short and concise - just thank them for sharing and add a brief, relevant opinion. Otherwise, follow the normal persona guidelines.`,
        },
      ],
      max_tokens: 70, // Approx 280 chars, good for Twitter replies
      temperature: 0.7, // A balance between creativity and determinism
    });

    if (completion.choices && completion.choices.length > 0 && completion.choices[0].message) {
      draftedReply = completion.choices[0].message.content || 'Error: No content in AI reply.';
    } else {
      draftedReply = 'Error: Unexpected response structure from OpenAI.';
    }
    console.log(`Brain Agent: Successfully drafted reply: "${draftedReply}"`);
  } catch (error: any) {
    console.error('Brain Agent: Error during OpenAI API call:', error.response ? error.response.data : error.message);
    // Keep the default error message for draftedReply or set a more specific one
    if (error.response && error.response.data && error.response.data.error && error.response.data.error.message) {
        draftedReply = `Error from OpenAI: ${error.response.data.error.message}`;
    } else {
        draftedReply = `Error calling OpenAI: ${error.message}`;
    }
  }

  // --- Step 3: Add draft to job payload and move to approved queue ---
  const jobDataForPoster = {
    ...job.data,
    draftedReply,
    processedByBrainAt: new Date().toISOString(),
  };

  await approvedTweetsQueue.add('approvedTweet', jobDataForPoster);
  console.log(`Brain Agent: Job ID ${job.id} with drafted reply moved to queue: ${approvedTweetsQueueName}`);
}

// --- Initialize and Start Worker ---
async function startBrainAgent() {
  await loadPersona(); // Load persona before starting worker

  console.log(`Brain Agent: Starting worker, listening to queue: "${tweetsQueueName}"`);
  
  const worker = new Worker(tweetsQueueName, processTweetJob, {
    connection: redisConnectionOptions,
    concurrency: 5, // Process up to 5 jobs concurrently
    removeOnComplete: { count: 1000 }, // Keep last 1000 completed jobs
    removeOnFail: { count: 5000 },    // Keep last 5000 failed jobs
  });

  worker.on('completed', (job) => {
    console.log(`Brain Agent: Job ID ${job.id} completed successfully.`);
  });

  worker.on('failed', (job, err) => {
    console.error(`Brain Agent: Job ID ${job?.id} failed with error:`, err.message);
  });

  // If processAll flag is set, wait for all jobs to be processed
  if (cmdArgs.processAll) {
    console.log('Brain Agent: --process-all flag set, will process all jobs then exit');
    
    // Check queue size every second
    const checkInterval = setInterval(async () => {
      try {
        const waitingCount = await tweetsQueue.getWaitingCount();
        const activeCount = await tweetsQueue.getActiveCount();
        const totalRemaining = waitingCount + activeCount;
        
        console.log(`Brain Agent: Queue status - ${waitingCount} waiting, ${activeCount} active`);
        
        if (totalRemaining === 0) {
          console.log('Brain Agent: Queue empty, all jobs processed');
          clearInterval(checkInterval);
          
          if (cmdArgs.exitWhenDone) {
            console.log('Brain Agent: --exit-when-done flag set, closing worker and exiting');
            await worker.close();
            await redisClient.quit();
            process.exit(0);
          }
        }
      } catch (error) {
        console.error('Brain Agent: Error checking queue status:', error);
      }
    }, 1000);
  }

  // Standard signal handlers
  process.on('SIGINT', async () => {
    console.log('Brain Agent: SIGINT received, shutting down worker...');
    await worker.close();
    await redisClient.quit();
    console.log('Brain Agent: Worker shut down.');
    process.exit(0);
  });

  process.on('SIGTERM', async () => {
    console.log('Brain Agent: SIGTERM received, shutting down worker...');
    await worker.close();
    await redisClient.quit();
    console.log('Brain Agent: Worker shut down.');
    process.exit(0);
  });
}

startBrainAgent().catch(error => {
  console.error('Brain Agent: Unhandled error in startup:', error);
  process.exit(1);
}); 