import { chromium } from 'playwright-extra';
import { Page } from 'playwright-core';
import stealth from 'puppeteer-extra-plugin-stealth';
import { OpenAI } from 'openai';
import dotenv from 'dotenv';
import fs from 'fs/promises';
import path from 'path';

// Load environment variables
dotenv.config();
chromium.use(stealth());

// --- Environment Variables ---
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const PLAYWRIGHT_STORAGE = process.env.PLAYWRIGHT_STORAGE || 'auth.json';
const POST_WRITER_PERSONA_FILENAME = process.env.BRAIN_PERSONA_FILENAME || 'persona_2.md';
const POST_WRITER_CSV_LOG_FILE = process.env.POST_WRITER_CSV_LOG_FILE || 'created_posts_log.csv'; // Default CSV log filename
const HEADLESS_MODE = process.env.POST_WRITER_HEADLESS_MODE !== 'false'; // Default to true (headless)

// --- Basic Validations ---
if (!OPENAI_API_KEY) {
  console.error('Post Writer Agent: Error - OPENAI_API_KEY is not defined. Please set it in your .env file.');
  process.exit(1);
}
if (!PLAYWRIGHT_STORAGE || !(require('fs')).existsSync(PLAYWRIGHT_STORAGE)) { // Synchronous check for startup
    console.error(`Post Writer Agent: Error - PLAYWRIGHT_STORAGE path ("${PLAYWRIGHT_STORAGE}") is not defined or auth.json does not exist. Please run authentication.`);
    process.exit(1);
}

// --- OpenAI Client ---
const openai = new OpenAI({
  apiKey: OPENAI_API_KEY,
});

// --- Helper: Type with Jitter (copied from poster.ts) ---
async function typeWithJitter(page: Page, selector: string, text: string, jitterMs: number = 25) {
  await page.waitForSelector(selector, { state: 'visible' });
  for (const char of text) {
    await page.type(selector, char, { delay: jitterMs + (Math.random() * jitterMs) }); // Add some randomness to jitter
  }
}

// --- Persona ---
let postWriterPersonaContent: string = 'Default Post Writer Persona: Create an engaging and informative tweet.'; // Fallback

async function loadPostWriterPersona(): Promise<void> {
  const personaFilePath = path.resolve(POST_WRITER_PERSONA_FILENAME);
  try {
    console.log(`Post Writer Agent: Loading persona from ${personaFilePath}`);
    postWriterPersonaContent = await fs.readFile(personaFilePath, 'utf8');
    console.log('Post Writer Agent: Persona loaded successfully.');
  } catch (error) {
    console.error(`Post Writer Agent: Error loading persona file from ${personaFilePath}. Using fallback persona.`, error);
  }
}

// --- CSV Log Handling ---
const CSV_FILE_PATH = path.resolve(POST_WRITER_CSV_LOG_FILE);

interface PostLogEntry {
  timestamp: string;
  postedText: string;
  postUrl?: string;
}

async function loadPreviousPosts(): Promise<PostLogEntry[]> {
  try {
    await fs.access(CSV_FILE_PATH); // Check if file exists
    const data = await fs.readFile(CSV_FILE_PATH, 'utf8');
    const lines = data.split('\n').filter(line => line.trim() !== '');
    if (lines.length <= 1) return []; // Only header or empty

    const posts: PostLogEntry[] = [];
    // Skip header line by starting i from 1
    for (let i = 1; i < lines.length; i++) {
        const [timestamp, postedText, postUrl] = lines[i].split('","').map(field => field.replace(/^"|"$/g, '')); // Basic CSV parsing
        if (timestamp && postedText) {
            posts.push({ timestamp, postedText, postUrl });
        }
    }
    console.log(`Post Writer Agent: Loaded ${posts.length} previous posts from ${CSV_FILE_PATH}.`);
    return posts;
  } catch (error:any) {
    if (error.code === 'ENOENT') {
      console.log(`Post Writer Agent: Log file ${CSV_FILE_PATH} not found. Assuming no previous posts.`);
      // Create the file with headers if it doesn't exist
      await fs.writeFile(CSV_FILE_PATH, '"timestamp","postedText","postUrl"\n');
      console.log(`Post Writer Agent: Created log file ${CSV_FILE_PATH} with headers.`);
      return [];
    }
    console.error('Post Writer Agent: Error loading previous posts:', error);
    return []; // Return empty array on other errors
  }
}

async function appendPostToLog(newPost: PostLogEntry): Promise<void> {
  const csvLine = `"${newPost.timestamp}","${newPost.postedText.replace(/"/g, '""')}","${newPost.postUrl || ''}"\n`;
  try {
    await fs.appendFile(CSV_FILE_PATH, csvLine);
    console.log(`Post Writer Agent: Successfully appended new post to ${CSV_FILE_PATH}`);
  } catch (error) {
    console.error('Post Writer Agent: Error appending post to log:', error);
  }
}

