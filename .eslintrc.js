module.exports = {
  root: true,
  parser: '@typescript-eslint/parser',
  plugins: [
    '@typescript-eslint',
  ],
  extends: [
    'eslint:recommended',
    'plugin:@typescript-eslint/recommended',
  ],
  env: {
    node: true,
    es2021: true,
    jest: true, // If you're using Jest for testing
  },
  parserOptions: {
    ecmaVersion: 12,
    sourceType: 'module',
  },
  rules: {
    // You can add custom rules here, for example:
    // '@typescript-eslint/no-unused-vars': ['warn', { 'argsIgnorePattern': '^_' }],
    // 'no-console': 'warn', // Example: warn about console.log statements
  },
  ignorePatterns: ["dist/", "node_modules/", "*.js"] // Ignore JS files in root (like this one, package.json etc), dist and node_modules
}; 