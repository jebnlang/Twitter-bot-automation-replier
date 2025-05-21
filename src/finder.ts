import { chromium } from 'playwright-extra';
import stealth from 'puppeteer-extra-plugin-stealth';
import { Queue } from 'bullmq';
import dotenv from 'dotenv';
import path from 'path';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { parseCommandLineArgs, logCommandLineArgs } from './cmd-utils';

// Load environment variables from .env file
dotenv.config();

// DEBUG: Check if .env variables are loaded
console.log('Finder Agent DEBUG: SUPABASE_URL from env:', process.env.SUPABASE_URL);
console.log('Finder Agent DEBUG: SUPABASE_ANON_KEY from env:', process.env.SUPABASE_ANON_KEY);

// Parse command line args
const cmdArgs = parseCommandLineArgs();
logCommandLineArgs('Finder Agent', cmdArgs);

// Apply the stealth plugin to Playwright Chromium
chromium.use(stealth());

// --- CONFIGURATION ---
// Supabase Configuration
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;

// Search and Interaction Configuration
const VIEW_THRESHOLD = parseInt(process.env.VIEW_THRESHOLD || '1500', 10);
const MAX_REPLIES_PER_RUN = cmdArgs.maxReplies;
const FINDER_SEARCH_MIN_FAVES = parseInt(process.env.FINDER_SEARCH_MIN_FAVES || '25', 10);

// Redis and Playwright Configuration
const REDIS_URL = process.env.REDIS_URL;
const PLAYWRIGHT_STORAGE = process.env.PLAYWRIGHT_STORAGE || 'auth.json';

// Validate critical environment variables
if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
  console.error('Finder Agent: Error - SUPABASE_URL or SUPABASE_ANON_KEY is not defined. Please set them in your .env file.');
  process.exit(1);
}
if (!REDIS_URL) {
  console.error('Finder Agent: Error - REDIS_URL is not defined in the environment variables.');
  process.exit(1);
}

// Initialize Supabase Client
let supabase: SupabaseClient | null = null;
try {
  supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
  console.log('Finder Agent: Supabase client initialized successfully.');
} catch (error) {
  console.error('Finder Agent: Error initializing Supabase client:', error);
  supabase = null; // Ensure supabase is null if initialization fails
  // Decide if we should exit or try to continue without Supabase, for now, we'll let it try to run getNextSearchTopic
}

const redisUrl = new URL(REDIS_URL);

// Define the tweets queue
const tweetsQueueName = 'tweets'; // Define name for clarity
const tweetsQueue = new Queue(tweetsQueueName, {
  connection: {
    host: redisUrl.hostname,
    port: parseInt(redisUrl.port, 10),
    password: redisUrl.password ? decodeURIComponent(redisUrl.password) : undefined,
    db: redisUrl.pathname ? parseInt(redisUrl.pathname.substring(1), 10) : 0, // BullMQ expects a number for db
    family: 0, // Enable dual-stack IPv4/IPv6 support - critical for Railway
  },
});

// Define the approved tweets queue (for clearing purposes)
const approvedTweetsQueueName = 'tweets-approved';
const approvedTweetsQueue = new Queue(approvedTweetsQueueName, {
  connection: {
    host: redisUrl.hostname,
    port: parseInt(redisUrl.port, 10),
    password: redisUrl.password ? decodeURIComponent(redisUrl.password) : undefined,
    db: redisUrl.pathname ? parseInt(redisUrl.pathname.substring(1), 10) : 0,
    family: 0, // Enable dual-stack IPv4/IPv6 support - critical for Railway
  },
});

// Helper function to scroll the page
async function scrollPage(page: import('playwright-core').Page, scrolls: number = 3, delay: number = 2000) {
  console.log('Finder Agent: Scrolling page to load more tweets...');
  try {
    for (let i = 0; i < scrolls; i++) {
      await page.evaluate(() => window.scrollBy(0, window.innerHeight * 2)); // Scroll by two viewport heights
      await page.waitForTimeout(delay); // Wait for content to load
      console.log(`Finder Agent: Scrolled ${i + 1}/${scrolls}`);
    }
  } catch (error: any) {
    console.warn('Finder Agent: Warning during scroll:', error.message);
  }
}