// --- OpenAI Content Generation ---
async function generateNewPost(persona: string, previousPostTexts: string[]): Promise<string | null> {
  console.log('Post Writer Agent: Generating new post content with OpenAI...');
  let promptContent = `Your primary goal is to embody the following Twitter persona. Adhere to it strictly.
--- PERSONA START ---
${persona}
--- PERSONA END ---

Based on this persona, you need to draft a new, original tweet. The tweet should be insightful, valuable, and sound human—like an experienced builder sharing knowledge, not a marketing department.

Key rules to follow for THIS TWEET:
1.  DO NOT ask any questions, especially at the end of the tweet. No exceptions.
2.  DO NOT use hashtags.
3.  DO NOT use em dashes (—).
4.  AVOID marketing hype, overly enthusiastic language, or corporate-sounding phrases. Focus on authenticity and genuine insight.
5.  Ensure the tweet is fresh and unique, and not too similar in topic or phrasing to the previously posted tweets listed below.
6.  DO NOT mention Teleprompt or its features in this tweet. The product description in the persona is only context, not content.
7.  Maximize readability with short, punchy sentences and **ensure you use double line breaks (\\n\\n) between paragraphs or distinct ideas to create visual spacing, similar to the provided example image.**
8.  **AIM FOR A LENGTH OF AROUND 600 CHARACTERS (approximately 3-5 substantial paragraphs) to provide in-depth, insightful, and educational content.**

`;

  if (previousPostTexts.length > 0) {
    promptContent += '\n--- PREVIOUSLY POSTED TWEETS (for reference to avoid similarity and to ensure new content is distinct) ---';
    const recentPosts = previousPostTexts.slice(-5); 
    recentPosts.forEach((text, index) => {
      promptContent += `\n${index + 1}. "${text}"`;
    });
    promptContent += '\n--- END PREVIOUSLY POSTED TWEETS ---';
  }
  promptContent += '\n\nNow, draft the new tweet based on all the above instructions. Remember: NO QUESTIONS AT THE END.';

  try {
    const completion = await openai.chat.completions.create({
      model: 'gpt-4o',
      messages: [
        { role: 'system', content: "You are an AI assistant strictly following a detailed persona and set of rules to draft a unique, insightful, and well-structured Twitter post of approximately 600 characters. Your main job is to adhere to all constraints, especially regarding tone, style, length, paragraph structure (double line breaks), providing a persona alignment check, and avoiding questions." },
        { role: 'user', content: promptContent },
      ],
      max_tokens: 350, // Increased for longer posts (1000 chars ~ 250 tokens + alignment check)
      temperature: 0.7, 
      n: 1,
    });

    if (completion.choices && completion.choices[0].message && completion.choices[0].message.content) {
      const newTweet = completion.choices[0].message.content.trim();
      console.log(`Post Writer Agent: OpenAI drafted tweet: "${newTweet}"`);
      // Basic check for empty or placeholder replies from AI
      if (newTweet.toLowerCase().includes("error") || newTweet.length < 10) {
          console.warn("Post Writer Agent: OpenAI generated a very short or error-like tweet. Will attempt to regenerate if retries are implemented.");
          return null;
      }
      return newTweet;
    } else {
      console.error('Post Writer Agent: OpenAI did not return valid content.');
      return null;
    }
  } catch (error) {
    console.error('Post Writer Agent: Error calling OpenAI API:', error);
    return null;
  }
}

