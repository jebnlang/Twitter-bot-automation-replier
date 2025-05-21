import { Worker, Job, Queue } from 'bullmq';
import dotenv from 'dotenv';
import { chromium } from 'playwright-extra';
import { Page } from 'playwright-core';
import stealth from 'puppeteer-extra-plugin-stealth';
import path from 'path'; // For resolving PLAYWRIGHT_STORAGE
// import readline from 'readline'; // readline is no longer used
import Redis from 'ioredis'; // Import IORedis
import { parseCommandLineArgs, logCommandLineArgs } from './cmd-utils';

// Load environment variables
dotenv.config();

// Parse command line args
const cmdArgs = parseCommandLineArgs();
logCommandLineArgs('Poster Agent', cmdArgs);

// Apply the stealth plugin
chromium.use(stealth());

const REDIS_URL = process.env.REDIS_URL;
const PLAYWRIGHT_STORAGE = process.env.PLAYWRIGHT_STORAGE || 'auth.json';
// Default to 60 seconds if not set, for safety, though spec says 1-2s sleep post-tweet.
// POST_RATE_MS is more of a safety throttle for the worker itself.
const POST_RATE_MS = parseInt(process.env.POST_RATE_MS || '60000', 10);

if (!REDIS_URL) {
  console.error('Poster Agent: Error - REDIS_URL is not defined.');
  process.exit(1);
}

// Initialize Redis Client for adding to replied set
const redisClientPoster = new Redis(REDIS_URL, {
  maxRetriesPerRequest: null,
  enableReadyCheck: false,
  family: 0
});
const REPLIED_TWEETS_SET_KEY_POSTER = 'replied_tweet_urls'; // Ensure this matches Brain's key

redisClientPoster.on('error', (err) => console.error('Poster Agent: Redis Client Error', err));

// --- Queue Connection ---
const redisConnectionOptions = {
  host: new URL(REDIS_URL).hostname,
  port: parseInt(new URL(REDIS_URL).port, 10),
  password: new URL(REDIS_URL).password ? decodeURIComponent(new URL(REDIS_URL).password) : undefined,
  db: new URL(REDIS_URL).pathname ? parseInt(new URL(REDIS_URL).pathname.substring(1), 10) : 0,
  family: 0
};

const approvedTweetsQueueName = 'tweets-approved'; // Must match what Brain agent uses

// Get queue instance for checking counts
const approvedTweetsQueue = new Queue(approvedTweetsQueueName, {
  connection: redisConnectionOptions,
});

// Queue for sending log entries
const logEntryQueueName = 'logEntryQueue'; // Must match Logger agent
let logEntryQueue: Queue;

// --- Helper: Create readline interface for user input ---
// function askQuestion(query: string): Promise<string> { // Temporarily remove for direct posting
//   const rl = readline.createInterface({
//     input: process.stdin,
//     output: process.stdout,
//   });
// 
//   return new Promise(resolve => rl.question(query, ans => {
//     rl.close();
//     resolve(ans);
//   }));
// }

// --- Helper: Type with Jitter ---
async function typeWithJitter(page: Page, selector: string, text: string, jitterMs: number = 25) {
  await page.waitForSelector(selector, { state: 'visible' });
  for (const char of text) {
    await page.type(selector, char, { delay: jitterMs + (Math.random() * jitterMs) }); // Add some randomness to jitter
  }
}

