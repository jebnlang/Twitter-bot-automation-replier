const { chromium } = require('playwright');

(async () => {
  console.log('🚀 Starting Playwright Browser Inspector for Twitter Authentication');
  console.log('📋 Instructions:');
  console.log('1. Browser will open to Twitter login page');
  console.log('2. Complete the login process manually');
  console.log('3. Navigate to your Twitter home feed');
  console.log('4. Press ENTER in this terminal when you\'re logged in and ready');
  console.log('5. The script will capture your authentication state to auth.json');
  console.log('');

  const browser = await chromium.launch({
    headless: false,
    devtools: true, // Opens developer tools
    slowMo: 100 // Slows down operations for better visibility
  });
  
  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/100.0.4896.127 Safari/537.36'
  });
  
  const page = await context.newPage();
  
  // Navigate to Twitter login
  console.log('🌐 Opening Twitter login page...');
  await page.goto('https://x.com/i/flow/login');
  
  // Wait for user to complete login manually
  console.log('⏳ Please complete the login process in the browser...');
  console.log('   - Enter your credentials');
  console.log('   - Complete any 2FA if required');
  console.log('   - Navigate to your home feed');
  console.log('   - Press ENTER here when ready to capture auth state');
  
  // Wait for user input
  await new Promise(resolve => {
    process.stdin.once('data', () => {
      resolve();
    });
  });
  
  console.log('💾 Capturing authentication state...');
  
  // Save the authentication state
  await context.storageState({ path: 'auth.json' });
  
  console.log('✅ Authentication state saved to auth.json');
  console.log('🔒 Closing browser...');
  
  await context.close();
  await browser.close();
  
  console.log('🎉 Authentication capture complete!');
  console.log('📁 Your auth.json file has been updated with fresh authentication data');
})(); 