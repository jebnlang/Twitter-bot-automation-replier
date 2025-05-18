# Twitter Post Scheduler Setup in Railway

This document explains how to set up the automated Twitter posting schedule in Railway using cron jobs.

## What This Does

The system will:
1. Post automatically every 6 hours (+/- 30 minutes for natural variation)
2. Check when the last post was made before posting
3. Only post if sufficient time has passed since the last post
4. Exit cleanly after posting or deciding not to post

## Setup Instructions

### 1. Create a New Service in Railway

Create a separate service specifically for the scheduled posting job:

1. Go to your Railway project dashboard
2. Click "New Service" → "GitHub Repo"
3. Select your repository
4. Give it a descriptive name like "Twitter-Scheduler"

### 2. Configure Environment Variables

Make sure the service has all the same environment variables as your main service:

- `OPENAI_API_KEY`
- `PLAYWRIGHT_STORAGE` (typically set to `/data/auth.json`)
- `AUTH_JSON_BASE64` (your base64-encoded auth.json)
- `TAVILY_API_KEY`
- Any other variables your project requires

### 3. Configure Volume

Attach the same volume to this service that contains your auth.json and logs:

1. Go to "Settings" → "Volumes"
2. Click "Attach Volume"
3. Select your existing volume
4. Set the mount path to `/data`

### 4. Configure as a Cron Job

Set up the cron schedule:

1. Go to "Settings" → "Cron"
2. Enable "Cron Job"
3. Set the Schedule Pattern to: `0 */6 * * *` (runs every 6 hours, on the hour)
4. Set the Timezone to your preferred timezone

### 5. Set the Start Command

Set the service to use the scheduled poster:

1. Go to "Settings" → "Deploy"
2. Set "Custom Start Command" to: `npm run scheduled-poster`

### 6. Deploy

Deploy the service to activate the cron job.

## How It Works

The scheduled posting runs using `src/scheduled_poster.ts`, which:

1. Checks the most recent post timestamp from the CSV log file
2. Adds random variation of +/- 30 minutes to the 6-hour interval
3. Only creates and posts new content if enough time has passed
4. Exits cleanly after posting or deciding not to post

The Railway cron job will automatically start this service according to the schedule, and it will shut down when the process completes.

## Troubleshooting

If posts aren't being created:

1. Check Railway logs for the scheduler service
2. Verify environment variables are set correctly
3. Ensure the volume is properly mounted
4. Confirm auth.json exists and is valid
5. Check that the CSV log file exists and has valid entries

## Manual Override

You can always deploy the service manually to trigger a post outside the schedule by clicking the "Deploy" button. 