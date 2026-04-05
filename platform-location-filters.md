# Platform Location Filter Investigation

Investigation date: 2026-03-07

## Summary

| Platform | Filter Type | Parameter | Notes |
|----------|------------|-----------|-------|
| Tokopedia | Numeric city IDs | `fcity=<id>` (with `st=shop`) | Uses BPS-style numeric IDs for cities |
| Lazada | Region codes | `location=A-ID-<number>` | 10 region-level codes (Shipped From filter) |
| Blibli | City/regency name | `location=<City Name>` | 300+ locations, plain text URL-encoded |
| Shopee | City name (unverified) | `locations=<City Name>` | Requires login + CAPTCHA, anti-bot protection |
| GrabFood | GPS/geolocation | Address-based delivery radius | No city dropdown, uses delivery address |
| GoFood | City slug in URL path | `/en/<city-slug>/restaurants` | 100 cities, also uses geolocation within city |
| Zalora | No location filter | N/A | National fashion marketplace, no seller location filter |

## Detailed Findings

### 1. Tokopedia
- **Search URL**: `https://www.tokopedia.com/search?q=<query>&st=shop&fcity=<id>`
- **Filter mechanism**: `fcity` parameter with numeric city IDs
- **City IDs**: BPS-style numeric codes (e.g., Jakarta = specific IDs per kota/kab)
- **Notes**: Must use `st=shop` to search for shops specifically

### 2. Lazada
- **Search URL**: `https://www.lazada.co.id/catalog/?q=<query>&location=A-ID-<number>`
- **Filter mechanism**: "Dikirim Dari" (Shipped From) sidebar filter
- **Location codes** (10 region-level):

| Code | Region |
|------|--------|
| A-ID-1 | Jabodetabek |
| A-ID-2 | West Java |
| A-ID-3 | Central Java |
| A-ID-4 | East Java |
| A-ID-6 | North Sumatera |
| A-ID-7 | Riau |
| A-ID-8 | Sumatera Selatan |
| A-ID-13 | Borneo |
| A-ID-14 | Sulawesi |
| A-ID-15 | Nusa Tenggara |

- **Notes**: Region-level only (not city-level). Found via `input[businessvalue]` attributes in DOM.

### 3. Blibli
- **Seller listing URL**: `https://www.blibli.com/semua-toko?location=<City Name>&sort=`
- **Filter mechanism**: "Lokasi toko" sidebar filter with "Lihat semua" to expand full list
- **Location format**: Plain city/regency name, URL-encoded (e.g., `Kota+Bandung`, `DKI+Jakarta`)
- **Available locations**: 300+ including provinces, cities (Kota), and regencies (Kab.)
- **Top default options**: Kota Bandung, DKI Jakarta, Jabodetabek, Kota Surabaya, Kota Tangerang
- **Notes**: Most granular location filter among all platforms

### 4. Shopee
- **Status**: BLOCKED - requires login and has anti-bot/CAPTCHA protection
- **Expected URL**: `https://shopee.co.id/search?keyword=<query>&locations=<City Name>`
- **Notes**: Cannot investigate without authenticated session. Redirects to captcha verification page for automated access.

### 5. GrabFood
- **URL**: `https://food.grab.com/id/en/restaurants`
- **Filter mechanism**: GPS/geolocation-based delivery address
- **How it works**: User enters delivery address, GrabFood shows restaurants within delivery range
- **No city/region dropdown**: Location is determined entirely by delivery address
- **Notes**: Not suitable for province/city-level scraping without setting specific GPS coordinates

### 6. GoFood
- **URL pattern**: `https://gofood.co.id/en/<city-slug>/restaurants`
- **Filter mechanism**: City-based URL routing + geolocation within city
- **Available cities**: 100 cities across Indonesia
- **City slugs** (sample): jakarta, bandung, bali, surabaya, makassar, palembang, medan, balikpapan, yogyakarta, semarang, manado, solo, samarinda, malang, batam, padang, pontianak, banjarmasin, pekanbaru, jambi, bandar-lampung, mataram, sukabumi, pematangsiantar, tasikmalaya, serang, cirebon, tegal, magelang, purwokerto, kediri, madiun, karawang, jember, pasuruan, mojokerto, banda-aceh, pekalongan, bukit-tinggi, cilacap, sumedang, garut, belitung, madura, probolinggo, purwakarta, banyuwangi, subang, metro, pangkal-pinang, tanjung-pinang, duri, sabang, kudus, kebumen, tomohon, bitung, gorontalo, palu, jombang, merauke, kendari, palopo, ambon, jayapura, palangkaraya, bojonegoro, kisaran, kupang, tarakan, ternate, sorong, berau, parepare, ketapang, mamuju, bengkulu, maumere, ruteng, dompu, ende, waingapu, trenggalek, sampit, lhokseumawe, batulicin, tabalong, putussibau, bontang, paringin, grobogan, luwuk, manokwari, baubau, kotamobagu, biak, prabumulih, indralaya, langsa, karimun
- **Full city list**: Available at `https://gofood.co.id/en/cities`
- **Notes**: Also requires delivery address for actual restaurant listing within a city

### 7. Zalora
- **URL**: `https://www.zalora.co.id/`
- **Filter mechanism**: NONE for location
- **How it works**: National fashion marketplace. Products filtered by category, brand, size, color, price — not by seller location.
- **Notes**: Not applicable for location-based merchant scraping

## Recommendations for Chrome Extension

1. **Tokopedia**: Use `fcity` parameter - already implemented
2. **Lazada**: Use `location=A-ID-<number>` parameter with the 10 region codes
3. **Blibli**: Use `location=<City Name>` parameter on `/semua-toko` endpoint
4. **Shopee**: Requires authenticated session - needs manual login or cookie injection
5. **GrabFood**: Would need to set GPS coordinates programmatically - complex
6. **GoFood**: Can use city slug URLs directly - straightforward
7. **Zalora**: No location-based scraping possible
