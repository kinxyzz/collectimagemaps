import puppeteer from "puppeteer-extra";
import StealthPlugin from "puppeteer-extra-plugin-stealth";
import https from "https";
import http from "http";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { dirname } from "path";

const __dirname = dirname(fileURLToPath(import.meta.url));

puppeteer.use(StealthPlugin());

const DEFAULT_CONFIG = {
  headless: false,
  slowMo: 40,
  navigationTimeout: 60000,
  scrollRounds: 25,
  minPhotoSizeBytes: 50 * 1024,
  fetchConcurrency: 10,
};

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function looksLikeMapPhoto(url) {
  if (!url) return false;
  return /googleusercontent|ggpht|gstatic/i.test(url);
}

function toHighResUrl(url) {
  return url.replace(/=s\d+.*$|=w\d+.*$/, "=s1600");
}

function fetchImage(url, minBytes) {
  return new Promise((resolve) => {
    const client = url.startsWith("https") ? https : http;
    const req = client.get(url, { timeout: 15000 }, (res) => {
      if (res.statusCode !== 200) {
        res.resume();
        return resolve(null);
      }
      const contentLength = parseInt(res.headers["content-length"] || "0", 10);
      if (contentLength > 0 && contentLength < minBytes) {
        res.resume();
        return resolve(null);
      }
      const chunks = [];
      res.on("data", (chunk) => chunks.push(chunk));
      res.on("end", () => {
        const buffer = Buffer.concat(chunks);
        if (buffer.length < minBytes) return resolve(null);
        resolve({
          buffer,
          contentType: res.headers["content-type"] || "image/jpeg",
          sizeBytes: buffer.length,
        });
      });
      res.on("error", () => resolve(null));
    });
    req.on("error", () => resolve(null));
    req.on("timeout", () => {
      req.destroy();
      resolve(null);
    });
  });
}

async function pLimit(tasks, concurrency) {
  const results = [];
  let index = 0;
  async function worker() {
    while (index < tasks.length) {
      const i = index++;
      results[i] = await tasks[i]();
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(concurrency, tasks.length) }, worker),
  );
  return results;
}

async function clickConsentIfAny(page) {
  const selectors = [
    'button[aria-label="Accept all"]',
    'button[aria-label="I agree"]',
    'button[aria-label="Terima semua"]',
    'button[aria-label="Saya setuju"]',
  ];
  for (const selector of selectors) {
    const btn = await page.$(selector);
    if (btn) {
      await btn.click();
      await delay(3000);
      return true;
    }
  }
  return false;
}

async function openTopPlace(page, query, navigationTimeout) {
  await page.goto(
    `https://www.google.com/maps/search/${encodeURIComponent(query)}`,
    { waitUntil: "networkidle2", timeout: navigationTimeout },
  );
  await delay(5000);
  await clickConsentIfAny(page);
  const isDirectPlace =
    page.url().includes("/maps/place/") && (await page.$("h1")) !== null;
  if (!isDirectPlace) {
    const firstResultSelector = 'div[role="feed"] a[href*="/maps/place/"]';
    await page.waitForSelector(firstResultSelector, { timeout: 20000 });
    const first = await page.$(firstResultSelector);
    if (!first) throw new Error("Top place not found");
    await first.click();
    await page.waitForSelector("h1", { timeout: 25000 });
    await delay(5000);
  }
  return await page.evaluate(() => ({
    name: document.querySelector("h1")?.textContent?.trim() || null,
    url: location.href,
  }));
}

async function openGallery(page) {
  const selectors = [
    'button[jsaction*="heroHeaderImage"]',
    'button[jsaction*="galleryHeaderImage"]',
    'button[aria-label*="photo"]',
    'button[aria-label*="Photo"]',
    'button[aria-label*="foto"]',
    'button[aria-label*="Foto"]',
    'img[src*="googleusercontent"]',
  ];
  for (const selector of selectors) {
    const el = await page.$(selector);
    if (el) {
      await el.click();
      await delay(5000);
      return true;
    }
  }
  return false;
}

async function clickAllTab(page) {
  const selectors = [
    'button[data-carousel-index="0"]',
    'button[aria-label="All"]',
    'button[aria-label="Semua"]',
    'button[jsaction*="carousel.photo"]',
  ];
  for (const selector of selectors) {
    const btn = await page.$(selector);
    if (btn) {
      await btn.click();
      await delay(3000);
      return true;
    }
  }
  return false;
}

async function waitForPhotoCards(page) {
  await page.waitForFunction(
    () => document.querySelectorAll("a[data-photo-index]").length > 0,
    { timeout: 20000 },
  );
}

async function findScrollableLeftPanel(page) {
  const handle = await page.evaluateHandle(() => {
    const cards = [...document.querySelectorAll("a[data-photo-index]")];
    if (!cards.length) return null;
    let el = cards[0].parentElement;
    while (el) {
      const style = window.getComputedStyle(el);
      const oy = style.overflowY;
      if (
        (oy === "auto" || oy === "scroll" || oy === "hidden") &&
        el.scrollHeight > el.clientHeight
      )
        return el;
      el = el.parentElement;
    }
    return null;
  });
  const element = handle.asElement();
  if (!element) throw new Error("Scrollable left panel not found");
  return element;
}

/**
 * Buat folder untuk sesi scrape ini di public/images/datescrape/<sessionId>
 */
function createSessionDir(sessionId) {
  const baseDir = path.join(__dirname, "public", "images", "datescrape");
  const sessionDir = path.join(baseDir, sessionId);
  fs.mkdirSync(sessionDir, { recursive: true });
  return sessionDir;
}

