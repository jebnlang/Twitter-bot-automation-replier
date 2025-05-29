const { getAuthState, cleanupTempAuth } = require('./dist/auth-utils');

async function testAuthLocal() {
  console.log('🧪 Testing local auth.json authentication...');
  
  // Remove AUTH_JSON_BASE64 to force using local file
  delete process.env.AUTH_JSON_BASE64;
  
  try {
    const authPath = await getAuthState();
    console.log('✅ Successfully got auth state path:', authPath);
    
    // Check if the file exists and has content
    const fs = require('fs');
    if (fs.existsSync(authPath)) {
      const content = fs.readFileSync(authPath, 'utf8');
      const authData = JSON.parse(content);
      console.log('✅ Auth file contains', authData.cookies?.length || 0, 'cookies');
      console.log('✅ Has auth_token:', authData.cookies?.some(c => c.name === 'auth_token') || false);
      console.log('✅ Has ct0:', authData.cookies?.some(c => c.name === 'ct0') || false);
    }
    
    console.log('🎉 Local auth test PASSED!');
  } catch (error) {
    console.error('❌ Local auth test FAILED:', error.message);
  }
}

async function testBase64Generation() {
  console.log('\n🧪 Testing base64 generation...');
  
  try {
    const fs = require('fs');
    const authData = fs.readFileSync('auth.json', 'utf8');
    const base64 = Buffer.from(authData).toString('base64');
    
    console.log('✅ Generated base64 string (length:', base64.length, ')');
    
    // Test decoding
    const decoded = Buffer.from(base64, 'base64').toString('utf8');
    const parsedData = JSON.parse(decoded);
    
    console.log('✅ Base64 decode/parse successful');
    console.log('✅ Decoded contains', parsedData.cookies?.length || 0, 'cookies');
    
    // Save the working base64 for Railway
    console.log('\n📋 **COPY THIS BASE64 FOR RAILWAY:**');
    console.log(base64);
    
    console.log('\n🎉 Base64 generation test PASSED!');
  } catch (error) {
    console.error('❌ Base64 generation test FAILED:', error.message);
  }
}

async function runTests() {
  await testAuthLocal();
  await testBase64Generation();
}

runTests(); 