// --- Main Worker Logic ---
async function processApprovedTweetJob(job: Job) {
  console.log(`\nPoster Agent: Received job ID ${job.id} for original tweet URL: ${job.data.url}`);
  console.log(`Poster Agent: Original tweet text: "${job.data.originalText || '(Original text not available)'}"`);
  
  let rawDraftedReply = job.data.draftedReply || '';
  console.log(`Poster Agent: Raw drafted reply: "${rawDraftedReply}"`);

  // Clean the reply
  let cleanedReply = rawDraftedReply;
  // 1. Replace em dashes (—) with hyphens (-)
  cleanedReply = cleanedReply.replace(/\u2014/g, '-'); 
  // 2. Remove double quotation marks (")
  cleanedReply = cleanedReply.replace(/"/g, '');
  // Add more cleaning rules here if needed, e.g., for specific smart quotes if they appear
  // For now, single quotes/apostrophes are preserved.

  console.log(`Poster Agent: Cleaned reply for posting: "${cleanedReply}"`);

  // console.log('Poster Agent: Reply approved. Code execution continuing after approval. Proceeding to post...'); // Temporarily removed
  console.log('Poster Agent: Auto-approving and proceeding to post job ID '+job.id+'...'); // New log for auto-approval

  const storageStatePath = path.resolve(PLAYWRIGHT_STORAGE);
  if (!(await import('fs')).existsSync(storageStatePath)) {
    console.error(`Poster Agent: Error - PLAYWRIGHT_STORAGE path ("${storageStatePath}") does not exist. Please run authentication.`);
    // We might want to throw an error here to make the job fail and retry later
    throw new Error('Authentication file not found. Poster cannot proceed.'); 
  }

  const browser = await chromium.launch({ headless: true }); // For debugging
  // const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    storageState: storageStatePath,
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/100.0.4896.127 Safari/537.36',
  });
  const page = await context.newPage();

  try {
    console.log(`Poster Agent: Navigating to tweet: ${job.data.url}`);
    await page.goto(job.data.url, { waitUntil: 'domcontentloaded', timeout: 60000 });
    console.log('Poster Agent: Successfully navigated to tweet page.');
    
    console.log('Poster Agent: Pausing for 5 seconds for initial manual inspection (headless:false)...');
    await page.waitForTimeout(5000); // 5-second pause

    // NEW STEP: Like the tweet before replying - with better error handling
    try {
      console.log('Poster Agent: Attempting to like the tweet...');
      
      // Try multiple selectors to find the like button
      let likeButtonFound = false;
      
      // First try data-testid approach
      try {
        const likeButtonSelector = 'div[data-testid="like"]';
        console.log(`Poster Agent: Looking for like button with selector: ${likeButtonSelector}`);
        const isVisible = await page.isVisible(likeButtonSelector, { timeout: 5000 });
        
        if (isVisible) {
          await page.click(likeButtonSelector);
          likeButtonFound = true;
          console.log('Poster Agent: Clicked like button using data-testid.');
        }
      } catch (err) {
        console.log('Poster Agent: Could not find like button with data-testid selector. Trying alternative method.');
      }
      
      // If first method failed, try finding heart icon by aria-label
      if (!likeButtonFound) {
        try {
          // Look for the heart icon by its aria-label
          const heartIconSelector = '[aria-label*="Like"], [aria-label*="like"]';
          console.log(`Poster Agent: Looking for like button with heart icon selector: ${heartIconSelector}`);
          const isVisible = await page.isVisible(heartIconSelector, { timeout: 5000 });
          
          if (isVisible) {
            await page.click(heartIconSelector);
            likeButtonFound = true;
            console.log('Poster Agent: Clicked like button using heart icon selector.');
          }
        } catch (err) {
          console.log('Poster Agent: Could not find like button with heart icon selector either.');
        }
      }
      
      if (likeButtonFound) {
        // Small pause after liking
        await page.waitForTimeout(1000);
      } else {
        console.log('Poster Agent: Could not find and click the like button. Continuing with reply anyway.');
      }
    } catch (likeError: any) {
      console.log(`Poster Agent: Error while trying to like the tweet: ${likeError.message}. Continuing with reply.`);
    }

    // 1. Click the initial reply icon (speech bubble) to open the reply modal
    const initialReplyIconSelector = 'button[data-testid="reply"]'; // Target the button with this testid
    console.log(`Poster Agent: Looking for initial reply icon (button) with selector: ${initialReplyIconSelector}`);
    await page.waitForSelector(initialReplyIconSelector, { state: 'visible', timeout: 15000 });
    await page.click(initialReplyIconSelector);
    console.log('Poster Agent: Clicked initial reply icon. Modal should be opening.');

    // 2. Type the draft with jitter into the modal's text area
    // This selector should target the text area *inside* the reply modal
    const replyTextAreaSelector = 'div[data-testid="tweetTextarea_0"]'; 
    console.log(`Poster Agent: Looking for reply text area in modal: ${replyTextAreaSelector}`);
    // Wait for the modal's text area to be visible
    await page.waitForSelector(replyTextAreaSelector, { state: 'visible', timeout: 10000 }); 
    console.log('Poster Agent: Reply text area in modal found. Typing with jitter...');
    await typeWithJitter(page, replyTextAreaSelector, cleanedReply, 25);
    console.log('Poster Agent: Finished typing drafted reply in modal.');

    // 3. Click the "Reply" button *within the modal*
    console.log(`Poster Agent: Looking for "Reply" submit button in modal.`);
    // Using getByRole for a more robust selection, looking for a button labeled "Reply".
    // This should now target the button within the opened modal.
    const replySubmitButtonInModal = page.getByRole('button', { name: 'Reply', exact: true });
    
    // Wait for the button to be visible and clickable.
    // It might become enabled only after text is entered.
    await replySubmitButtonInModal.waitFor({ state: 'visible', timeout: 15000 }); 
    // Consider adding a check for `state: 'enabled'` if 'visible' is not enough,
    // but Playwright's click often handles this.
    
    console.log('Poster Agent: "Reply" submit button in modal found. Clicking...');
    await replySubmitButtonInModal.click();
    console.log('Poster Agent: Clicked "Reply" submit button in modal.');

    // 4. Soft-sleep 1-2s (as per spec)
    const softSleepDuration = 1000 + Math.random() * 1000; // 1 to 2 seconds
    console.log(`Poster Agent: Soft sleeping for ${softSleepDuration.toFixed(0)}ms...`);
    await page.waitForTimeout(softSleepDuration);
    console.log('Poster Agent: Reply posted successfully!');

    // Add tweet URL to the replied set in Redis
    const tweetUrlToRecord = job.data.url;
    if (tweetUrlToRecord) {
      try {
        await redisClientPoster.sadd(REPLIED_TWEETS_SET_KEY_POSTER, tweetUrlToRecord);
        console.log(`Poster Agent: Added ${tweetUrlToRecord} to replied tweets set.`);
      } catch (redisError: any) {
        console.error(`Poster Agent: Redis error adding ${tweetUrlToRecord} to replied set. Error: ${redisError.message}`);
      }

      try {
        const logData = {
          timestamp: new Date().toISOString(),
          postUrl: tweetUrlToRecord,
          postContent: job.data.originalText || '',
          replyContent: cleanedReply
        };
        if (!logEntryQueue) { // Initialize if not already done
            logEntryQueue = new Queue(logEntryQueueName, { connection: redisConnectionOptions });
        }
        await logEntryQueue.add('newLogEntry', logData);
        console.log(`Poster Agent: Sent log entry for ${tweetUrlToRecord} to ${logEntryQueueName}.`);
      } catch (queueError: any) {
        console.error(`Poster Agent: Error sending log entry for ${tweetUrlToRecord} to ${logEntryQueueName}. Error: ${queueError.message}`);
      }
    } else {
      console.warn('Poster Agent: Job data did not contain a URL to record as replied.');
    }

    console.log('Poster Agent: Pausing for 20 seconds after successful post...');
    await page.waitForTimeout(20000); 

    // Conditional pause for headless:false (though currently headless:true is set)
    // const isHeadless = browser.browserType().name() === 'chromium' && (await browser.contexts()[0].pages()[0].evaluate(() => !document.hidden));
    // if (isHeadless === false) { 
    //     console.log('Poster Agent: Headless mode is false. Pausing for 5 seconds to observe final state...');
    //     await page.waitForTimeout(5000);
    // }

  } catch (error: any) {
    console.error('Poster Agent: An error occurred during posting operation:');
    console.error(`Poster Agent: Error Message: ${error.message}`);
    console.error(`Poster Agent: Error Stack: ${error.stack}`);
    throw error; 
  } finally {
    console.log('Poster Agent: Closing browser.');
    if (browser && browser.isConnected()) {
      await browser.close();
    }
  }
}

