import { writeSystemLog } from "../system/system-log.js";
import { getDatabase } from "../db/database.js";

// Video URL patterns to detect
const VIDEO_URL_PATTERNS = [
  /https?:\/\/[^"'\s]*\.(mp4|webm|mkv|mov|avi|flv|wmv|m4v|ts|m3u8|mpd)[^"'\s]*/gi,
  /https?:\/\/[^"'\s]*video[^"'\s]*\.(mp4|webm|mkv|mov|avi|flv|wmv|m4v|ts|m3u8|mpd)[^"'\s]*/gi,
  /https?:\/\/[^"'\s]*\/v\/[^"'\s]*\.(mp4|webm|mkv|mov|avi|flv|wmv|m4v|ts|m3u8|mpd)[^"'\s]*/gi,
  /src=["']([^"']*?\.(mp4|webm|mkv|mov|avi|flv|wmv|m4v|ts|m3u8|mpd))["']/gi,
  /data-src=["']([^"']*?\.(mp4|webm|mkv|mov|avi|flv|wmv|m4v|ts|m3u8|mpd))["']/gi,
  /url=["']([^"']*?\.(mp4|webm|mkv|mov|avi|flv|wmv|m4v|ts|m3u8|mpd))["']/gi,
];

// Human-like delay range (in ms)
const MIN_DELAY_MS = 500;
const MAX_DELAY_MS = 2000;

// Random mouse movement range
const MOUSE_MOVE_RANGE = 50;

/**
 * Generate a random delay for human-like behavior
 */
function getRandomDelay(): number {
  return Math.floor(Math.random() * (MAX_DELAY_MS - MIN_DELAY_MS + 1)) + MIN_DELAY_MS;
}

/**
 * Generate random mouse movement coordinates
 */
function getRandomMouseOffset(): { x: number; y: number } {
  return {
    x: Math.floor(Math.random() * MOUSE_MOVE_RANGE * 2) - MOUSE_MOVE_RANGE,
    y: Math.floor(Math.random() * MOUSE_MOVE_RANGE * 2) - MOUSE_MOVE_RANGE
  };
}

/**
 * Sleep for a given number of milliseconds
 */
function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Extract video URLs from HTML content
 */
function extractVideoUrls(html: string): string[] {
  const urls = new Set<string>();
  
  for (const pattern of VIDEO_URL_PATTERNS) {
    const matches = html.match(pattern);
    if (matches) {
      matches.forEach(url => {
        // Clean up the URL
        const cleanUrl = url.replace(/["']/g, '').trim();
        if (cleanUrl && cleanUrl.length > 10) {
          urls.add(cleanUrl);
        }
      });
    }
  }
  
  return Array.from(urls);
}

/**
 * Run scraping with Puppeteer
 */
export async function runScraping(config: any): Promise<{ videoUrls: string[]; actions: any[] }> {
  const { id, name, url, cloudflare } = config;
  
  writeSystemLog("info", "scraping", `Starting scraping for: ${name} (${url})`, { id, cloudflare });
  
  const results: string[] = [];
  const actions: any[] = [];
  
  try {
    // Import Puppeteer dynamically
    const puppeteer = await import('puppeteer');
    
    // Launch browser with options for scraping
    const browser = await puppeteer.launch({
      headless: true,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu',
        '--disable-extensions',
        '--disable-background-networking',
        '--disable-sync',
        '--disable-translate',
        '--metrics-recording-only',
        '--no-first-run',
        '--safebrowsing-disable-auto-update',
        '--enable-automation',
        '--password-store=basic',
        '--use-mock-keychain',
      ]
    });
    
    const page = await browser.newPage();
    
    // Set a realistic user agent
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
    
    // Set viewport
    await page.setViewport({ width: 1920, height: 1080 });
    
    // Handle Cloudflare if needed
    if (cloudflare) {
      writeSystemLog("info", "scraping", "Cloudflare protection enabled, waiting for manual interaction or solving...", { id });
      // For Cloudflare, we need to wait for the user to solve it
      // In a real implementation, this would use a Cloudflare bypass service
    }
    
    // Navigate to the URL
    writeSystemLog("info", "scraping", `Navigating to: ${url}`, { id });
    await page.goto(url, { waitUntil: 'networkidle2', timeout: 60000 });
    
    // Wait for page to load
    await sleep(getRandomDelay());
    
    // Get initial HTML content
    const initialHtml = await page.content();
    const initialUrls = extractVideoUrls(initialHtml);
    initialUrls.forEach(url => results.push(url));
    
    // Get all clickable elements
    const clickableElements = await page.$$('a, button, [role="button"], [onclick], [tabindex]');
    
    writeSystemLog("info", "scraping", `Found ${clickableElements.length} clickable elements`, { id });
    
    // Record actions for each clickable element
    for (let i = 0; i < Math.min(clickableElements.length, 20); i++) {
      const element = clickableElements[i];
      if (!element) continue;
      
      try {
        // Get element position
        const box = await element.boundingBox();
        if (box) {
          const { x, y, width, height } = box;
          
          // Add human-like delay
          await sleep(getRandomDelay());
          
          // Move mouse randomly
          const offset = getRandomMouseOffset();
          await page.mouse.move(x + width / 2 + offset.x, y + height / 2 + offset.y);
          
          // Click the element
          await element.click();
          
          // Wait for navigation
          await sleep(getRandomDelay());
          
          // Get new HTML content
          const newHtml = await page.content();
          const newUrls = extractVideoUrls(newHtml);
          newUrls.forEach(url => {
            if (!results.includes(url)) {
              results.push(url);
            }
          });
          
          // Record the action
          actions.push({
            type: 'click',
            selector: `element-${i}`,
            x: Math.floor(x),
            y: Math.floor(y),
            timestamp: new Date().toISOString()
          });
          
          // Go back if we're not on the original page
          if (page.url() !== url) {
            await page.goBack({ waitUntil: 'networkidle2', timeout: 30000 });
            await sleep(getRandomDelay());
          }
        }
      } catch (error: any) {
        writeSystemLog("warn", "scraping", `Error clicking element ${i}: ${error.message}`, { id });
        continue;
      }
    }
    
    // Take a screenshot for debugging
    try {
      await page.screenshot({ path: `/tmp/scraping-${id}.png`, fullPage: true });
    } catch (e: any) {
      // Ignore screenshot errors
    }
    
    await browser.close();
    
    writeSystemLog("info", "scraping", `Scraping completed. Found ${results.length} video URLs`, { id });
    
    // Save results to database
    const db = getDatabase();
    for (const videoUrl of results) {
      db.prepare("INSERT INTO scraping_results (id, config_id, video_url, created_at) VALUES (?, ?, ?, ?)").run(
        crypto.randomUUID(),
        id,
        videoUrl,
        new Date().toISOString()
      );
    }
    
    return { videoUrls: results, actions };
    
  } catch (error: any) {
    writeSystemLog("error", "scraping", `Scraping failed: ${error.message}`, { id, error: error.stack });
    throw new Error(`Scraping failed: ${error.message}`);
  }
}

/**
 * Get scraping results for a config
 */
export function getScrapingResults(configId: string): { id: string; videoUrl: string; createdAt: string }[] {
  const db = getDatabase();
  return db.prepare("SELECT * FROM scraping_results WHERE config_id = ? ORDER BY created_at DESC").all(configId) as any[];
}

/**
 * Clear scraping results for a config
 */
export function clearScrapingResults(configId: string): void {
  const db = getDatabase();
  db.prepare("DELETE FROM scraping_results WHERE config_id = ?").run(configId);
}
