"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const dotenv_1 = require("dotenv");
const fs = __importStar(require("fs"));
const path_1 = __importDefault(require("path"));
const supabase_js_1 = require("@supabase/supabase-js");
const sync_1 = require("csv-parse/sync"); // Import the synchronous parser
// Load environment variables
(0, dotenv_1.config)();
// Supabase Credentials
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
// Path to your CSV file
const CSV_LOG_FILE_PATH = path_1.default.resolve(process.env.POST_WRITER_CSV_LOG_FILE || 'created_posts_log.csv');
// Basic Validations
if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    console.error('Migration Script: Error - SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY is not defined. Please set them in your .env file.');
    process.exit(1);
}
if (!fs.existsSync(CSV_LOG_FILE_PATH)) {
    console.error(`Migration Script: Error - CSV file not found at ${CSV_LOG_FILE_PATH}.`);
    process.exit(1);
}
// Supabase Client
const supabase = (0, supabase_js_1.createClient)(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
async function migrateCsvToSupabase() {
    console.log('Migration Script: Starting CSV to Supabase migration...');
    try {
        const fileContent = fs.readFileSync(CSV_LOG_FILE_PATH, 'utf8');
        // Use csv-parse for robust parsing
        const records = (0, sync_1.parse)(fileContent, {
            columns: true, // Treat the first line as column headers
            skip_empty_lines: true,
            trim: true,
            relax_column_count: true // Allows for lines with fewer columns (e.g. if topic is sometimes missing)
        });
        if (records.length === 0) {
            console.log('Migration Script: CSV file is empty or only contains headers. No data to migrate.');
            return;
        }
        const postsToInsert = [];
        for (const record of records) {
            const timestampStr = record.timestamp;
            const postedText = record.postedText; // Column name from CSV header
            const postUrl = record.postUrl || undefined;
            const topic = record.topic || undefined;
            let timestamp;
            if (timestampStr) {
                if (timestampStr.includes('T')) {
                    timestamp = new Date(timestampStr);
                }
                else {
                    timestamp = new Date(timestampStr.replace(' ', 'T'));
                }
                if (isNaN(timestamp.getTime())) {
                    console.warn(`Migration Script: Skipping record due to invalid timestamp: ${timestampStr}`, record);
                    continue;
                }
            }
            else {
                console.warn('Migration Script: Skipping record due to missing timestamp', record);
                continue;
            }
            if (!postedText) {
                console.warn('Migration Script: Skipping record due to missing postedText', record);
                continue;
            }
            postsToInsert.push({
                timestamp: timestamp.toISOString(),
                posted_text: postedText,
                post_url: postUrl,
                topic: topic,
                status: postUrl ? 'posted' : (postedText === 'GENERATION_FAILED' || postedText === 'TOPIC_GENERATION_FAILED' ? 'failed' : 'unknown'),
                // Add more specific status if GENERATION_FAILED or similar is found
            });
        }
        if (postsToInsert.length === 0) {
            console.log('Migration Script: No valid posts found in CSV to migrate after parsing.');
            return;
        }
        console.log(`Migration Script: Attempting to insert ${postsToInsert.length} posts into Supabase...`);
        // Delete existing records before inserting to avoid duplicates if run multiple times
        // This is a choice: you could also try to upsert or check for existence.
        // For a one-time migration, deleting and re-inserting is often simpler.
        console.log('Migration Script: Deleting existing posts from Supabase table to prevent duplicates...');
        const { error: deleteError } = await supabase.from('posts').delete().neq('id', -1); // Delete all rows
        if (deleteError) {
            console.error('Migration Script: Error deleting existing data from Supabase:', deleteError);
            // Decide if you want to proceed or stop if deletion fails
            // For now, we'll log and continue, which might lead to duplicates if this was a re-run
        }
        const { data, error: insertError } = await supabase.from('posts').insert(postsToInsert).select();
        if (insertError) {
            console.error('Migration Script: Error inserting data into Supabase:', insertError);
        }
        else {
            console.log(`Migration Script: Successfully inserted ${data ? data.length : 0} posts into Supabase.`);
        }
    }
    catch (error) {
        console.error('Migration Script: An unexpected error occurred:', error);
    }
    console.log('Migration Script: Migration process completed.');
}
// Run the migration
migrateCsvToSupabase();
