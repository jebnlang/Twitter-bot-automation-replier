import { config as dotenvConfig } from 'dotenv';
import * as fs from 'fs';
import path from 'path';

// Load environment variables
dotenvConfig();

// Constants
const HOURS_BETWEEN_POSTS = 6;
// Add randomization (±30 minutes) for natural posting behavior
const MAX_TIME_VARIATION_MS = 30 * 60 * 1000; // 30 minutes in milliseconds
const CSV_LOG_FILE = process.env.CSV_LOG_FILE || '/data/created_posts_log.csv';

async function main() {
  console.log('Scheduled Poster: Starting check for scheduled posting');
  
  // Check if we should post now based on last post time
  const shouldPost = checkIfShouldPost();
  
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

function checkIfShouldPost(): boolean {
  // Get current time
  const now = new Date();
  
  try {
    // Check if CSV file exists
    if (!fs.existsSync(CSV_LOG_FILE)) {
      console.log('Scheduled Poster: No log file found. Creating one and posting immediately.');
      
      // Create the directory if it doesn't exist
      const dir = path.dirname(CSV_LOG_FILE);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      
      // Create the CSV file with headers
      fs.writeFileSync(CSV_LOG_FILE, '"timestamp","postedText","postUrl"\n');
      return true;
    }
    
    // Read and parse the CSV file manually - avoiding external dependencies
    const fileContent = fs.readFileSync(CSV_LOG_FILE, 'utf8');
    const lines = fileContent.split('\n').filter(line => line.trim() !== '');
    
    if (lines.length <= 1) {
      console.log('Scheduled Poster: No previous posts found. Posting immediately.');
      return true;
    }
    
    // Get the latest post's timestamp from the last line
    const lastLine = lines[lines.length - 1];
    
    // More robust CSV parsing for quoted fields
    // This regex matches the first field in a CSV line that might contain quoted content
    const csvFieldRegex = /^"([^"]*)"/;
    const match = lastLine.match(csvFieldRegex);
    
    if (!match || !match[1]) {
      console.error('Scheduled Poster: Could not extract timestamp from CSV. Defaulting to posting.');
      return true;
    }
    
    const lastPostTimeStr = match[1];
    console.log(`Scheduled Poster: Extracted timestamp: "${lastPostTimeStr}"`);
    
    // Try to parse the timestamp - handle different possible formats
    let lastPostTime: Date;
    
    if (lastPostTimeStr.includes('T')) {
      // ISO format like "2025-05-17T12:38:55.125Z"
      lastPostTime = new Date(lastPostTimeStr);
    } else {
      // Local format like "2025-05-17 22:10:20"
      // Convert to ISO-like format for parsing
      lastPostTime = new Date(lastPostTimeStr.replace(' ', 'T'));
    }
    
    if (isNaN(lastPostTime.getTime())) {
      console.error(`Scheduled Poster: Could not parse timestamp "${lastPostTimeStr}". Defaulting to posting.`);
      return true;
    }
    
    // Calculate time difference in hours
    const timeDiffMs = now.getTime() - lastPostTime.getTime();
    const timeDiffHours = timeDiffMs / (1000 * 60 * 60);
    
    // Add some randomization to the required time
    const randomVariationMs = (Math.random() * 2 - 1) * MAX_TIME_VARIATION_MS; // Between -30 and +30 minutes
    const adjustedHoursBetweenPosts = (HOURS_BETWEEN_POSTS * 60 * 60 * 1000 + randomVariationMs) / (1000 * 60 * 60);
    
    console.log(`Scheduled Poster: Last post was ${timeDiffHours.toFixed(2)} hours ago. Need ${adjustedHoursBetweenPosts.toFixed(2)} hours between posts.`);
    
    // Check if enough time has passed (with randomization)
    return timeDiffHours >= adjustedHoursBetweenPosts;
  } catch (error) {
    console.error('Scheduled Poster: Error checking last post time:', error);
    // Default to posting in case of error
    return true;
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