// --- Initialize and Start Worker ---
async function startPosterAgent() {
  // Initialize logEntryQueue here to ensure it's ready before worker starts processing jobs
  if (!logEntryQueue) {
    logEntryQueue = new Queue(logEntryQueueName, { connection: redisConnectionOptions });
  }
  console.log(`Poster Agent: Starting worker, listening to queue: "${approvedTweetsQueueName}"`);
  
  const worker = new Worker(approvedTweetsQueueName, processApprovedTweetJob, {
    connection: redisConnectionOptions,
    limiter: {
      max: 1,
      duration: POST_RATE_MS, 
    },
    concurrency: 1, 
    removeOnComplete: { count: 1000 },
    removeOnFail: { count: 5000 },
    lockDuration: 5 * 60 * 1000, 
  });

  worker.on('completed', (job) => {
    console.log(`Poster Agent: Job ID ${job.id} (Tweet URL: ${job.data.url}) posted successfully.`);
  });

  worker.on('failed', (job, err) => {
    console.error(`Poster Agent: Job ID ${job?.id} (Tweet URL: ${job?.data?.url}) failed to post with error: ${err.message}`);
  });
  
  worker.on('error', err => {
    console.error('Poster Agent: Worker encountered an error:', err);
  });

  console.log('Poster Agent: Worker started.');
  
  // If processAll flag is set, wait for all jobs to be processed
  if (cmdArgs.processAll) {
    console.log('Poster Agent: --process-all flag set, will process all jobs then exit');
    
    // Check queue size every second
    const checkInterval = setInterval(async () => {
      try {
        const waitingCount = await approvedTweetsQueue.getWaitingCount();
        const activeCount = await approvedTweetsQueue.getActiveCount();
        const totalRemaining = waitingCount + activeCount;
        
        console.log(`Poster Agent: Queue status - ${waitingCount} waiting, ${activeCount} active`);
        
        if (totalRemaining === 0) {
          console.log('Poster Agent: Queue empty, all jobs processed');
          clearInterval(checkInterval);
          
          if (cmdArgs.exitWhenDone) {
            console.log('Poster Agent: --exit-when-done flag set, closing worker and exiting');
            await worker.close();
            if (logEntryQueue) {
              await logEntryQueue.close();
            }
            if (redisClientPoster && typeof redisClientPoster.quit === 'function') {
              await redisClientPoster.quit();
            }
            process.exit(0);
          }
        }
      } catch (error) {
        console.error('Poster Agent: Error checking queue status:', error);
      }
    }, 1000);
  }

  const gracefulShutdown = async () => {
    console.log('Poster Agent: SIGINT/SIGTERM received, shutting down worker and queue...');
    await worker.close();
    if (logEntryQueue) {
        await logEntryQueue.close();
    }
    // Consider closing redisClientPoster as well if it has an explicit close method
    if (redisClientPoster && typeof redisClientPoster.quit === 'function') {
        await redisClientPoster.quit();
    }
    console.log('Poster Agent: Worker and queues shut down.');
    process.exit(0);
  };
  process.on('SIGINT', gracefulShutdown);
  process.on('SIGTERM', gracefulShutdown);
}

startPosterAgent().catch(error => {
  console.error('Poster Agent: Unhandled error in startup:', error);
  process.exit(1);
});
