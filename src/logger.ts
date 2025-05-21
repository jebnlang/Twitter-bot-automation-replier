import { Worker, Job } from 'bullmq';
import dotenv from 'dotenv';
import Redis from 'ioredis'; // For standalone Redis connection if needed, though BullMQ handles its own.
import { createClient, SupabaseClient } from '@supabase/supabase-js'; // Added Supabase client

dotenv.config();

const REDIS_URL = process.env.REDIS_URL;
// const LOG_FILE_PATH = process.env.LOG_FILE_PATH || 'twitter_activity_log.csv'; // Removed CSV log path

// Added Supabase credentials
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!REDIS_URL) {
  console.error('Logger Agent: Error - REDIS_URL is not defined.');
  process.exit(1);
}

// Added Supabase validation
if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error('Logger Agent: Error - SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY is not defined.');
  process.exit(1);
}

const logEntryQueueName = 'logEntryQueue';

const redisConnectionOptions = {
  host: new URL(REDIS_URL).hostname,
  port: parseInt(new URL(REDIS_URL).port, 10),
  password: new URL(REDIS_URL).password ? decodeURIComponent(new URL(REDIS_URL).password) : undefined,
  db: new URL(REDIS_URL).pathname ? parseInt(new URL(REDIS_URL).pathname.substring(1), 10) : 0,
};

// Initialize Supabase client
const supabase: SupabaseClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

// Removed formatCsvField function
// function formatCsvField(data: string | undefined | null): string {
//   if (data === null || data === undefined) {
//     return '""';
//   }
//   const str = String(data);
//   // Escape double quotes by doubling them, then wrap in double quotes
//   return `"${str.replace(/"/g, '""')}"`;
// }

// Removed ensureLogFileHasHeader function
// async function ensureLogFileHasHeader() {
//   try {
//     await fs.access(LOG_FILE_PATH);
//   } catch (error) {
//     // File does not exist, create it with header
//     const header = `"Timestamp","Post URL","Post Content","Reply Content"\n`;
//     try {
//       await fs.writeFile(LOG_FILE_PATH, header, 'utf8');
//       console.log(`Logger Agent: Created log file ${LOG_FILE_PATH} with header.`);
//     } catch (writeError) {
//       console.error(`Logger Agent: Error writing header to log file ${LOG_FILE_PATH}:`, writeError);
//     }
//   }
// }

async function processLogEntryJob(job: Job) {
  const { timestamp, postUrl, postContent, replyContent } = job.data;
  console.log(`Logger Agent: Received log entry for job ID ${job.id}, Post URL: ${postUrl}`);

  // const csvRow = [ // Removed CSV row creation
  //   formatCsvField(timestamp),
  //   formatCsvField(postUrl),
  //   formatCsvField(postContent),
  //   formatCsvField(replyContent),
  // ].join(',') + '\n';

  try {
    // await fs.appendFile(LOG_FILE_PATH, csvRow, 'utf8'); // Removed CSV append
    // console.log(`Logger Agent: Appended log entry for Post URL ${postUrl} to ${LOG_FILE_PATH}`); // Removed CSV log message

    // Insert into Supabase
    const { error: insertError } = await supabase
      .from('twitter_activity_logs')
      .insert([
        {
          activity_timestamp: timestamp, // Make sure timestamp is in a format Supabase understands (ISO 8601 string)
          post_url: postUrl,
          post_content: postContent,
          reply_content: replyContent,
        },
      ]);

    if (insertError) {
      console.error(`Logger Agent: Error inserting log entry to Supabase for Post URL ${postUrl}:`, insertError);
      throw insertError; // Propagate error to BullMQ for retry
    } else {
      console.log(`Logger Agent: Successfully inserted log entry for Post URL ${postUrl} to Supabase.`);
    }

  } catch (error) {
    // console.error(`Logger Agent: Error appending to log file ${LOG_FILE_PATH}:`, error); // Modified error message
    console.error(`Logger Agent: Error processing log entry job ID ${job.id} for Supabase:`, error);
    // Decide if you want to throw error to make job fail and retry
    throw error; // For now, let's make it retry on failure
  }
}

async function startLoggerAgent() {
  // await ensureLogFileHasHeader(); // Removed: Check and create header if needed before worker starts

  console.log(`Logger Agent: Starting worker, listening to queue: "${logEntryQueueName}"`);
  const worker = new Worker(logEntryQueueName, processLogEntryJob, {
    connection: redisConnectionOptions,
    concurrency: 1, // Logging is not typically high-concurrency
    removeOnComplete: { count: 10000 }, // Keep a good number of logs
    removeOnFail: { count: 5000 },
  });

  worker.on('completed', (job) => {
    console.log(`Logger Agent: Log entry job ID ${job.id} (Post URL: ${job.data.postUrl}) completed.`);
  });

  worker.on('failed', (job, err) => {
    console.error(`Logger Agent: Log entry job ID ${job?.id} (Post URL: ${job?.data?.postUrl}) failed with error: ${err.message}`);
  });

  worker.on('error', err => {
    console.error('Logger Agent: Worker encountered an error:', err);
  });

  console.log('Logger Agent: Worker started.');

  // Graceful shutdown
  const gracefulShutdown = async () => {
    console.log('Logger Agent: Shutting down worker...');
    await worker.close();
    console.log('Logger Agent: Worker shut down.');
    process.exit(0);
  };
  process.on('SIGINT', gracefulShutdown);
  process.on('SIGTERM', gracefulShutdown);
}

startLoggerAgent().catch(error => {
  console.error('Logger Agent: Unhandled error in startup:', error);
  process.exit(1);
}); 