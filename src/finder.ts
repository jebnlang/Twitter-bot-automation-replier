import { chromium } from 'playwright-extra';
import stealth from 'puppeteer-extra-plugin-stealth';
import { Queue } from 'bullmq';
import dotenv from 'dotenv';

// Load environment variables from .env file
dotenv.config();

// Apply the stealth plugin to Playwright Chromium
chromium.use(stealth());

// --- CONFIGURATION ---
// Search mode is controlled by the FINDER_SEARCH_MODE environment variable (e.g., 'HOME' or 'COMMUNITIES')
const SEARCH_MODE: 'HOME' | 'COMMUNITIES' = (process.env.FINDER_SEARCH_MODE === 'COMMUNITIES' ? 'COMMUNITIES' : 'HOME');
// Target community URL is controlled by the FINDER_TARGET_COMMUNITY_URL environment variable
const TARGET_COMMUNITY_URL = process.env.FINDER_TARGET_COMMUNITY_URL || 'https://x.com/GetTeleprompt/communities'; // Default if not set

const VIEW_THRESHOLD = parseInt(process.env.VIEW_THRESHOLD || '5000', 10);
const MAX_REPLIES_PER_RUN = parseInt(process.env.MAX_REPLIES_PER_RUN || '10', 10);
const REDIS_URL = process.env.REDIS_URL;
const PLAYWRIGHT_STORAGE = process.env.PLAYWRIGHT_STORAGE || 'auth.json';

if (!REDIS_URL) {
  console.error('Error: REDIS_URL is not defined in the environment variables.');
  process.exit(1);
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
  const browser = await chromium.launch({ headless: false });
  const context = await browser.newContext({
    storageState: PLAYWRIGHT_STORAGE,
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/100.0.4896.127 Safari/537.36',
    // Consider adding viewport settings if needed for consistent page layout
    // viewport: { width: 1280, height: 800 }
  });
  const page = await context.newPage();

  try {
    if (SEARCH_MODE === 'HOME') {
      console.log('Finder Agent: SEARCH_MODE is HOME. Navigating to Twitter home...');
      await page.goto('https://twitter.com/home', { waitUntil: 'domcontentloaded', timeout: 60000 });
      console.log('Finder Agent: Successfully navigated to home timeline.');
    } else if (SEARCH_MODE === 'COMMUNITIES') {
      if (!TARGET_COMMUNITY_URL) {
        console.error('Finder Agent: SEARCH_MODE is COMMUNITIES, but TARGET_COMMUNITY_URL is not set. Please set it.');
        process.exit(1);
      }
      console.log(`Finder Agent: SEARCH_MODE is COMMUNITIES. Navigating to target community URL: ${TARGET_COMMUNITY_URL}`);
      await page.goto(TARGET_COMMUNITY_URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
      console.log('Finder Agent: Successfully navigated to target community page.');
      // Wait for a bit for the community page/feed to load and settle.
      await page.waitForTimeout(3000); // Wait 3 seconds for content to load
    } else {
      console.error(`Finder Agent: Invalid SEARCH_MODE "${SEARCH_MODE}". Exiting.`);
      process.exit(1);
    }

    // The rest of the logic (scrolling, finding tweets, parsing, enqueuing) remains the same.
    // It will operate on whatever page (home timeline or communities feed) is currently loaded.
    console.log('Finder Agent: Proceeding with scrolling and tweet extraction...');
    await scrollPage(page, 3, 2500); // Scroll 3 times, 2.5s delay

    console.log(`Finder Agent: Looking for tweets with at least ${VIEW_THRESHOLD} views.`);
    const potentialTweets: { url: string; textContent: string; views: number }[] = [];

    const tweetArticles = await page.locator('article[data-testid="tweet"]').all();
    console.log(`Finder Agent: Found ${tweetArticles.length} potential tweet articles after scrolling.`);

    for (const article of tweetArticles) {
      try {
        console.log('\nFinder Agent: Processing a new tweet article...'); // Log start of processing an article
        let tweetUrl: string | null = null;
        // Prioritize link with a time element for permalink
        const timeLinkLocator = article.locator('a:has(time[datetime])');
        if (await timeLinkLocator.count() > 0) {
            const href = await timeLinkLocator.first().getAttribute('href');
            if (href && href.includes('/status/')) {
                tweetUrl = `https://twitter.com${href}`;
            }
        }
        console.log(`Finder Agent: Extracted timeLink-based URL: ${tweetUrl}`);
        
        // Fallback if no time link found, try other status links within the article
        // Be careful not to pick links to quoted tweets if they also use 'article' tag
        if (!tweetUrl) {
            const statusLinks = article.locator('a[href*="/status/"]');
            const count = await statusLinks.count();
            for (let i = 0; i < count; i++) {
                const link = statusLinks.nth(i);
                const href = await link.getAttribute('href');
                if (href && href.match(/^\/[^/]+\/status\/\d+$/)) {
                    const isInsideQuote = await link.locator('xpath=ancestor::div[div[1]//article[@data-testid="tweet"]]').count() > 0;
                    if (!isInsideQuote) {
                        tweetUrl = `https://twitter.com${href}`;
                        console.log(`Finder Agent: Extracted fallback URL: ${tweetUrl}`);
                        break; 
                    }
                }
            }
        }
        if (!tweetUrl) console.log('Finder Agent: Failed to extract tweet URL for this article.');

        const tweetTextElement = article.locator('div[data-testid="tweetText"]');
        const textContent = await tweetTextElement.count() > 0 ? (await tweetTextElement.first().textContent() || '').trim() : '';
        console.log(`Finder Agent: Extracted text content (first 50 chars): "${textContent.substring(0, 50)}..."`);

        const viewCountLocator = article.locator('[aria-label$=" views"], [aria-label$=" View"]');
        let rawAriaLabel: string | null = null;
        let views = 0;
        if (await viewCountLocator.count() > 0) {
          rawAriaLabel = await viewCountLocator.first().getAttribute('aria-label');
          console.log(`Finder Agent: Raw aria-label for views: "${rawAriaLabel}"`);
          views = parseViews(rawAriaLabel);
        } else {
          console.log('Finder Agent: View count element not found for this article.');
        }
        console.log(`Finder Agent: Parsed views: ${views}`);

        if (tweetUrl && textContent) { 
          potentialTweets.push({ url: tweetUrl, textContent, views });
          console.log(`Finder Agent: Added to potentialTweets: URL: ${tweetUrl}, Views: ${views}`);
        } else {
          console.log('Finder Agent: Skipped adding to potentialTweets due to missing URL or text.');
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
      
      // --- Stop after enqueuing up to MAX_REPLIES_PER_RUN tweets ---
      if (tweetsEnqueued >= MAX_REPLIES_PER_RUN) {
        console.log(`Finder Agent: Reached MAX_REPLIES_PER_RUN limit (${MAX_REPLIES_PER_RUN}). Stopping Finder scan further.`);
        break; 
      }
      // --- End of enqueuing limit logic ---
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
}); 