// Helper function to parse view counts
function parseViews(viewString: string | null): number {
  if (!viewString) return 0;

  // Regex to find a number (possibly with commas, K, or M) followed by "view" or "views"
  // It captures the numeric part including K/M.
  // Example: "1,234 views", "10.5K views", "2M views", "38976 views" in "..., 38976 views"
  const match = viewString.match(/([\d,.]+[KM]?)\s*views?/i); // Case-insensitive search for " views" or " view"

  if (match && match[1]) {
    let numStr = match[1].replace(/,/g, ''); // Remove commas
    let number = 0;
    if (numStr.toUpperCase().endsWith('K')) {
      number = parseFloat(numStr.substring(0, numStr.length - 1)) * 1000;
    } else if (numStr.toUpperCase().endsWith('M')) {
      number = parseFloat(numStr.substring(0, numStr.length - 1)) * 1000000;
    } else {
      number = parseFloat(numStr);
    }
    return isNaN(number) ? 0 : number;
  }
  return 0; // Return 0 if no match is found
}

async function getNextSearchTopic(): Promise<{ id: any; topic_name: string } | null> {
  if (!supabase) {
    console.error('Finder Agent: Supabase client is not initialized. Cannot fetch search topic.');
    return null;
  }
  try {
    console.log('Finder Agent: Fetching next search topic from Supabase...');
    const { data, error } = await supabase
      .from('search_topics')
      .select('id, topic, last_used_at_replies')
      .order('last_used_at_replies', { ascending: true, nullsFirst: true })
      .limit(1)
      .single();

    if (error) {
      console.error('Finder Agent: Error fetching search topic from Supabase:', error.message);
      return null;
    }

    if (data) {
      console.log(`Finder Agent: Fetched topic: "${data.topic}" (ID: ${data.id})`);
      return { id: data.id, topic_name: data.topic };
    } else {
      console.log('Finder Agent: No search topics found in Supabase.');
      return null;
    }
  } catch (err) {
    console.error('Finder Agent: Exception while fetching search topic:', err);
    return null;
  }
}

async function updateTopicTimestamp(topicId: any): Promise<void> {
  if (!supabase) {
    console.error('Finder Agent: Supabase client is not initialized. Cannot update topic timestamp.');
    return;
  }
  try {
    const { error } = await supabase
      .from('search_topics')
      .update({ last_used_at_replies: new Date().toISOString() })
      .eq('id', topicId);

    if (error) {
      console.error(`Finder Agent: Error updating timestamp for topic ID ${topicId}:`, error.message);
    } else {
      console.log(`Finder Agent: Successfully updated timestamp for topic ID ${topicId}.`);
    }
  } catch (err) {
    console.error(`Finder Agent: Exception while updating timestamp for topic ID ${topicId}:`, err);
  }
}

