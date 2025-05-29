const { chromium } = require('playwright');
const { encodeAuthToBase64 } = require('./auth-renewal-helper');
const fs = require('fs');

/**
 * Automated Fresh Authentication Script
 * 
 * This script will:
 * 1. Open a browser to x.com/login
 * 2. Let you login manually
 * 3. Capture fresh cookies automatically
 * 4. Generate new auth.json and base64 string
 */

(async () => {
  console.log('🚀 Starting automated fresh authentication process...\n');

  const browser = await chromium.launch({
    headless: false  // Keep visible so you can login
  });
  
  const context = await browser.newContext();
  const page = await context.newPage();
  
  try {
    console.log('📂 Opening X.com login page...');
    await page.goto('https://x.com/i/flow/login');
    
    console.log(`
🔐 MANUAL LOGIN REQUIRED

The browser window is now open. Please:
1. Complete the login process manually in the browser
2. Make sure you're fully logged in (see your home timeline)
3. Press ENTER in this terminal when you're done logging in

This script will wait for you to finish...
    `);
    
    // Wait for user to press Enter
    await new Promise(resolve => {
      process.stdin.setRawMode(true);
      process.stdin.resume();
      process.stdin.on('data', () => {
        process.stdin.setRawMode(false);
        process.stdin.pause();
        resolve();
      });
    });
    
    console.log('\n🍪 Capturing fresh authentication cookies...');
    
    // Navigate to home to ensure we're fully logged in
    await page.goto('https://x.com/home');
    await page.waitForTimeout(2000); // Wait for page to fully load
    
    // Capture the authentication state
    await context.storageState({ path: 'auth.json' });
    
    console.log('✅ Fresh auth.json saved successfully!');
    
    // Generate base64 string
    const authContent = fs.readFileSync('auth.json', 'utf8');
    const authJson = JSON.parse(authContent);
    const base64String = encodeAuthToBase64(authJson);
    
    console.log('\n' + '='.repeat(60));
    console.log('🎉 FRESH AUTHENTICATION COMPLETE!');
    console.log('='.repeat(60));
    
    console.log('\n📊 Authentication Summary:');
    console.log(`- Total cookies captured: ${authJson.cookies?.length || 0}`);
    
    // Check for important cookies
    const importantCookies = ['auth_token', 'ct0', 'kdt', 'twid'];
    const foundCookies = [];
    
    if (authJson.cookies) {
      authJson.cookies.forEach(cookie => {
        if (importantCookies.includes(cookie.name)) {
          foundCookies.push(cookie.name);
          const expires = new Date(cookie.expires * 1000);
          console.log(`- ${cookie.name}: ✅ Valid until ${expires.toDateString()}`);
        }
      });
    }
    
    const missingCookies = importantCookies.filter(name => !foundCookies.includes(name));
    if (missingCookies.length > 0) {
      console.log(`- ⚠️  Missing cookies: ${missingCookies.join(', ')}`);
    }
    
    console.log('\n🔗 BASE64 STRING FOR ENVIRONMENT VARIABLE:');
    console.log('─'.repeat(60));
    console.log('Set AUTH_JSON_BASE64 to:');
    console.log('\n' + base64String);
    console.log('\n' + '─'.repeat(60));
    
    console.log('\n📋 NEXT STEPS:');
    console.log('1. Copy the base64 string above');
    console.log('2. Update your AUTH_JSON_BASE64 environment variable in Railway');
    console.log('3. Test your bot to ensure it works with the new authentication');
    
    // Save base64 to file for easy copying
    fs.writeFileSync('auth-base64.txt', base64String);
    console.log('4. Base64 also saved to auth-base64.txt for easy copying');
    
  } catch (error) {
    console.error('❌ Error during authentication process:', error.message);
    console.log('\n🔧 If login failed, try:');
    console.log('- Make sure you have the correct Twitter credentials');
    console.log('- Check if two-factor authentication is required');
    console.log('- Ensure you completed the full login process');
  } finally {
    await context.close();
    await browser.close();
    console.log('\n🔚 Browser closed. Authentication process complete.');
  }
})(); 