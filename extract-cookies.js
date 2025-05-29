const { updateAuthWithBrowserCookies } = require('./auth-renewal-helper');

/**
 * Cookie Extraction Script
 * 
 * INSTRUCTIONS:
 * 1. Open Chrome/Safari and go to https://x.com
 * 2. Right-click → Inspect Element (F12)
 * 3. Go to Application tab → Storage → Cookies → x.com
 * 4. Copy the important cookies and paste them in the browserCookies array below
 * 5. Run: node extract-cookies.js
 */

// PASTE YOUR FRESH COOKIES HERE:
// Copy each cookie from browser inspector and format like this:
const browserCookies = [
    // EXAMPLE - Replace with your actual cookies:
    {
        "name": "auth_token",
        "value": "PASTE_YOUR_AUTH_TOKEN_VALUE_HERE",
        "domain": ".x.com",
        "path": "/",
        "expires": 1782274539.766847, // Convert expiry date to Unix timestamp
        "httpOnly": true,
        "secure": true,
        "sameSite": "None"
    },
    {
        "name": "ct0",
        "value": "PASTE_YOUR_CT0_VALUE_HERE",
        "domain": ".x.com",
        "path": "/",
        "expires": 1782274540.116643,
        "httpOnly": false,
        "secure": true,
        "sameSite": "Lax"
    },
    {
        "name": "kdt",
        "value": "PASTE_YOUR_KDT_VALUE_HERE",
        "domain": ".x.com",
        "path": "/",
        "expires": 1782274539.766784,
        "httpOnly": true,
        "secure": true,
        "sameSite": "Lax"
    },
    {
        "name": "twid",
        "value": "PASTE_YOUR_TWID_VALUE_HERE",
        "domain": ".x.com",
        "path": "/",
        "expires": 1779250560.279798,
        "httpOnly": false,
        "secure": true,
        "sameSite": "None"
    },
    // Add more cookies as needed:
    // guest_id, guest_id_marketing, guest_id_ads, personalization_id, etc.
];

// Don't modify below this line
if (require.main === module) {
    console.log('🔄 Starting cookie extraction and auth renewal...\n');
    
    // Validate that cookies have been updated
    const hasPlaceholders = browserCookies.some(cookie => 
        cookie.value.includes('PASTE_YOUR_') || cookie.value.includes('_HERE')
    );
    
    if (hasPlaceholders) {
        console.log(`
❌ PLACEHOLDER VALUES DETECTED!

You need to replace the placeholder values with real cookies from x.com

STEP-BY-STEP INSTRUCTIONS:
1. Open Chrome/Safari and go to https://x.com
2. Make sure you're logged in to your Twitter account
3. Right-click anywhere → "Inspect Element" (or press F12)
4. Click the "Application" tab (Chrome) or "Storage" tab (Safari)
5. In the left sidebar, expand "Cookies" and click "x.com"
6. Find these important cookies and copy their values:
   - auth_token (MOST IMPORTANT)
   - ct0 (CSRF token)
   - kdt (session token) 
   - twid (user ID)

7. Paste the values in this file (extract-cookies.js) replacing the PASTE_YOUR_*_HERE placeholders
8. Run again: node extract-cookies.js

EXAMPLE of what you should see in browser:
Name: auth_token
Value: b4be7c19bf9f1c081f275efa8baf6e3a364ce0a9 (copy this value)
        `);
        process.exit(1);
    }
    
    try {
        const result = updateAuthWithBrowserCookies(browserCookies);
        console.log('\n✅ SUCCESS! Your authentication has been renewed.');
        console.log('\n📋 Next steps:');
        console.log('1. Copy the base64 string above');
        console.log('2. Update your AUTH_JSON_BASE64 environment variable');
        console.log('3. Test your bot to make sure it works');
        
    } catch (error) {
        console.error('❌ Error during cookie extraction:', error.message);
        console.log('\n🔧 Troubleshooting:');
        console.log('- Make sure all cookie values are correct');
        console.log('- Check that expiry dates are in Unix timestamp format');
        console.log('- Verify you copied from the right domain (x.com)');
    }
} 