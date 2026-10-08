/**
 * Renders the README images in docs/assets from this repo's own mock only:
 *   - social-preview.png   (1280x640, for the repo's social preview setting)
 *   - sample-html-report.png  (Playwright HTML report of the mock test run)
 *   - sample-trace-viewer.png (trace of the mock Intake UI test)
 *
 * Run after `CI=true npx playwright test` so playwright-report/ exists:
 *   npm run docs:assets
 */
import { chromium, type Page } from '@playwright/test';
import { createServer, type Server } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const REPO = fileURLToPath(new URL('..', import.meta.url));
const OUT = join(REPO, 'docs/assets');
const TYPES: Record<string, string> = {
  '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json',
  '.zip': 'application/zip', '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2', '.ttf': 'font/ttf',
};

class StaticServer {
  static start(root: string, port: number): Promise<Server> {
    const server = createServer(async (req, res) => {
      const path = normalize(decodeURIComponent(new URL(req.url ?? '/', 'http://local.invalid').pathname));
      try {
        const data = await readFile(join(root, path.endsWith('/') ? `${path}index.html` : path));
        res.writeHead(200, { 'Content-Type': TYPES[extname(path)] ?? 'application/octet-stream' });
        res.end(data);
      } catch {
        res.writeHead(404).end();
      }
    });
    return new Promise((resolve) => server.listen(port, '127.0.0.1', () => resolve(server)));
  }
}

class DocsAssets {
  static async socialPreview(page: Page): Promise<void> {
    const font = (w: number) => pathToFileURL(join(REPO, `node_modules/@fontsource/inter/files/inter-latin-${w}-normal.woff2`)).href;
    const banner = (await readFile(join(OUT, 'banner.svg'), 'utf8')).replace(/<\?xml[^>]*>/, '');
    await page.setViewportSize({ width: 1280, height: 640 });
    await page.setContent(`<!doctype html><html><head><style>
      @font-face { font-family: Inter; font-weight: 400; src: url(${font(400)}); }
      @font-face { font-family: Inter; font-weight: 700; src: url(${font(700)}); }
      body { margin: 0; width: 1280px; height: 640px; background: #0f2a4a; font-family: Inter, sans-serif; color: #fff;
             display: flex; flex-direction: column; justify-content: center; align-items: center; gap: 36px; }
      svg { width: 1160px; height: auto; }
      ul { display: flex; gap: 12px; list-style: none; padding: 0; margin: 0; font-size: 19px; }
      li { background: rgba(255,255,255,.12); border: 1px solid rgba(255,255,255,.35); padding: 9px 16px; border-radius: 999px; }
    </style></head><body>
      ${banner}
      <ul><li>Typed mock DX API v2</li><li>ETag / If-Match → 409</li><li>Role &amp; test-ID locators</li><li>Visual diffs</li><li>BGSTM REQ → TC</li></ul>
    </body></html>`);
    await page.evaluate(() => document.fonts.ready);
    await page.screenshot({ path: join(OUT, 'social-preview.png') });
  }

  static async reportAndTrace(page: Page): Promise<void> {
    const server = await StaticServer.start(join(REPO, 'playwright-report'), 9411);
    try {
      await page.setViewportSize({ width: 1280, height: 760 });
      await page.goto('http://127.0.0.1:9411/index.html');
      await page.getByText('TC-CLM-001').first().waitFor();
      await page.screenshot({ path: join(OUT, 'sample-html-report.png') });

      // Open the UI test, then its trace, and select the check that the claim reached Triage.
      await page.getByRole('link', { name: /TC-CLM-001/ }).first().click();
      await page.getByRole('link', { name: /View Trace/i }).first().click();
      await page.getByText("getByRole('status')", { exact: true }).first().click();
      await page.waitForTimeout(2000);
      await page.screenshot({ path: join(OUT, 'sample-trace-viewer.png') });
    } finally {
      server.close();
    }
  }

  static async main(): Promise<void> {
    const browser = await chromium.launch();
    try {
      const page = await browser.newPage({ deviceScaleFactor: 1 });
      await DocsAssets.socialPreview(page);
      await DocsAssets.reportAndTrace(page);
    } finally {
      await browser.close();
    }
    console.log('wrote docs/assets/social-preview.png, sample-html-report.png, sample-trace-viewer.png');
  }
}

await DocsAssets.main();
