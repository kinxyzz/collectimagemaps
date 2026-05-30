# Google Maps Scraper Bot — Panduan Instalasi

## Prasyarat

- Sistem operasi: Windows 10/11, macOS, atau Linux
- Koneksi internet

---

## 1. Install Node.js

### Windows / macOS

1. Buka https://nodejs.org
2. Download versi **LTS** (Long Term Support)
3. Jalankan installer, ikuti langkah-langkahnya (Next → Next → Install)
4. Setelah selesai, buka **Terminal** (macOS) atau **Command Prompt / PowerShell** (Windows)
5. Verifikasi instalasi:
   ```bash
   node -v
   npm -v
   ```
   Harus muncul versi, contoh: `v20.11.0` dan `10.2.4`

### Ubuntu / Debian (Linux)

```bash
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs
node -v && npm -v
```

---

## 2. Buat Folder Project

```bash
mkdir maps-scraper-bot
cd maps-scraper-bot
```

---

## 3. Inisialisasi Project

```bash
npm init -y
```

Lalu aktifkan ES Module (karena kode menggunakan `import`), edit `package.json` dan tambahkan `"type": "module"`:

```json
{
  "name": "maps-scraper-bot",
  "version": "1.0.0",
  "type": "module",
  ...
}
```

---

## 4. Install Dependencies

```bash
npm install telegraf puppeteer-extra puppeteer-extra-plugin-stealth puppeteer
```

Proses ini akan mengunduh Chromium secara otomatis (~170MB), tunggu hingga selesai.

---

## 5. Salin File

Salin file berikut ke dalam folder `maps-scraper-bot/`:

```
maps-scraper-bot/
├── bot.js
├── scraper.js
└── package.json
```

---

## 6. Buat File `.env`

Buat file `.env` di dalam folder project:

```bash
# Windows (PowerShell)
echo BOT_TOKEN=isi_token_bot_kamu_disini > .env

# macOS / Linux
echo "BOT_TOKEN=isi_token_bot_kamu_disini" > .env
```

Atau buat manual file `.env` dengan isi:

```
BOT_TOKEN=isi_token_bot_kamu_disini
```

> Cara dapat token: buka Telegram → cari **@BotFather** → `/newbot` → ikuti instruksi → copy token yang diberikan

Lalu install dotenv supaya `.env` terbaca:

```bash
npm install dotenv
```

Dan tambahkan baris ini di **paling atas** `bot.js`:

```js
import "dotenv/config";
```

---

## 7. Jalankan Bot

```bash
node bot.js
```

Jika berhasil, terminal akan menampilkan:

```
Bot berjalan...
```

Buka Telegram, cari bot kamu, kirim `/start`.

---

## 8. (Opsional) Jalankan sebagai Background Process dengan PM2

Supaya bot tetap berjalan meski terminal ditutup:

```bash
# Install PM2 secara global
npm install -g pm2

# Jalankan bot
pm2 start bot.js --name maps-bot

# Lihat status
pm2 status

# Lihat log
pm2 logs maps-bot

# Jalankan otomatis saat server restart
pm2 startup
pm2 save
```

---

## Troubleshooting

| Masalah                       | Solusi                                                           |
| ----------------------------- | ---------------------------------------------------------------- |
| `node: command not found`     | Node.js belum terinstall atau PATH belum diset, restart terminal |
| `Error: Cannot find module`   | Jalankan `npm install` ulang                                     |
| `Puppeteer launch failed`     | Di Linux server, tambahkan `--no-sandbox` (sudah ada di kode)    |
| `Chromium not found`          | Jalankan `npx puppeteer browsers install chrome`                 |
| `Bot tidak merespons`         | Cek token di `.env`, pastikan tidak ada spasi                    |
| `ETELEGRAM: 401 Unauthorized` | Token salah atau bot sudah direset di BotFather                  |
