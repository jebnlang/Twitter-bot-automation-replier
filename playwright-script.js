const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({
    headless: false
  });
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto('https://x.com/i/flow/login');
  await page.locator('label div').nth(3).click();
  await page.getByRole('textbox', { name: 'Phone, email, or username' }).fill('telepromptai@gmail.com');
  await page.getByRole('button', { name: 'Next' }).click();
  await page.getByRole('textbox', { name: 'Password Reveal password' }).fill('Xb5&#y&$EMxxZ\'c');
  await page.getByTestId('LoginForm_Login_Button').click();

  // ---------------------
  await context.storageState({ path: 'auth.json' });
  await context.close();
  await browser.close();
})();