const { exec } = require('child_process');
const path = require('path');

console.log('Cron Wrapper: Starting, will run scheduler every 5 minutes');

// Initial run
runScheduler();

// Schedule runs every 5 minutes
setInterval(runScheduler, 5 * 60 * 1000);

function runScheduler() {
  const timestamp = new Date().toISOString();
  console.log(`[${timestamp}] Cron Wrapper: Running scheduled post check...`);
  
  exec('npm run scheduled-poster', (error, stdout, stderr) => {
    if (error) {
      console.error(`[${timestamp}] Error executing scheduled-poster: ${error.message}`);
      return;
    }
    
    // Log output from the command
    if (stdout) console.log(`[${timestamp}] scheduled-poster output:\n${stdout}`);
    if (stderr) console.error(`[${timestamp}] scheduled-poster error output:\n${stderr}`);
    
    console.log(`[${timestamp}] Cron Wrapper: Completed scheduled run`);
  });
} 