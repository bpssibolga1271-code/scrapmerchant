# SE Merchant Scraper

Alat pengumpulan data merchant dari platform e-commerce Indonesia untuk kebutuhan Sensus Ekonomi 2026. Terdiri dari **Chrome Extension** untuk scraping dan **Web Dashboard** untuk visualisasi & analisis data.

## Demo Video

[![Demo Video](https://img.youtube.com/vi/p5p_HdOTgNg/maxresdefault.jpg)](https://www.youtube.com/watch?v=p5p_HdOTgNg)

> Klik gambar di atas untuk menonton demo penggunaan aplikasi.

---

## Daftar Isi

- [SE Merchant Scraper](#se-merchant-scraper)
  - [Demo Video](#demo-video)
  - [Daftar Isi](#daftar-isi)
  - [Fitur Utama](#fitur-utama)
  - [Arsitektur](#arsitektur)
  - [Prasyarat](#prasyarat)
  - [Instalasi \& Setup](#instalasi--setup)
    - [1. Clone Repository](#1-clone-repository)
    - [2. Setup Chrome Extension](#2-setup-chrome-extension)
      - [a. Install dependencies dan build](#a-install-dependencies-dan-build)
      - [b. Load extension ke Chrome](#b-load-extension-ke-chrome)
      - [c. Buka Extension](#c-buka-extension)
    - [3. Setup Web Dashboard](#3-setup-web-dashboard)
      - [a. Install dependencies](#a-install-dependencies)
      - [b. Konfigurasi environment](#b-konfigurasi-environment)
      - [c. Setup database](#c-setup-database)
      - [d. Jalankan web dashboard](#d-jalankan-web-dashboard)
  - [Cara Penggunaan](#cara-penggunaan)
    - [Scraping Data Merchant](#scraping-data-merchant)
    - [Mengirim Data ke Server](#mengirim-data-ke-server)
    - [Data Explorer (SQL Query)](#data-explorer-sql-query)
    - [Peta Choropleth](#peta-choropleth)
  - [Deployment ke Netlify](#deployment-ke-netlify)
    - [Persiapan](#persiapan)
    - [Deploy via Netlify UI](#deploy-via-netlify-ui)
    - [Deploy via Netlify CLI](#deploy-via-netlify-cli)
    - [Konfigurasi Environment Variables](#konfigurasi-environment-variables)
    - [Alternatif Platform Deployment](#alternatif-platform-deployment)
  - [Platform yang Didukung](#platform-yang-didukung)
  - [Struktur Proyek](#struktur-proyek)
  - [Akun Default](#akun-default)
  - [Troubleshooting](#troubleshooting)
    - [Extension tidak muncul setelah Load Unpacked](#extension-tidak-muncul-setelah-load-unpacked)
    - [Error "merchants array is required" saat kirim ke server](#error-merchants-array-is-required-saat-kirim-ke-server)
    - [CAPTCHA muncul saat scraping](#captcha-muncul-saat-scraping)
    - [Peta tidak menampilkan data](#peta-tidak-menampilkan-data)
    - [Web dashboard crash dengan Turbopack](#web-dashboard-crash-dengan-turbopack)
    - [Database seed terlalu lama](#database-seed-terlalu-lama)

---

## Fitur Utama

- Scraping otomatis merchant dari 6 platform e-commerce Indonesia
- Pemilihan wilayah berdasarkan hierarki BPS (Provinsi > Kabupaten/Kota > Kecamatan)
- Ekspor data ke Excel, CSV, dan JSON
- Pengiriman data langsung ke web dashboard via API
- Web dashboard dengan peta choropleth tingkat kabupaten/kota
- SQL query editor (DuckDB WASM) untuk analisis data di browser
- Autentikasi pengguna dengan NextAuth.js
- Manajemen sesi scraping

## Arsitektur

```
┌─────────────────────┐       POST /api/merchants       ┌──────────────────────┐
│   Chrome Extension  │ ──────────────────────────────▶ │   Web Dashboard      │
│                     │                                 │   (Next.js)          │
│  • Scraper Tab      │                                 │                      │
│  • Preview Tab      │                                 │  • Dashboard & Peta  │
│  • Settings Tab     │                                 │  • Data Explorer     │
│                     │                                 │  • Laporan           │
│  Platform Scrapers: │                                 │                      │
│  Tokopedia, Shopee  │                                 │  Database:           │
│  GrabFood, GoFood   │                                 │  SQLite + Parquet    │
│  Lazada, Blibli     │                                 │                      │
└─────────────────────┘                                 └──────────────────────┘
```

## Prasyarat

Pastikan sudah terinstall di komputer Anda:

| Software | Versi Minimum | Cara Cek |
|----------|--------------|----------|
| **Node.js** | v18+ | `node --version` |
| **npm** | v9+ | `npm --version` |
| **Google Chrome** | Terbaru | Cek di `chrome://version` |
| **Git** | Terbaru | `git --version` |

## Instalasi & Setup

### 1. Clone Repository

```bash
git clone <url-repository>
cd se-merchant-scraper
```

### 2. Setup Chrome Extension

Extension ini berfungsi sebagai alat scraping yang berjalan di browser Chrome.

#### a. Install dependencies dan build

```bash
# Di folder root proyek
npm install
npm run build
```

Perintah `build` akan menghasilkan file popup React ke folder `extension/popup/`.

#### b. Load extension ke Chrome

1. Buka Chrome, navigasi ke `chrome://extensions/`
2. Aktifkan **Developer mode** (toggle di pojok kanan atas)
3. Klik **Load unpacked**
4. Pilih folder `extension/` di dalam proyek
5. Extension akan muncul di toolbar Chrome

#### c. Buka Extension

Klik ikon extension di toolbar Chrome. Extension akan terbuka di tab baru.

### 3. Setup Web Dashboard

Web dashboard berfungsi sebagai server penerima data dan alat visualisasi.

#### a. Install dependencies

```bash
cd web
npm install
```

#### b. Konfigurasi environment

Buat file `.env` di folder `web/`:

```env
# Database (SQLite untuk development)
DATABASE_URL="file:./dev.db"

# NextAuth - GANTI dengan secret yang aman untuk production
NEXTAUTH_SECRET="ganti-dengan-secret-acak-yang-panjang"
NEXTAUTH_URL="http://localhost:3000"
```

> Untuk generate secret yang aman: `openssl rand -base64 32`

#### c. Setup database

```bash
# Generate Prisma client
npx prisma generate

# Jalankan migrasi database
npx prisma db push

# Seed data wilayah BPS & admin user (memakan waktu ~10-15 menit)
npx prisma db seed
```

Proses seed akan:
- Mengambil data wilayah dari API BPS (provinsi, kabupaten/kota, kecamatan)
- Membuat akun admin default

#### d. Jalankan web dashboard

```bash
npm run dev
```

Dashboard akan berjalan di `http://localhost:3000`.

---

## Cara Penggunaan

### Scraping Data Merchant

1. Buka extension Chrome (klik ikon di toolbar)
2. **Pilih Wilayah:**
   - Pilih Provinsi (wajib)
   - Pilih Kabupaten/Kota (opsional, untuk filter lebih spesifik)
   - Pilih Kecamatan (opsional)
3. **Pilih Platform:** Centang platform yang ingin di-scrape (Tokopedia, Shopee, dll)
4. Klik **Mulai Scraping**
5. Extension akan membuka tab baru untuk setiap platform dan mulai mengumpulkan data
6. Tunggu hingga proses selesai (status berubah menjadi "Scraping selesai!")
7. Jika ingin menghentikan proses, klik **Hentikan Scraping**

> **Catatan:** Jangan menutup tab yang dibuka oleh extension selama proses scraping berlangsung. Jika muncul CAPTCHA, selesaikan CAPTCHA tersebut dan scraping akan lanjut otomatis.
>
> **Penting (Shopee):** Pastikan Anda sudah **login ke akun Shopee** di browser sebelum menjalankan scraping Shopee. Shopee mendeteksi request tanpa sesi login sebagai bot dan akan memblokir akses dengan CAPTCHA berulang. Scraping akan gagal jika belum login.

### Mengirim Data ke Server

Setelah scraping selesai:

1. Buka tab **Pengaturan** di extension
2. Isi **API URL** dengan alamat web dashboard, contoh: `http://localhost:3000/api/merchants`
3. Kembali ke tab Scraper, klik **Kirim ke Server**
4. Data akan terkirim dan bisa dilihat di web dashboard

Atau ekspor data secara lokal:
- **Excel** — Semua data dalam file `.xlsx` dengan sheet per platform
- **CSV** — Format CSV standar
- **JSON** — Format JSON

### Data Explorer (SQL Query)

Fitur ini memungkinkan analisis data langsung di browser menggunakan SQL:

1. Buka web dashboard di `http://localhost:3000`
2. Login dengan akun admin
3. Navigasi ke **Data Explorer**
4. Gunakan panel kiri untuk:
   - **SQL Keywords:** Klik keyword SQL untuk menyisipkan ke editor
   - **Columns:** Klik nama kolom untuk menyisipkan ke posisi cursor
   - **Snippets:** Template SQL yang sering digunakan
   - **Sample Queries:** Contoh query yang siap dijalankan
5. Tulis query SQL di editor, lalu tekan **Run Query** atau `Ctrl+Enter`

Contoh query:
```sql
-- Hitung merchant per platform
SELECT platform, COUNT(*) as total
FROM merchants
GROUP BY platform
ORDER BY total DESC

-- Lihat sebaran per kabupaten/kota
SELECT regionCode, regionName, COUNT(*) as merchantCount
FROM merchants
GROUP BY regionCode, regionName
ORDER BY merchantCount DESC
```

### Peta Choropleth

Peta di halaman Data Explorer menampilkan sebaran merchant secara visual:

- Default menampilkan tingkat **Kabupaten/Kota** (khusus Sulawesi Tengah)
- Toggle ke tampilan **Provinsi** menggunakan tombol di pojok kanan atas peta
- Data peta otomatis terupdate saat menjalankan query yang memiliki kolom `regionCode` dan `merchantCount`

---

## Deployment ke Netlify

### Persiapan

Web dashboard menggunakan Next.js yang membutuhkan server-side rendering. Untuk deployment ke Netlify:

1. **Database:** Ganti SQLite ke database cloud (misal: PlanetScale, Supabase, atau Neon untuk PostgreSQL)
2. **Update Prisma schema** jika pindah dari SQLite:

```prisma
datasource db {
  provider = "postgresql"  // atau "mysql"
  url      = env("DATABASE_URL")
}
```

3. **Jalankan migrasi:**
```bash
npx prisma migrate dev --name init
npx prisma db seed
```

### Deploy via Netlify UI

1. Push kode ke GitHub/GitLab
2. Buka [app.netlify.com](https://app.netlify.com)
3. Klik **Add new site** > **Import an existing project**
4. Hubungkan repository GitHub Anda
5. Konfigurasi build settings:
   - **Base directory:** `web`
   - **Build command:** `npx prisma generate && npm run build`
   - **Publish directory:** `web/.next`
   - **Functions directory:** (biarkan kosong)
6. Klik **Deploy site**

### Deploy via Netlify CLI

```bash
# Install Netlify CLI
npm install -g netlify-cli

# Login
netlify login

# Inisialisasi dari folder web
cd web
netlify init

# Deploy
netlify deploy --prod
```

### Konfigurasi Environment Variables

Di Netlify dashboard (**Site settings > Environment variables**), tambahkan:

| Variable | Nilai | Keterangan |
|----------|-------|------------|
| `DATABASE_URL` | `postgresql://...` | URL database cloud |
| `NEXTAUTH_SECRET` | `<random-string>` | `openssl rand -base64 32` |
| `NEXTAUTH_URL` | `https://nama-site.netlify.app` | URL site Netlify Anda |

> **Penting:** Setelah deploy, jalankan seed database untuk mengisi data wilayah BPS. Anda bisa melakukannya dari lokal dengan mengarahkan `DATABASE_URL` ke database cloud.

### Alternatif Platform Deployment

| Platform | Cocok Untuk | Catatan |
|----------|------------|---------|
| **Vercel** | Next.js (rekomendasi) | Support SSR native, free tier |
| **Netlify** | Static + Serverless | Butuh plugin `@netlify/plugin-nextjs` |
| **Railway** | Full-stack | Database + app dalam satu tempat |
| **Render** | Full-stack | Free tier, auto-deploy dari GitHub |

---

## Platform yang Didukung

| Platform | Metode Scraping | Filter Lokasi |
|----------|----------------|---------------|
| **Tokopedia** | GraphQL interception | `fcity` (kabupaten/kota) |
| **Shopee** | API response interception | `locations` (provinsi) |
| **GrabFood** | `__NEXT_DATA__` parsing | GPS geolocation override |
| **GoFood** | DOM scraping | City slug URL |
| **Lazada** | Search page scraping | `location` (region A-ID) |
| **Blibli** | Catalog + seller listing | `location` (provinsi/kota) |

## Struktur Proyek

```
se-merchant-scraper/
├── extension/                 # Chrome Extension (Manifest V3)
│   ├── manifest.json         # Konfigurasi extension
│   ├── background/           # Service worker (orchestrator)
│   ├── content-scripts/      # Scraper per platform
│   ├── popup/                # UI popup (output build Vite)
│   ├── options/              # Halaman opsi extension
│   ├── lib/                  # Library (constants, storage, xlsx)
│   └── icons/                # Ikon extension
│
├── src/                      # Source code popup (React + TypeScript)
│   ├── tabs/                 # Komponen tab (Scraper, Preview, Settings)
│   ├── components/           # Komponen UI (shadcn/ui)
│   ├── hooks/                # React hooks
│   └── lib/                  # Utilities, types, constants
│
├── web/                      # Web Dashboard (Next.js)
│   ├── src/app/              # App Router pages & API routes
│   ├── src/components/       # Komponen (charts, maps, explorer)
│   ├── src/hooks/            # React hooks (DuckDB, dll)
│   ├── prisma/               # Schema & migrations
│   └── public/               # Assets statis (GeoJSON, logo)
│
├── vite.config.ts            # Build config untuk popup extension
├── package.json              # Dependencies extension popup
└── docs/                     # Dokumentasi & rencana
```

## Akun Default

Setelah menjalankan `npx prisma db seed`, akun admin berikut akan dibuat:

| Field | Nilai |
|-------|-------|
| Email | `admin@bps.go.id` |
| Password | `admin123` |
| Role | `admin` |

> **Penting:** Segera ganti password default setelah deployment pertama!

## Troubleshooting

### Extension tidak muncul setelah Load Unpacked

- Pastikan Anda memilih folder `extension/` (bukan root proyek)
- Pastikan sudah menjalankan `npm run build` di root proyek terlebih dahulu
- Periksa apakah ada error di `chrome://extensions/`

### Error "merchants array is required" saat kirim ke server

- Pastikan API URL di tab Pengaturan sudah benar (contoh: `http://localhost:3000/api/merchants`)
- Pastikan web dashboard sedang berjalan

### CAPTCHA muncul saat scraping

- Selesaikan CAPTCHA di tab browser yang terbuka
- Scraping akan lanjut otomatis setelah CAPTCHA diselesaikan
- Platform Shopee paling sering memunculkan CAPTCHA

### Shopee scraping selalu gagal / "message channel closed"

- **Pastikan sudah login ke akun Shopee** di browser sebelum scraping
- Shopee memblokir request dari user yang belum login sebagai bot
- Jika sudah login tapi masih gagal, coba buka `shopee.co.id` secara manual terlebih dahulu, tunggu beberapa detik, lalu jalankan scraping ulang

### Peta tidak menampilkan data

- Jalankan query yang menghasilkan kolom `regionCode` dan `merchantCount`
- Gunakan sample query "Regency merchant density (for map)" di Data Explorer

### Web dashboard crash dengan Turbopack

- Web dashboard sudah dikonfigurasi menggunakan `--no-turbopack`
- Jika masih error, pastikan versi Node.js >= 18

### Database seed terlalu lama

- Proses seed mengambil data dari API BPS untuk seluruh Indonesia (~38 provinsi, ~500+ kab/kota, ~7000+ kecamatan)
- Normal memakan waktu 10-15 menit
- Pastikan koneksi internet stabil selama proses seed

---

Dibuat untuk mendukung kegiatan Sensus Ekonomi 2026 — BPS Kabupaten Donggala.
