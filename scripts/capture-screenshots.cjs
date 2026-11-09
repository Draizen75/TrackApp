const fs = require('node:fs');
const path = require('node:path');
const { chromium, devices } = require('playwright');

const baseURL = process.env.TRACKAPP_SCREENSHOT_URL || 'http://127.0.0.1:8081';
const outputRoot = path.resolve(process.env.TRACKAPP_SCREENSHOT_DIR || 'artifacts/screenshots');
const routes = [
  { name: 'dashboard', label: 'Dashboard' },
  { name: 'quick-entry', label: 'Quick Entry' },
  { name: 'debtors', label: 'Debtors' },
  { name: 'history', label: 'History' },
  { name: 'settings', label: 'Settings' },
];

async function waitForScreen(page) {
  await page.waitForLoadState('domcontentloaded');
  await page.waitForTimeout(900);
  await page.evaluate(() => window.scrollTo(0, 0));
}

async function captureViewport(browser, name, viewport) {
  const context = await browser.newContext({
    viewport,
    deviceScaleFactor: 1,
    isMobile: viewport.width < 600,
    hasTouch: viewport.width < 600,
    colorScheme: 'dark',
  });
  const page = await context.newPage();
  await page.goto(baseURL, { waitUntil: 'domcontentloaded', timeout: 120000 });
  await waitForScreen(page);

  const destination = path.join(outputRoot, name);
  fs.mkdirSync(destination, { recursive: true });

  for (const route of routes) {
    const tab = page.getByText(route.label, { exact: true }).first();
    await tab.waitFor({ state: 'visible', timeout: 30000 });
    await tab.click();
    await waitForScreen(page);

    await page.screenshot({
      path: path.join(destination, route.name + '.png'),
      fullPage: true,
      animations: 'disabled',
    });
    console.log('Captured ' + name + '/' + route.name);
  }

  await context.close();
}

(async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    await captureViewport(browser, 'desktop', { width: 1440, height: 1000 });
    await captureViewport(browser, 'mobile', { width: 390, height: 844 });
  } finally {
    await browser.close();
  }
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