// --- Playwright Posting Logic ---
async function publishTwitterPost(postText: string): Promise<string | null> {
  console.log('Post Writer Agent: Launching browser to post tweet...');
  const browser = await chromium.launch({ headless: HEADLESS_MODE });
  const context = await browser.newContext({ storageState: PLAYWRIGHT_STORAGE });
  const page = await context.newPage();
  let postUrl: string | null = null;

  try {
    console.log('Post Writer Agent: Navigating to Twitter compose page...');
    await page.goto('https://x.com/compose/post', { waitUntil: 'domcontentloaded', timeout: 60000 });
    
    // Wait for the main tweet input area to be ready
    const tweetEditorSelector = 'div.public-DraftEditor-content[role="textbox"]';
    console.log(`Post Writer Agent: Waiting for tweet editor: ${tweetEditorSelector}`);
    await page.waitForSelector(tweetEditorSelector, { state: 'visible', timeout: 30000 });
    console.log('Post Writer Agent: Tweet editor found. Typing post...');
    await typeWithJitter(page, tweetEditorSelector, postText, 25); // Using typeWithJitter

    // Click the "Post" button
    const postButtonSelector = 'button[data-testid="tweetButton"]';
    console.log(`Post Writer Agent: Waiting for Post button: ${postButtonSelector}`);
    await page.waitForSelector(postButtonSelector, { state: 'visible', timeout: 15000 });
    console.log('Post Writer Agent: Clicking Post button...');
    await page.click(postButtonSelector);

    // Try to detect successful post and get URL
    // This is the trickiest part and might need refinement based on actual UI behavior.
    // Option 1: Look for "Your post was sent." notification
    try {
        const notificationSelector = 'div[data-testid="toast"]'; // Common selector for toasts/notifications
        console.log('Post Writer Agent: Waiting for post success notification...');
        await page.waitForSelector(notificationSelector, { timeout: 15000 }); // Wait for any toast
        const toastText = await page.locator(notificationSelector).innerText();
        if (toastText.toLowerCase().includes('your post was sent') || toastText.toLowerCase().includes('post sent')) {
            console.log('Post Writer Agent: "Post sent" notification detected.');
            // Attempt to get URL by navigating to profile and finding the latest tweet
            // This is an indirect way and might not always get the exact post if timing is off
            // A more direct way would be if Twitter API provided it, or if the UI had a direct link on success.
            const profileLink = await page.locator('a[data-testid="AppTabBar_Profile_Link"]').getAttribute('href');
            if (profileLink) {
                console.log(`Post Writer Agent: Navigating to profile ${profileLink} to find post URL.`);
                await page.goto(`https://x.com${profileLink}`, { waitUntil: 'networkidle', timeout: 60000});
                await page.waitForTimeout(2000); // Allow tweets to load
                const firstTweetLink = await page.locator('article[data-testid="tweet"] a:has(time[datetime])').first().getAttribute('href');
                if (firstTweetLink) {
                    postUrl = `https://x.com${firstTweetLink}`;
                    console.log(`Post Writer Agent: Tentatively identified post URL: ${postUrl}`);
                } else {
                    console.warn('Post Writer Agent: Could not find link to the latest tweet on profile page.');
                }
            }
        } else {
            console.warn(`Post Writer Agent: Received a notification, but it wasn't the expected success message: "${toastText}"`);
        }
    } catch (e:any) {
      console.warn(`Post Writer Agent: Did not find a clear success notification or failed to get post URL. Error: ${e.message}. Assuming post might have failed or URL retrieval is not possible this way.`);
    }

    if (!postUrl) {
        console.log("Post Writer Agent: Post URL not retrieved. The post might still be successful.");
    }
    
    console.log('Post Writer Agent: Pausing briefly after attempting post...');
    await page.waitForTimeout(3000);

  } catch (error: any) {
    console.error('Post Writer Agent: Error during Playwright posting operation:', error);
    // In case of error, we don't have a URL
    postUrl = null; 
    // Optionally, take a screenshot on error if not headless for debugging
    // if (!HEADLESS_MODE) {
    //   await page.screenshot({ path: 'post_writer_error.png' });
    //   console.log('Post Writer Agent: Screenshot taken as post_writer_error.png');
    // }
  } finally {
    console.log('Post Writer Agent: Closing browser.');
    if (browser && browser.isConnected()) {
      await browser.close();
    }
  }
  return postUrl; // This will be null if URL couldn't be confirmed
}


// --- Main Execution ---
async function mainPostWriter() {
  console.log('--- Post Writer Agent Starting ---');
  await loadPostWriterPersona();

  const previousPosts = await loadPreviousPosts();
  const previousPostTexts = previousPosts.map(p => p.postedText);

  let newPostText: string | null = null;
  const maxRetries = 3; // Max attempts to generate a non-null, original post

  for (let i = 0; i < maxRetries; i++) {
    console.log(`Post Writer Agent: Attempt ${i + 1} to generate a new post.`);
    newPostText = await generateNewPost(postWriterPersonaContent, previousPostTexts);
    if (newPostText) {
      // Optional: Add a more sophisticated similarity check here if needed
      // For now, we trust OpenAI's ability to generate something different based on the prompt.
      console.log(`Post Writer Agent: Successfully generated post content: "${newPostText}"`);
      break; 
    }
    if (i < maxRetries - 1) {
        console.log('Post Writer Agent: Failed to generate suitable post, retrying after a short delay...');
        await new Promise(resolve => setTimeout(resolve, 2000)); // Wait 2s before retrying
    }
  }

  if (!newPostText) {
    console.error('Post Writer Agent: Failed to generate new post content after multiple attempts. Exiting.');
    return;
  }

  // Now, publish the generated post
  const postedTweetUrl = await publishTwitterPost(newPostText);

  // Log to CSV, even if URL wasn't retrieved, to record the attempt and text
  // We only log if newPostText is not null, implying an attempt was made to generate/post it.
  const logEntry: PostLogEntry = {
    timestamp: new Date().toLocaleString('sv-SE', { timeZone: 'Asia/Jerusalem' }),
    postedText: newPostText,
    postUrl: postedTweetUrl || undefined, // Store undefined if null
  };
  await appendPostToLog(logEntry);

  if (postedTweetUrl) {
    console.log(`Post Writer Agent: Successfully posted and logged new tweet. URL: ${postedTweetUrl}`);
  } else {
    console.warn('Post Writer Agent: Post was attempted and text logged, but could not confirm post URL on Twitter.');
  }
  console.log('--- Post Writer Agent Finished ---');
}

mainPostWriter().catch(error => {
  console.error('Post Writer Agent: Unhandled error in main execution:', error);
  process.exit(1);
}); 