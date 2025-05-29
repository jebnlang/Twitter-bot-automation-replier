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
Object.defineProperty(exports, "__esModule", { value: true });
exports.getAuthState = getAuthState;
exports.cleanupTempAuth = cleanupTempAuth;
exports.validateAuthState = validateAuthState;
exports.getBase64AuthString = getBase64AuthString;
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
/**
 * Gets the authentication state for Playwright
 * Priority: AUTH_JSON_BASE64 env var > local auth.json file
 */
async function getAuthState() {
    const AUTH_JSON_BASE64 = process.env.AUTH_JSON_BASE64;
    const PLAYWRIGHT_STORAGE = process.env.PLAYWRIGHT_STORAGE || 'auth.json';
    // If we have base64 auth data in environment variable, use that (production)
    if (AUTH_JSON_BASE64) {
        console.log('🔐 Using AUTH_JSON_BASE64 environment variable for authentication');
        try {
            // Decode base64 and write to temporary file
            const authData = Buffer.from(AUTH_JSON_BASE64, 'base64').toString('utf8');
            const tempAuthPath = path.join(process.cwd(), 'temp_auth.json');
            // Validate that it's valid JSON
            JSON.parse(authData);
            // Write to temporary file
            await fs.promises.writeFile(tempAuthPath, authData, 'utf8');
            console.log('✅ Successfully decoded and saved authentication data to temp file');
            return tempAuthPath;
        }
        catch (error) {
            console.error('❌ Error decoding AUTH_JSON_BASE64:', error);
            throw new Error('Invalid AUTH_JSON_BASE64 environment variable');
        }
    }
    // Fall back to local auth.json file (development)
    if (fs.existsSync(PLAYWRIGHT_STORAGE)) {
        console.log(`🔐 Using local authentication file: ${PLAYWRIGHT_STORAGE}`);
        return PLAYWRIGHT_STORAGE;
    }
    // No authentication available
    throw new Error('No authentication available. Please either:\n' +
        '1. Set AUTH_JSON_BASE64 environment variable, or\n' +
        '2. Ensure auth.json file exists locally');
}
/**
 * Cleans up temporary authentication files
 */
async function cleanupTempAuth() {
    const tempAuthPath = path.join(process.cwd(), 'temp_auth.json');
    try {
        if (fs.existsSync(tempAuthPath)) {
            await fs.promises.unlink(tempAuthPath);
            console.log('🧹 Cleaned up temporary authentication file');
        }
    }
    catch (error) {
        console.warn('⚠️ Warning: Could not clean up temporary auth file:', error);
    }
}
/**
 * Validates that authentication data contains required fields
 */
function validateAuthState(authData) {
    try {
        const parsed = JSON.parse(authData);
        // Check for required structure
        if (!parsed.cookies || !Array.isArray(parsed.cookies)) {
            return false;
        }
        // Check for essential Twitter cookies
        const requiredCookies = ['auth_token', 'ct0'];
        const cookieNames = parsed.cookies.map(cookie => cookie.name);
        for (const required of requiredCookies) {
            if (!cookieNames.includes(required)) {
                console.warn(`⚠️ Missing required cookie: ${required}`);
                return false;
            }
        }
        return true;
    }
    catch (error) {
        console.error('❌ Invalid authentication data format:', error);
        return false;
    }
}
/**
 * Gets your base64 authentication string for environment variable setup
 */
function getBase64AuthString() {
    const PLAYWRIGHT_STORAGE = process.env.PLAYWRIGHT_STORAGE || 'auth.json';
    if (!fs.existsSync(PLAYWRIGHT_STORAGE)) {
        throw new Error(`Authentication file not found: ${PLAYWRIGHT_STORAGE}`);
    }
    try {
        const authData = fs.readFileSync(PLAYWRIGHT_STORAGE, 'utf8');
        // Validate the auth data
        if (!validateAuthState(authData)) {
            throw new Error('Invalid authentication data in file');
        }
        const base64String = Buffer.from(authData, 'utf8').toString('base64');
        console.log('✅ Generated base64 authentication string');
        return base64String;
    }
    catch (error) {
        console.error('❌ Error generating base64 auth string:', error);
        throw error;
    }
}
