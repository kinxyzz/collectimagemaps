import express from "express";
import mustache from "mustache";
import { readFileSync, readdirSync, statSync, rmSync } from "fs";
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

// Format folder: <query_slug>_<YYYYMMDD>_<timestamp>
// Pecah jadi queryLabel + dateFormatted
function parseSessionId(name) {
  const parts = name.split("_");
  let dateRaw = "";
  let querySlug = "";
  // 2 bagian terakhir = YYYYMMDD + unix timestamp panjang
  if (
    parts.length >= 3 &&
    /^\d{13,}$/.test(parts[parts.length - 1]) &&
    /^\d{8}$/.test(parts[parts.length - 2])
  ) {
    dateRaw = parts[parts.length - 2];
    querySlug = parts.slice(0, parts.length - 2).join("_");
  } else if (parts.length >= 2 && /^\d{8}$/.test(parts[0])) {
    // format lama: YYYYMMDD_timestamp
    dateRaw = parts[0];
    querySlug = "";
  }
  const dateFormatted =
    dateRaw.length === 8
      ? `${dateRaw.slice(0, 4)}-${dateRaw.slice(4, 6)}-${dateRaw.slice(6, 8)}`
      : name;
  const queryLabel = querySlug.replace(/_/g, " ").trim();
  return { dateFormatted, queryLabel };
}

// ---- HOME ----
app.get("/", (req, res) => {
  res.send(renderTemplate("home", { title: "Maps Photo Scraper" }));
});

// ---- SCRAPE ----
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
      localPath: p.localPath,
      highResUrl: p.highResUrl,
      originalUrl: p.url,
      sizeKB: (p.sizeBytes / 1024).toFixed(1),
      sizeBytes: p.sizeBytes,
      contentType: p.contentType,
    }));

    res.send(
      renderTemplate("results", {
        title: `Hasil: ${result.place?.name || query}`,
        query: result.query,
        sessionId: result.sessionId,
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

// ---- GALLERY: daftar semua folder ----
app.get("/gallery", (req, res) => {
  const baseDir = join(__dirname, "public", "images", "datescrape");

  let folders = [];
  try {
    folders = readdirSync(baseDir)
      .filter((name) => {
        try {
          return statSync(join(baseDir, name)).isDirectory();
        } catch {
          return false;
        }
      })
      .map((name) => {
        const folderPath = join(baseDir, name);
        let photoCount = 0;
        let totalBytes = 0;
        let previewImg = null;
        try {
          const files = readdirSync(folderPath).filter((f) =>
            /\.(jpg|jpeg|png|webp)$/i.test(f),
          );
          photoCount = files.length;
          files.forEach((f) => {
            try {
              totalBytes += statSync(join(folderPath, f)).size;
            } catch {}
          });
          if (files.length > 0)
            previewImg = `/images/datescrape/${name}/${files[0]}`;
        } catch {}

        const { dateFormatted, queryLabel } = parseSessionId(name);

        return {
          sessionId: name,
          dateFormatted,
          queryLabel,
          photoCount,
          totalMB: (totalBytes / (1024 * 1024)).toFixed(1),
          previewImg,
          isEmpty: photoCount === 0,
        };
      })
      .sort((a, b) => b.sessionId.localeCompare(a.sessionId));
  } catch {}

  res.send(
    renderTemplate("gallery", {
      title: "Galeri Scrape",
      folders,
      folderCount: folders.length,
      isEmpty: folders.length === 0,
    }),
  );
});

// ---- SESSION: foto dari satu folder ----
app.get("/gallery/:sessionId", (req, res) => {
  const { sessionId } = req.params;
  if (!/^[\w-]+$/.test(sessionId))
    return res.status(400).send("Session ID tidak valid.");

  const sessionDir = join(
    __dirname,
    "public",
    "images",
    "datescrape",
    sessionId,
  );

  let photos = [];
  try {
    const files = readdirSync(sessionDir)
      .filter((f) => /\.(jpg|jpeg|png|webp)$/i.test(f))
      .sort();
    photos = files.map((f, i) => {
      let sizeBytes = 0;
      try {
        sizeBytes = statSync(join(sessionDir, f)).size;
      } catch {}
      const ext = f.split(".").pop();
      return {
        index: i,
        filename: f,
        localPath: `/images/datescrape/${sessionId}/${f}`,
        sizeBytes,
        sizeKB: (sizeBytes / 1024).toFixed(1),
        contentType:
          ext === "png"
            ? "image/png"
            : ext === "webp"
              ? "image/webp"
              : "image/jpeg",
      };
    });
  } catch {
    return res.status(404).send("Folder tidak ditemukan.");
  }

  const { dateFormatted, queryLabel } = parseSessionId(sessionId);

  res.send(
    renderTemplate("session", {
      title: queryLabel
        ? `${queryLabel} — ${photos.length} foto`
        : `Sesi ${dateFormatted} — ${photos.length} foto`,
      sessionId,
      dateFormatted,
      queryLabel,
      totalPhotos: photos.length,
      photos: JSON.stringify(photos),
    }),
  );
});

// ---- DELETE SESSION ----
app.delete("/gallery/:sessionId", async (req, res) => {
  const { sessionId } = req.params;
  if (!/^[\w-]+$/.test(sessionId))
    return res.status(400).json({ error: "Session ID tidak valid." });

  const baseDir = join(__dirname, "public", "images", "datescrape");
  const sessionDir = join(baseDir, sessionId);
  const { resolve } = await import("path");
  if (!resolve(sessionDir).startsWith(resolve(baseDir))) {
    return res.status(400).json({ error: "Path tidak valid." });
  }

  try {
    statSync(sessionDir); // akan throw jika tidak ada
    rmSync(sessionDir, { recursive: true, force: true });
    res.json({ ok: true });
  } catch (err) {
    res.status(404).json({ error: "Folder tidak ditemukan." });
  }
});

// ---- PHOTO PROXY ----
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