async function main() {
  console.log('Finder Agent: Starting scan...');

  // --- Add 2-second delay ---
  try {
    console.log('Finder Agent: Waiting for 2 seconds before proceeding...');
    await new Promise(resolve => setTimeout(resolve, 2000));
    console.log('Finder Agent: Wait finished. Proceeding with scan.');
  } catch (error) {
    // This catch block is mostly for completeness; setTimeout within a Promise rarely throws.
    console.error('Finder Agent: Error during delay:', error);
  }
  // --- End of delay ---

  if (!PLAYWRIGHT_STORAGE || !(await import('fs')).existsSync(PLAYWRIGHT_STORAGE)) {
    console.error(`Error: PLAYWRIGHT_STORAGE path ("${PLAYWRIGHT_STORAGE}") is not defined or auth.json does not exist. Please run authentication.`);
    process.exit(1);
  }

  // const browser = await chromium.launch({ headless: false }); // For debugging
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    storageState: PLAYWRIGHT_STORAGE,
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/100.0.4896.127 Safari/537.36',
    // Consider adding viewport settings if needed for consistent page layout
    // viewport: { width: 1280, height: 800 }
  });
  const page = await context.newPage();

  try {
    const topicResult = await getNextSearchTopic();

    if (!topicResult) {
      console.error('Finder Agent: No search topic fetched from Supabase. Skipping scan.');
      if (browser && browser.isConnected()) {
          await browser.close();
      }
      return;
    }

    const currentTopic = topicResult.topic_name;
    const currentTopicId = topicResult.id;

    // Construct the search query
    const searchQuery = `${currentTopic} min_faves:${FINDER_SEARCH_MIN_FAVES}`;
    const encodedSearchQuery = encodeURIComponent(searchQuery);
    const searchUrl = `https://x.com/search?q=${encodedSearchQuery}&f=live&src=typed_query`;

    console.log(`Finder Agent: Constructed search URL: ${searchUrl}`);

    console.log(`Finder Agent: Navigating to X.com search results for topic: "${currentTopic}"`);
    await page.goto(searchUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });
    console.log('Finder Agent: Successfully navigated to search results page.');
    
    // Update the timestamp for the used topic
    await updateTopicTimestamp(currentTopicId);

    // The rest of the logic (scrolling, finding tweets, parsing, enqueuing) remains largely the same.
    // It will operate on the search results page.
    console.log('Finder Agent: Proceeding with scrolling and tweet extraction...');
    await scrollPage(page, 3, 2500); // Scroll 3 times, 2.5s delay

    console.log(`Finder Agent: Looking for tweets with at least ${VIEW_THRESHOLD} views.`);
    const potentialTweets: { url: string; textContent: string; views: number }[] = [];

    const tweetArticles = await page.locator('article[data-testid="tweet"]').all();
    console.log(`Finder Agent: Found ${tweetArticles.length} potential tweet articles after scrolling.`);

    for (const article of tweetArticles) {
      try {
        // ... [Existing tweet parsing logic will go here] ...
        // For now, let's assume it correctly populates tweetUrl, textContent, views
        let tweetUrl: string | null = "dummy_url"; // Placeholder
        let textContent: string = "dummy_text"; // Placeholder
        let views: number = 0; // Placeholder

        // Simplified extraction for now to avoid further errors with truncated code
        const timeLinkLocator = article.locator('a:has(time[datetime])');
        if (await timeLinkLocator.count() > 0) {
            const href = await timeLinkLocator.first().getAttribute('href');
            if (href && href.includes('/status/')) {
                tweetUrl = `https://twitter.com${href}`;
            }
        }
        const tweetTextElement = article.locator('div[data-testid="tweetText"]');
        textContent = await tweetTextElement.count() > 0 ? (await tweetTextElement.first().textContent() || '').trim() : '';
        const viewCountLocator = article.locator('[aria-label$=" views"], [aria-label$=" View"]');
        if (await viewCountLocator.count() > 0) {
          const rawAriaLabel = await viewCountLocator.first().getAttribute('aria-label');
          views = parseViews(rawAriaLabel);
        }

        if (tweetUrl && textContent) { 
          potentialTweets.push({ url: tweetUrl, textContent, views });
        } else {
          // console.log('Finder Agent: Skipped adding to potentialTweets due to missing URL or text.');
        }
      } catch (e: any) {
        console.warn('Finder Agent: Error parsing an individual tweet article:', e.message);
      }
    }

    const popularTweets = potentialTweets
      .filter(tweet => tweet.views >= VIEW_THRESHOLD)
      .sort((a, b) => b.views - a.views); // Sort by views descending

    console.log(`Finder Agent: Found ${popularTweets.length} tweets meeting criteria (≥${VIEW_THRESHOLD} views) out of ${potentialTweets.length} parsed.`);

    let tweetsEnqueued = 0;
    for (const tweet of popularTweets) {
      await tweetsQueue.add('newTweet', { url: tweet.url, originalText: tweet.textContent, views: tweet.views });
      tweetsEnqueued++;
      console.log(`Finder Agent: Enqueued tweet ${tweet.url} (Views: ${tweet.views})`);
      
      if (tweetsEnqueued >= MAX_REPLIES_PER_RUN) {
        console.log(`Finder Agent: Reached MAX_REPLIES_PER_RUN limit (${MAX_REPLIES_PER_RUN}). Stopping Finder scan further.`);
        break; 
      }
    }

    console.log(`Finder Agent: Scan finished. ${tweetsEnqueued} tweets enqueued.`);

  } catch (error: any) {
    console.error('Finder Agent: An error occurred in main execution:', error.message ? error.message : error);
     if (error.message && (error.message.includes('Target page, context or browser has been closed') || error.message.includes('Protocol error'))) {
        console.error('Finder Agent: This might be due to a CAPTCHA, login issue, or network interruption. Consider re-generating auth.json or checking the browser view (set headless:false).');
    }
  } finally {
    console.log('Finder Agent: Closing browser.');
    if (browser && browser.isConnected()) {
        await browser.close();
    }
  }
}

main().catch(error => {
  console.error('Finder Agent: Unhandled error in main execution:', error);
  process.exit(1);
}).finally(() => {
  if (cmdArgs.exitWhenDone) {
    console.log('Finder Agent: --exit-when-done flag set, exiting process');
    process.exit(0);
  }
});