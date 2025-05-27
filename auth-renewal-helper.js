const fs = require('fs');

/**
 * Auth Renewal Helper for Twitter Bot
 * 
 * This script helps you:
 * 1. Convert browser cookies to Playwright auth.json format
 * 2. Encode auth.json to base64 for environment variables
 * 3. Update your authentication
 */

function convertCookiesToAuthJson(cookies) {
    return {
        cookies: cookies,
        origins: []
    };
}

function encodeAuthToBase64(authJson) {
    const jsonString = JSON.stringify(authJson, null, 2);
    return Buffer.from(jsonString).toString('base64');
}

function decodeBase64ToAuth(base64String) {
    const jsonString = Buffer.from(base64String, 'base64').toString('utf8');
    return JSON.parse(jsonString);
}

// Example usage with browser cookies
function exampleBrowserCookieFormat() {
    console.log(`
=== BROWSER COOKIE FORMAT EXAMPLE ===

When you extract cookies from browser inspector, format them like this:

const browserCookies = [
    {
        "name": "auth_token",
        "value": "your_auth_token_value",
        "domain": ".x.com",
        "path": "/",
        "expires": 1782274539.766847,
        "httpOnly": true,
        "secure": true,
        "sameSite": "None"
    },
    {
        "name": "ct0",
        "value": "your_ct0_value", 
        "domain": ".x.com",
        "path": "/",
        "expires": 1782274540.116643,
        "httpOnly": false,
        "secure": true,
        "sameSite": "Lax"
    },
    // ... add all other important cookies
];

// Key cookies you need:
// - auth_token (most important)
// - ct0 (CSRF token)
// - kdt (session token)
// - twid (user ID)
// - guest_id, guest_id_marketing, guest_id_ads
// - personalization_id

Then use: updateAuthWithBrowserCookies(browserCookies);
    `);
}

function updateAuthWithBrowserCookies(browserCookies) {
    try {
        // Convert to Playwright format
        const authJson = convertCookiesToAuthJson(browserCookies);
        
        // Save to auth.json
        fs.writeFileSync('auth.json', JSON.stringify(authJson, null, 2));
        console.log('✅ auth.json updated successfully');
        
        // Generate base64
        const base64String = encodeAuthToBase64(authJson);
        console.log('\n=== BASE64 STRING FOR ENVIRONMENT VARIABLE ===');
        console.log('Set AUTH_JSON_BASE64 to:');
        console.log(base64String);
        console.log('\n=== COPY THIS TO YOUR .env OR RAILWAY ENVIRONMENT ===');
        
        return { authJson, base64String };
        
    } catch (error) {
        console.error('❌ Error updating auth:', error.message);
        throw error;
    }
}

function validateCurrentAuth() {
    try {
        if (!fs.existsSync('auth.json')) {
            console.log('❌ auth.json not found');
            return false;
        }
        
        const authContent = fs.readFileSync('auth.json', 'utf8');
        const auth = JSON.parse(authContent);
        
        console.log('\n=== CURRENT AUTH.JSON ANALYSIS ===');
        console.log(`Number of cookies: ${auth.cookies?.length || 0}`);
        
        if (auth.cookies) {
            const importantCookies = ['auth_token', 'ct0', 'kdt', 'twid'];
            const foundCookies = [];
            
            auth.cookies.forEach(cookie => {
                if (importantCookies.includes(cookie.name)) {
                    foundCookies.push(cookie.name);
                    const expires = new Date(cookie.expires * 1000);
                    const isExpired = expires < new Date();
                    console.log(`${cookie.name}: ${isExpired ? '❌ EXPIRED' : '✅ Valid'} (expires: ${expires.toISOString()})`);
                }
            });
            
            const missingCookies = importantCookies.filter(name => !foundCookies.includes(name));
            if (missingCookies.length > 0) {
                console.log(`❌ Missing important cookies: ${missingCookies.join(', ')}`);
            }
        }
        
        return true;
        
    } catch (error) {
        console.error('❌ Error validating auth:', error.message);
        return false;
    }
}

function generateCurrentBase64() {
    try {
        if (!fs.existsSync('auth.json')) {
            console.log('❌ auth.json not found');
            return;
        }
        
        const authContent = fs.readFileSync('auth.json', 'utf8');
        const auth = JSON.parse(authContent);
        const base64String = encodeAuthToBase64(auth);
        
        console.log('\n=== CURRENT AUTH.JSON AS BASE64 ===');
        console.log(base64String);
        
        return base64String;
        
    } catch (error) {
        console.error('❌ Error generating base64:', error.message);
    }
}

// Command line interface
if (require.main === module) {
    const command = process.argv[2];
    
    switch (command) {
        case 'validate':
            validateCurrentAuth();
            break;
            
        case 'base64':
            generateCurrentBase64();
            break;
            
        case 'example':
            exampleBrowserCookieFormat();
            break;
            
        case 'help':
        default:
            console.log(`
=== Twitter Bot Auth Renewal Helper ===

Commands:
  validate  - Check current auth.json status
  base64    - Generate base64 from current auth.json
  example   - Show browser cookie format example

Usage Examples:
  node auth-renewal-helper.js validate
  node auth-renewal-helper.js base64
  node auth-renewal-helper.js example

Manual Cookie Update Process:
1. Open browser inspector on x.com
2. Copy cookies in the format shown by 'example' command
3. Create a script to call updateAuthWithBrowserCookies(cookies)
4. Use the generated base64 in your environment variables
            `);
    }
}

module.exports = {
    convertCookiesToAuthJson,
    encodeAuthToBase64,
    decodeBase64ToAuth,
    updateAuthWithBrowserCookies,
    validateCurrentAuth,
    generateCurrentBase64
}; 