/**
 * Simpan buffer gambar ke disk, return path relatif dari public/ untuk dipakai di <img src>
 */
function saveImageToDisk(buffer, contentType, index, sessionDir, sessionId) {
  const ext = (contentType || "image/jpeg").split("/")[1]?.replace("jpeg", "jpg") || "jpg";
  const filename = `photo-${String(index).padStart(4, "0")}.${ext}`;
  const fullPath = path.join(sessionDir, filename);
  fs.writeFileSync(fullPath, buffer);
  // path yang dipakai di <img src="/images/datescrape/...">
  return `/images/datescrape/${sessionId}/${filename}`;
}

export async function runScraper(query, options = {}) {
  const config = { ...DEFAULT_CONFIG, ...options };
  const log = (msg) => {
    if (typeof config.onProgress === "function") config.onProgress(msg);
  };

  // Buat session ID: <query_slug>_<YYYYMMDD>_<timestamp>
  const now = new Date();
  const dateStr = now.toISOString().slice(0, 10).replace(/-/g, "");
  const timeStr = now.getTime();
  const querySlug = query
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/gi, "_")   // spasi & karakter non-alphanumeric → _
    .replace(/^_+|_+$/g, "")        // trim underscore di awal/akhir
    .slice(0, 40);                  // batasi panjang
  const sessionId = `${querySlug}_${dateStr}_${timeStr}`;
  const sessionDir = createSessionDir(sessionId);

  const browser = await puppeteer.launch({
    headless: config.headless,
    slowMo: config.slowMo,
    defaultViewport: null,
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--lang=en-US,en",
      "--window-size=1536,864",
    ],
  });

  const page = await browser.newPage();
  page.setDefaultNavigationTimeout(config.navigationTimeout);
  page.setDefaultTimeout(30000);
  await page.setUserAgent(
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  );

  const networkPhotos = new Map();
  page.on("request", (request) => {
    const url = request.url();
    if (request.resourceType() === "image" && looksLikeMapPhoto(url)) {
      if (!networkPhotos.has(url))
        networkPhotos.set(url, { url, source: "request" });
    }
  });
  page.on("response", async (response) => {
    try {
      const url = response.url();
      const type = response.request().resourceType();
      const headers = response.headers();
      if (type === "image" && looksLikeMapPhoto(url)) {
        const existing = networkPhotos.get(url) || { url, source: "response" };
        networkPhotos.set(url, {
          ...existing,
          contentType: headers["content-type"] || existing.contentType || null,
          status: response.status(),
        });
      }
    } catch {}
  });

  try {
    log("Membuka Google Maps...");
    const place = await openTopPlace(page, query, config.navigationTimeout);
    log(`Tempat ditemukan: ${place.name}`);
    log("Membuka galeri foto...");
    const openedGallery = await openGallery(page);
    if (!openedGallery) throw new Error("Galeri tidak bisa dibuka");
    log("Memilih tab semua foto...");
    await clickAllTab(page);
    log("Menunggu kartu foto muncul...");
    await waitForPhotoCards(page);
    log("Mencari panel scroll...");
    const panelHandle = await findScrollableLeftPanel(page);
    log("Mulai scroll untuk memuat semua foto...");
    for (let i = 0; i < config.scrollRounds; i++) {
      const state = await page.evaluate(async (el) => {
        const before = el.scrollTop;
        const beforeCount = document.querySelectorAll(
          "a[data-photo-index]",
        ).length;
        el.scrollBy(0, 1200);
        await new Promise((r) => setTimeout(r, 1200));
        return {
          moved: el.scrollTop > before,
          beforeCount,
          afterCount: document.querySelectorAll("a[data-photo-index]").length,
        };
      }, panelHandle);
      await delay(1000);
      log(
        `Scroll ${i + 1}/${config.scrollRounds} — kartu: ${state.afterCount}, network: ${networkPhotos.size}`,
      );
      if (!state.moved && state.afterCount === state.beforeCount && i > 3) {
        log("Tidak ada konten baru, scroll dihentikan.");
        break;
      }
    }
    await delay(3000);
    const totalPhotoCards = await page
      .$$eval("a[data-photo-index]", (els) => els.length)
      .catch(() => 0);
    const allUrls = [...networkPhotos.keys()];
    log(
      `Total URL foto terkumpul: ${allUrls.length}. Mulai filter ukuran >50KB...`,
    );
    let fetched = 0;
    const tasks = allUrls.map((originalUrl, taskIndex) => async () => {
      const highResUrl = toHighResUrl(originalUrl);
      const result = await fetchImage(highResUrl, config.minPhotoSizeBytes);
      fetched++;
      if (fetched % 10 === 0)
        log(`Mengecek ukuran foto: ${fetched}/${allUrls.length}...`);
      if (!result) return null;

      // Simpan gambar ke disk
      const localPath = saveImageToDisk(
        result.buffer,
        result.contentType,
        taskIndex,
        sessionDir,
        sessionId,
      );

      return {
        url: originalUrl,
        highResUrl,
        localPath,         // path untuk <img src>
        sizeBytes: result.sizeBytes,
        contentType: result.contentType,
      };
    });
    const fetchResults = await pLimit(tasks, config.fetchConcurrency);
    const photos = fetchResults.filter(Boolean);
    log(
      `Selesai! ${photos.length} foto lolos filter >50KB dari ${allUrls.length} total.`,
    );
    return {
      query,
      scrapedAt: new Date().toISOString(),
      sessionId,
      place,
      totalPhotoCards,
      totalNetworkImages: allUrls.length,
      photos,
    };
  } finally {
    await browser.close();
  }
}
