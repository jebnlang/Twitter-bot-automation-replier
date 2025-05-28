#!/usr/bin/env node

/**
 * Railway Startup Script: Decode AUTH_JSON_BASE64 to auth.json
 * This script runs before the main application to create the auth.json file
 * from the base64 encoded environment variable.
 */

const fs = require('fs');
const path = require('path');

function decodeAuthFromEnv() {
  console.log('🔧 Railway Startup: Decoding AUTH_JSON_BASE64...');
  
  const base64Auth = process.env.AUTH_JSON_BASE64;
  
  if (!base64Auth) {
    console.error('❌ AUTH_JSON_BASE64 environment variable not found');
    console.log('💡 Make sure to set AUTH_JSON_BASE64 in Railway environment variables');
    process.exit(1);
  }
  
  try {
    // Decode base64 to JSON string
    const jsonString = Buffer.from(base64Auth, 'base64').toString('utf8');
    
    // Parse to validate JSON
    const authData = JSON.parse(jsonString);
    
    // Write to auth.json file
    const authPath = process.env.PLAYWRIGHT_STORAGE || 'auth.json';
    fs.writeFileSync(authPath, JSON.stringify(authData, null, 2));
    
    console.log(`✅ Successfully decoded auth.json to: ${authPath}`);
    console.log(`📊 Auth data contains ${authData.cookies?.length || 0} cookies`);
    
    // Verify critical auth tokens exist
    const cookies = authData.cookies || [];
    const hasAuthToken = cookies.some(c => c.name === 'auth_token');
    const hasCt0 = cookies.some(c => c.name === 'ct0');
    const hasTwid = cookies.some(c => c.name === 'twid');
    
    console.log(`🔑 Auth tokens present: auth_token=${hasAuthToken}, ct0=${hasCt0}, twid=${hasTwid}`);
    
    if (!hasAuthToken || !hasCt0 || !hasTwid) {
      console.warn('⚠️  Warning: Some critical auth tokens are missing. Authentication may fail.');
    }
    
  } catch (error) {
    console.error('❌ Failed to decode AUTH_JSON_BASE64:', error.message);
    console.log('💡 Check that the base64 string is valid and properly encoded');
    process.exit(1);
  }
}

// Only run if this script is executed directly (not imported)
if (require.main === module) {
  decodeAuthFromEnv();
}

module.exports = { decodeAuthFromEnv }; 