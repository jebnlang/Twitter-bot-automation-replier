import { config as dotenvConfig } from 'dotenv';
import * as fs from 'fs';
import path from 'path';
import { createClient, SupabaseClient } from '@supabase/supabase-js';

// Load environment variables
dotenvConfig();

// Constants
const HOURS_BETWEEN_POSTS = 6;
// Add randomization (±30 minutes) for natural posting behavior
const MAX_TIME_VARIATION_MS = 30 * 60 * 1000; // 30 minutes in milliseconds
// const CSV_LOG_FILE = process.env.CSV_LOG_FILE || '/data/created_posts_log.csv'; // No longer primary log
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

// Basic Validations for Supabase
if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error('Scheduled Poster: Error - SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY is not defined. Please set them in your .env file.');
  process.exit(1);
}

// Supabase Client
const supabase: SupabaseClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

async function main() {
  console.log('Scheduled Poster: Starting check for scheduled posting');
  
  const shouldPost = await checkIfShouldPost(); // Now an async function
  
  if (!shouldPost) {
    console.log('Scheduled Poster: Not enough time has passed since last post. Exiting.');
    return;
  }
  
  console.log('Scheduled Poster: Time to post! Initiating post creation and publishing process');
  
  try {
    // Import the main post_writer function dynamically to avoid linter errors
    // This executes the main function in post_writer.ts which handles the entire posting process
    const { default: executePostWriter } = await import('./post_writer');
    
    // Run the main post writer function
    await executePostWriter();
    
    console.log('Scheduled Poster: Post process completed successfully');
  } catch (error) {
    console.error('Scheduled Poster: Error during posting process:', error);
  }
}

async function checkIfShouldPost(): Promise<boolean> { // Return Promise<boolean>
  const now = new Date();
  
  try {
    const { data, error } = await supabase
      .from('posts')
      .select('timestamp')
      .eq('status', 'posted') // Only consider successfully posted tweets
      .order('timestamp', { ascending: false })
      .limit(1);

    if (error) {
      console.error('Scheduled Poster: Error fetching last post time from Supabase:', error);
      return true; // Default to posting if DB check fails
    }

    if (!data || data.length === 0) {
      console.log('Scheduled Poster: No previous successfully posted entries found in Supabase. Posting immediately.');
      return true;
    }
    
    const lastPostTimeStr = data[0].timestamp;
    const lastPostTime = new Date(lastPostTimeStr);
    
    if (isNaN(lastPostTime.getTime())) {
      console.error(`Scheduled Poster: Could not parse timestamp "${lastPostTimeStr}" from Supabase. Defaulting to posting.`);
      return true;
    }
    
    const timeDiffMs = now.getTime() - lastPostTime.getTime();
    const timeDiffHours = timeDiffMs / (1000 * 60 * 60);
    
    const randomVariationMs = (Math.random() * 2 - 1) * MAX_TIME_VARIATION_MS;
    const adjustedHoursBetweenPosts = (HOURS_BETWEEN_POSTS * 60 * 60 * 1000 + randomVariationMs) / (1000 * 60 * 60);
    
    console.log(`Scheduled Poster: Last successful post was ${timeDiffHours.toFixed(2)} hours ago. Need ${adjustedHoursBetweenPosts.toFixed(2)} hours between posts.`);
    
    return timeDiffHours >= adjustedHoursBetweenPosts;

  } catch (error) {
    console.error('Scheduled Poster: Unexpected error checking last post time from Supabase:', error);
    return true; // Default to posting in case of unexpected error
  }
}

// Run the main function and exit when done
main()
  .then(() => {
    console.log('Scheduled Poster: Process completed');
    // Give time for any pending operations to complete
    setTimeout(() => process.exit(0), 1000);
  })
  .catch((error) => {
    console.error('Scheduled Poster: Unhandled error:', error);
    process.exit(1);
  }); 