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
  
  let base64Auth = process.env.AUTH_JSON_BASE64;
  
  // If single AUTH_JSON_BASE64 doesn't exist, try multi-part approach
  if (!base64Auth) {
    console.log('🔍 Single AUTH_JSON_BASE64 not found, trying multi-part approach...');
    
    const parts = [];
    let partIndex = 1;
    
    while (true) {
      const partKey = `AUTH_JSON_BASE64_PART_${partIndex}`;
      const part = process.env[partKey];
      
      if (!part) {
        break;
      }
      
      console.log(`📦 Found ${partKey} with ${part.length} characters`);
      parts.push(part);
      partIndex++;
    }
    
    if (parts.length === 0) {
      console.error('❌ No AUTH_JSON_BASE64 or AUTH_JSON_BASE64_PART_X environment variables found');
      console.log('💡 Make sure to set AUTH_JSON_BASE64 or AUTH_JSON_BASE64_PART_1, AUTH_JSON_BASE64_PART_2, etc.');
      process.exit(1);
    }
    
    base64Auth = parts.join('');
    console.log(`🔗 Assembled ${parts.length} parts into ${base64Auth.length} character string`);
  }
  
  // Debug: Check base64 string length and format
  console.log(`📏 Base64 string length: ${base64Auth.length} characters`);
  console.log(`🔍 Base64 starts with: ${base64Auth.substring(0, 50)}...`);
  console.log(`🔍 Base64 ends with: ...${base64Auth.substring(base64Auth.length - 50)}`);
  
  try {
    // Decode base64 to JSON string
    const jsonString = Buffer.from(base64Auth, 'base64').toString('utf8');
    
    // Debug: Check decoded JSON string
    console.log(`📄 Decoded JSON length: ${jsonString.length} characters`);
    console.log(`🔍 JSON starts with: ${jsonString.substring(0, 100)}...`);
    
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
    
    // Additional debugging for JSON parse errors
    if (error.message.includes('JSON')) {
      try {
        const jsonString = Buffer.from(base64Auth, 'base64').toString('utf8');
        console.log(`🔍 Decoded string ends with: ...${jsonString.substring(jsonString.length - 100)}`);
      } catch (decodeError) {
        console.error('❌ Base64 decode also failed:', decodeError.message);
      }
    }
    
    process.exit(1);
  }
}

// Only run if this script is executed directly (not imported)
if (require.main === module) {
  decodeAuthFromEnv();
}

module.exports = { decodeAuthFromEnv }; 