import express from "express";
import mustache from "mustache";
import { readFileSync } from "fs";
import { runScraper } from "./scraper.js";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(express.static(join(__dirname, "public")));

function renderTemplate(name, data = {}) {
  const tpl = readFileSync(
    join(__dirname, "views", `${name}.mustache`),
    "utf8",
  );
  const layout = readFileSync(
    join(__dirname, "views", "layout.mustache"),
    "utf8",
  );
  const body = mustache.render(tpl, data);
  return mustache.render(layout, { ...data, body });
}

app.get("/", (req, res) => {
  res.send(renderTemplate("home", { title: "Maps Photo Scraper" }));
});

app.post("/scrape", async (req, res) => {
  const { query, headless, scrollRounds } = req.body;

  if (!query || !query.trim()) {
    return res.send(
      renderTemplate("home", {
        title: "Maps Photo Scraper",
        error: "Query tidak boleh kosong.",
      }),
    );
  }

  try {
    const result = await runScraper(query.trim(), {
      headless: headless === "true",
      scrollRounds: parseInt(scrollRounds) || 25,
    });

    const photos = result.photos.map((p, i) => ({
      index: i,
      url: p.highResUrl,
      originalUrl: p.url,
      sizeKB: (p.sizeBytes / 1024).toFixed(1),
      sizeBytes: p.sizeBytes,
      contentType: p.contentType,
    }));

    res.send(
      renderTemplate("results", {
        title: `Hasil: ${result.place?.name || query}`,
        query: result.query,
        placeName: result.place?.name || "-",
        placeUrl: result.place?.url || "#",
        scrapedAt: new Date(result.scrapedAt).toLocaleString("id-ID"),
        totalCards: result.totalPhotoCards,
        totalNetwork: result.totalNetworkImages,
        totalPhotos: photos.length,
        photos: JSON.stringify(photos),
      }),
    );
  } catch (err) {
    console.error(err);
    res.send(
      renderTemplate("home", {
        title: "Maps Photo Scraper",
        error: `Scraping gagal: ${err.message}`,
        queryValue: query,
      }),
    );
  }
});

app.get("/photo-proxy", async (req, res) => {
  const { url } = req.query;
  if (!url) return res.status(400).send("URL required");

  try {
    const { default: https } = await import("https");
    const { default: http } = await import("http");
    const client = url.startsWith("https") ? https : http;

    client
      .get(url, { timeout: 20000 }, (upstream) => {
        res.setHeader(
          "Content-Type",
          upstream.headers["content-type"] || "image/jpeg",
        );
        res.setHeader(
          "Content-Disposition",
          `attachment; filename="photo.jpg"`,
        );
        upstream.pipe(res);
      })
      .on("error", (e) => res.status(500).send(e.message));
  } catch (e) {
    res.status(500).send(e.message);
  }
});

app.listen(PORT, () => {
  console.log(`Server berjalan di http://localhost:${PORT}`);
});
