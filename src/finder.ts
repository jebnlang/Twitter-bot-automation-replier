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
let effectiveRedisUrl = process.env.REDIS_URL || process.env.REDIS_PUBLIC_URL; // Use let for potential modification
const PLAYWRIGHT_STORAGE = process.env.PLAYWRIGHT_STORAGE || 'auth.json';

// Validate critical environment variables
if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
  console.error('Finder Agent: Error - SUPABASE_URL or SUPABASE_ANON_KEY is not defined. Please set them in your .env file.');
  process.exit(1);
}
if (!effectiveRedisUrl) {
  console.error('Finder Agent: Error - REDIS_URL is not defined in the environment variables.');
  process.exit(1);
}

// Ensure family=0 is in the URL string for Railway internal URLs
try {
  const tempUrl = new URL(effectiveRedisUrl);
  if (tempUrl.hostname === 'redis.railway.internal' && !tempUrl.searchParams.has('family')) {
    if (tempUrl.search) { // if there are already query params
      effectiveRedisUrl += '&family=0';
    } else {
      effectiveRedisUrl += '?family=0';
    }
    console.log(`[Finder Agent] Modified Railway Redis URL to include family=0: ${effectiveRedisUrl}`);
  }
} catch (e) {
  console.warn('[Finder Agent] Could not parse effectiveRedisUrl to check for family=0 modification:', e);
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

const redisUrl = new URL(effectiveRedisUrl); // Use the potentially modified URL
const redisConnectionOptions = {
  host: redisUrl.hostname,
  port: parseInt(redisUrl.port, 10),
  password: redisUrl.password ? decodeURIComponent(redisUrl.password) : undefined,
  username: redisUrl.username ? decodeURIComponent(redisUrl.username) : undefined,
  db: redisUrl.pathname ? parseInt(redisUrl.pathname.substring(1), 10) : 0, // BullMQ expects a number for db
  family: 0, // Enable dual-stack IPv4/IPv6 support - critical for Railway
  connectTimeout: 10000, // Increased timeout
  tls: redisUrl.protocol === 'rediss:' ? {} : undefined,
};

// Define the tweets queue
const tweetsQueueName = 'tweets'; // Define name for clarity
const tweetsQueue = new Queue(tweetsQueueName, {
  connection: redisConnectionOptions,
});

// Define the approved tweets queue (for clearing purposes)
const approvedTweetsQueueName = 'tweets-approved';
const approvedTweetsQueue = new Queue(approvedTweetsQueueName, {
  connection: redisConnectionOptions,
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

// Helper function to parse engagement numbers (likes, retweets, replies)
function parseEngagementNumber(numString: string): number {
  if (!numString) return 0;
  
  let numStr = numString.replace(/,/g, ''); // Remove commas
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
    
    // Additional wait for Railway environment - let the page fully load
    console.log('Finder Agent: Waiting 10 seconds for page to fully load (Railway timing fix)...');
    await page.waitForTimeout(10000);
    
    // Wait for any tweets to appear before proceeding
    try {
      await page.waitForSelector('article[data-testid="tweet"], article, [data-testid="cellInnerDiv"]', { 
        timeout: 10000,
        state: 'visible'
      });
      console.log('Finder Agent: Tweet elements detected on page.');
    } catch (waitError: any) {
      console.log('Finder Agent: No tweet elements detected after waiting. Proceeding anyway...');
    }

    // Update the timestamp for the used topic
    await updateTopicTimestamp(currentTopicId);

    // The rest of the logic (scrolling, finding tweets, parsing, enqueuing) remains largely the same.
    // It will operate on the search results page.
    console.log('Finder Agent: Proceeding with scrolling and tweet extraction...');
    await scrollPage(page, 3, 2500); // Scroll 3 times, 2.5s delay

    // Additional wait after scrolling for Railway environment
    console.log('Finder Agent: Waiting additional 5 seconds after scrolling for content to load...');
    await page.waitForTimeout(5000);

    console.log(`Finder Agent: Looking for tweets with at least ${VIEW_THRESHOLD} views.`);
    const potentialTweets: { url: string; textContent: string; views: number; likes: number; retweets: number; replies: number }[] = [];

    const tweetArticles = await page.locator('article[data-testid="tweet"]').all();
    console.log(`Finder Agent: Found ${tweetArticles.length} potential tweet articles after scrolling.`);

    // DIAGNOSTIC: If no tweets found, let's debug what's on the page
    if (tweetArticles.length === 0) {
      console.log('Finder Agent: DIAGNOSTIC - No tweet articles found. Investigating page content...');
      
      // Take a screenshot for debugging
      try {
        await page.screenshot({ path: 'debug-no-tweets.png', fullPage: true });
        console.log('Finder Agent: DIAGNOSTIC - Screenshot saved as debug-no-tweets.png');
      } catch (screenshotError: any) {
        console.log('Finder Agent: DIAGNOSTIC - Could not take screenshot:', screenshotError.message);
      }
      
      // Check if we're on the right page
      const currentUrl = page.url();
      console.log(`Finder Agent: DIAGNOSTIC - Current URL: ${currentUrl}`);
      
      // Check page title
      const pageTitle = await page.title();
      console.log(`Finder Agent: DIAGNOSTIC - Page title: ${pageTitle}`);
      
      // Look for any error messages or login prompts
      const errorMessages = await page.locator('text=/error|Error|login|Login|sign in|Sign in/i').all();
      if (errorMessages.length > 0) {
        console.log(`Finder Agent: DIAGNOSTIC - Found ${errorMessages.length} potential error/login messages`);
        for (let i = 0; i < Math.min(errorMessages.length, 3); i++) {
          const text = await errorMessages[i].innerText();
          console.log(`Finder Agent: DIAGNOSTIC - Message ${i + 1}: "${text}"`);
        }
      }
      
      // Check for alternative tweet selectors
      const alternativeSelectors = [
        'article',
        '[data-testid*="tweet"]',
        '[role="article"]',
        '.tweet',
        '[data-testid="cellInnerDiv"]'
      ];
      
      for (const selector of alternativeSelectors) {
        const elements = await page.locator(selector).all();
        console.log(`Finder Agent: DIAGNOSTIC - Found ${elements.length} elements with selector: ${selector}`);
      }
      
      // Log some page content
      const bodyText = await page.locator('body').innerText();
      const truncatedBody = bodyText.substring(0, 500);
      console.log(`Finder Agent: DIAGNOSTIC - Page body (first 500 chars): ${truncatedBody}`);
    }

    for (const article of tweetArticles) {
      try {
        // Extract tweet URL from the time link
        let tweetUrl: string | null = null;
        const timeLinkLocator = article.locator('a:has(time[datetime])');
        if (await timeLinkLocator.count() > 0) {
          const href = await timeLinkLocator.first().getAttribute('href');
          if (href && href.includes('/status/')) {
            tweetUrl = `https://x.com${href}`;
          }
        }

        // Extract tweet text content
        let textContent: string = '';
        const tweetTextDiv = article.locator('div[data-testid="tweetText"]');
        if (await tweetTextDiv.count() > 0) {
          textContent = await tweetTextDiv.first().innerText();
        }

        // Extract engagement metrics (likes, retweets, replies)
        let likes = 0;
        let retweets = 0;
        let replies = 0;
        let views = 0;

        // Try to get likes count
        const likeButton = article.locator('[data-testid="like"]');
        if (await likeButton.count() > 0) {
          const likeText = await likeButton.first().getAttribute('aria-label');
          if (likeText) {
            const likeMatch = likeText.match(/(\d+(?:,\d+)*(?:\.\d+)?[KM]?)/);
            if (likeMatch) {
              likes = parseEngagementNumber(likeMatch[1]);
            }
          }
        }

        // Try to get retweet count
        const retweetButton = article.locator('[data-testid="retweet"]');
        if (await retweetButton.count() > 0) {
          const retweetText = await retweetButton.first().getAttribute('aria-label');
          if (retweetText) {
            const retweetMatch = retweetText.match(/(\d+(?:,\d+)*(?:\.\d+)?[KM]?)/);
            if (retweetMatch) {
              retweets = parseEngagementNumber(retweetMatch[1]);
            }
          }
        }

        // Try to get reply count
        const replyButton = article.locator('[data-testid="reply"]');
        if (await replyButton.count() > 0) {
          const replyText = await replyButton.first().getAttribute('aria-label');
          if (replyText) {
            const replyMatch = replyText.match(/(\d+(?:,\d+)*(?:\.\d+)?[KM]?)/);
            if (replyMatch) {
              replies = parseEngagementNumber(replyMatch[1]);
            }
          }
        }

        // Try to get views count from analytics link or view text
        const viewsElements = await article.locator('a[href*="/analytics"], span:has-text("views"), span:has-text("view")').all();
        for (const viewElement of viewsElements) {
          const viewText = await viewElement.innerText();
          if (viewText && viewText.toLowerCase().includes('view')) {
            views = parseViews(viewText);
            if (views > 0) break;
          }
        }

        // Log detailed parsing info for debugging
        console.log(`Finder Agent: Parsed tweet - URL: ${tweetUrl ? 'found' : 'missing'}, Text: ${textContent.length} chars, Likes: ${likes}, Retweets: ${retweets}, Replies: ${replies}, Views: ${views}`);

        // Check if tweet meets our criteria
        // Since we're already filtering by min_faves in the search, we should accept tweets with the minimum likes
        // Use likes count instead of views for filtering since that's what we're searching for
        const meetsLikesThreshold = likes >= FINDER_SEARCH_MIN_FAVES;
        
        // Only apply view threshold if it's greater than 0, otherwise ignore view criterion
        const meetsViewsThreshold = VIEW_THRESHOLD > 0 ? views >= VIEW_THRESHOLD : true;
        
        if (tweetUrl && textContent && (meetsLikesThreshold || meetsViewsThreshold)) {
          if (potentialTweets.length < MAX_REPLIES_PER_RUN) {
            potentialTweets.push({ 
              url: tweetUrl, 
              textContent: textContent, 
              views: views,
              likes: likes,
              retweets: retweets,
              replies: replies
            });
            console.log(`Finder Agent: Added potential tweet: ${tweetUrl} (Likes: ${likes}, Views: ${views})`);
          } else {
            console.log('Finder Agent: MAX_REPLIES_PER_RUN reached, not adding more tweets this scan.');
            break; // Exit the loop once max replies are found
          }
        } else {
          const viewCriterion = VIEW_THRESHOLD > 0 ? `Views: ${views}/${VIEW_THRESHOLD}` : 'Views: ignored (threshold=0)';
          console.log(`Finder Agent: Tweet skipped - URL: ${!!tweetUrl}, Text: ${!!textContent}, Likes: ${likes}/${FINDER_SEARCH_MIN_FAVES}, ${viewCriterion}`);
        }
      } catch (error: any) {
        console.warn(`Finder Agent: Error parsing one tweet article: ${error.message}. Skipping it.`);
      }
    }

    console.log(`Finder Agent: Found ${potentialTweets.length} tweets meeting criteria (≥${VIEW_THRESHOLD} views) out of ${tweetArticles.length} parsed.`);

    let enqueuedCount = 0;
    for (const tweet of potentialTweets) {
      try {
        await tweetsQueue.add('tweet', { 
          url: tweet.url, 
          originalText: tweet.textContent, 
          views: tweet.views,
          likes: tweet.likes,
          retweets: tweet.retweets,
          replies: tweet.replies
        });
        console.log(`Finder Agent: Enqueued tweet ${tweet.url} (Likes: ${tweet.likes}, Views: ${tweet.views})`);
        enqueuedCount++;
        if (enqueuedCount >= MAX_REPLIES_PER_RUN) {
          console.log(`Finder Agent: Reached MAX_REPLIES_PER_RUN limit (${MAX_REPLIES_PER_RUN}). Stopping Finder scan further.`);
          break;
        }
      } catch (queueError: any) {
        console.error(`Finder Agent: Error enqueuing tweet ${tweet.url}: ${queueError.message}`);
      }
    }
    console.log(`Finder Agent: Scan finished. ${enqueuedCount} tweets enqueued.`);

  } catch (error: any) {
    console.error('Finder Agent: An error occurred during the main scan process:', error.message);
    // Optionally, rethrow or handle more gracefully
  } finally {
    console.log('Finder Agent: Closing browser.');
    if (browser && browser.isConnected()) {
        await browser.close();
    }
  }
  
  if (cmdArgs.exitWhenDone) {
      console.log('Finder Agent: --exit-when-done flag set, exiting process');
      process.exit(0);
  }
}

main().catch(error => {
  console.error('Finder Agent: Unhandled error in main function:', error);
  process.exit(1);
});