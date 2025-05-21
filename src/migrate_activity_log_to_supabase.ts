import { config as dotenvConfig } from 'dotenv';
import * as fs from 'fs';
import path from 'path';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { parse } from 'csv-parse/sync';

dotenvConfig();

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

// Path to your Twitter activity CSV log file
const CSV_LOG_FILE_PATH = path.resolve(process.env.LOG_FILE_PATH || 'twitter_activity_log.csv');
const TARGET_TABLE_NAME = 'twitter_activity_logs';

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error('Migration Script: Error - SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY is not defined. Please set them in your .env file.');
  process.exit(1);
}

if (!fs.existsSync(CSV_LOG_FILE_PATH)) {
  console.warn(`Migration Script: Warning - CSV file not found at ${CSV_LOG_FILE_PATH}. Assuming no historical data to migrate.`);
  // process.exit(1); // We can choose to exit or just log a warning and continue (allowing logger to work for new entries)
}

const supabase: SupabaseClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

// Helper to attempt to parse various timestamp formats that might be in the CSV
function parseTimestamp(timestampStr: string | undefined | null): string | undefined {
  if (!timestampStr) return undefined;

  // Common ISO-like format from new Date().toISOString() or new Date().toLocaleString()
  // Handles "YYYY-MM-DDTHH:mm:ss.sssZ" or "MM/DD/YYYY, HH:mm:ss AM/PM"
  const date = new Date(timestampStr);
  if (!isNaN(date.getTime())) {
    return date.toISOString();
  }

  // Attempt to handle "YYYY-MM-DD HH:mm:ss" (space instead of T)
  const spaceSeparatedDate = new Date(timestampStr.replace(' ', 'T'));
  if (!isNaN(spaceSeparatedDate.getTime())) {
    return spaceSeparatedDate.toISOString();
  }
  
  console.warn(`Migration Script: Could not parse timestamp: ${timestampStr}. It will be set to null.`);
  return undefined;
}


async function migrateActivityLogToSupabase() {
  console.log('Migration Script: Starting Twitter Activity Log CSV to Supabase migration...');

  if (!fs.existsSync(CSV_LOG_FILE_PATH)) {
    console.log(`Migration Script: CSV file ${CSV_LOG_FILE_PATH} not found. No data to migrate.`);
    return;
  }

  try {
    const fileContent = fs.readFileSync(CSV_LOG_FILE_PATH, 'utf8');
    
    const records = parse(fileContent, {
      columns: true, 
      skip_empty_lines: true,
      trim: true,
      relax_column_count: true 
    });

    if (records.length === 0) {
      console.log('Migration Script: CSV file is empty or only contains headers. No data to migrate.');
      return;
    }

    const logsToInsert = [];
    for (const record of records) {
      const activityTimestamp = parseTimestamp(record.Timestamp); // From CSV Header "Timestamp"
      const postUrl = record['Post URL'] || undefined; // From CSV Header "Post URL"
      const postContent = record['Post Content'] || undefined; // From CSV Header "Post Content"
      const replyContent = record['Reply Content'] || undefined; // From CSV Header "Reply Content"

      // Basic validation: we need at least a timestamp or some content to make a log entry meaningful
      if (!activityTimestamp && !postUrl && !postContent && !replyContent) {
        console.warn('Migration Script: Skipping record with all empty essential fields:', record);
        continue;
      }

      logsToInsert.push({
        activity_timestamp: activityTimestamp,
        post_url: postUrl,
        post_content: postContent,
        reply_content: replyContent,
      });
    }

    if (logsToInsert.length === 0) {
      console.log('Migration Script: No valid log entries found in CSV to migrate after parsing.');
      return;
    }

    console.log(`Migration Script: Attempting to insert ${logsToInsert.length} log entries into Supabase table '${TARGET_TABLE_NAME}'`);
    
    // For a one-time migration to a new table, deleting existing data can prevent issues if script is re-run.
    // If the table might have new data from the logger already, this approach should be used cautiously.
    // Given this is an initial migration, this is generally safe.
    console.log(`Migration Script: Deleting existing data from Supabase table '${TARGET_TABLE_NAME}' to prevent duplicates...`);
    const { error: deleteError } = await supabase.from(TARGET_TABLE_NAME).delete().neq('id', '00000000-0000-0000-0000-000000000000'); // Delete all rows, using a non-existent UUID
    if (deleteError) {
        console.error('Migration Script: Error deleting existing data from Supabase:', deleteError);
        // For this script, we'll stop if we can't clear the table to avoid potential duplicate partial data.
        return;
    }

    // Supabase client has a limit of around 1000-2000 items per insert call depending on data size.
    // Batching inserts is safer for larger datasets.
    const BATCH_SIZE = 500;
    let insertedCount = 0;
    for (let i = 0; i < logsToInsert.length; i += BATCH_SIZE) {
      const batch = logsToInsert.slice(i, i + BATCH_SIZE);
      console.log(`Migration Script: Inserting batch ${i / BATCH_SIZE + 1} with ${batch.length} records...`);
      const { data, error: insertError } = await supabase.from(TARGET_TABLE_NAME).insert(batch).select();

      if (insertError) {
        console.error('Migration Script: Error inserting batch into Supabase:', insertError);
        // Depending on the error, you might want to stop, log, or try individual inserts.
        // For now, we log and continue with next batch, meaning some data might be skipped.
      } else {
        insertedCount += data ? data.length : 0;
        console.log(`Migration Script: Successfully inserted batch. Total inserted so far: ${insertedCount}`);
      }
    }

    console.log(`Migration Script: Successfully inserted ${insertedCount} of ${logsToInsert.length} log entries into Supabase.`);

  } catch (error) {
    console.error('Migration Script: An unexpected error occurred during migration:', error);
  }
  console.log('Migration Script: Twitter Activity Log migration process completed.');
}

// Run the migration
migrateActivityLogToSupabase().catch(error => {
    console.error('Migration Script: Unhandled error during migration execution:', error);
    process.exit(1);
}); 