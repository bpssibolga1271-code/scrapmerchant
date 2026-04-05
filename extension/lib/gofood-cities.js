/**
 * SE Merchant Scraper — GoFood City Mapping
 *
 * Maps GoFood city slugs to BPS province codes.
 * Extracted from https://gofood.co.id/en/cities (106 cities, 2026-03-08).
 *
 * URL pattern: https://gofood.co.id/en/{parentCity}/{region}-restaurants/most_loved
 * - Top-level city: parentCity === region (e.g., /en/palu/palu-restaurants/most_loved)
 * - Sub-region: parentCity !== region (e.g., /en/parepare/pangkep-restaurants/most_loved)
 *
 * Some GoFood cities are regency capitals (e.g., Luwuk = capital of Kab. Banggai).
 * The scraper tries the regency as a sub-region under each GoFood city in the province.
 *
 * Usage:
 *   - hasGoFoodCoverage(provinceCode) — check if province has any coverage
 *   - getGoFoodCitiesForProvince(provinceCode) — list all cities in a province
 *   - lookupGoFoodCitySlug(regionName) — find slug for a BPS region name
 */

// Each entry: slug → { name, provinceCode, provinceName }
const GOFOOD_CITIES = {
  // ── Aceh (11) ─────────────────────────────────────────────
  'banda-aceh': { name: 'Banda Aceh', provinceCode: '11', provinceName: 'Aceh' },
  'sabang': { name: 'Sabang', provinceCode: '11', provinceName: 'Aceh' },
  'lhokseumawe': { name: 'Lhokseumawe', provinceCode: '11', provinceName: 'Aceh' },
  'langsa': { name: 'Langsa', provinceCode: '11', provinceName: 'Aceh' },

  // ── Sumatera Utara (12) ───────────────────────────────────
  'medan': { name: 'Medan', provinceCode: '12', provinceName: 'Sumatera Utara' },
  'pematangsiantar': { name: 'Pematangsiantar', provinceCode: '12', provinceName: 'Sumatera Utara' },
  'kisaran': { name: 'Kisaran', provinceCode: '12', provinceName: 'Sumatera Utara' },
  'rantau%20prapat': { name: 'Rantau Prapat', provinceCode: '12', provinceName: 'Sumatera Utara' },

  // ── Sumatera Barat (13) ───────────────────────────────────
  'padang': { name: 'Padang', provinceCode: '13', provinceName: 'Sumatera Barat' },
  'bukit-tinggi': { name: 'Bukit Tinggi', provinceCode: '13', provinceName: 'Sumatera Barat' },

  // ── Riau (14) ─────────────────────────────────────────────
  'pekanbaru': { name: 'Pekanbaru', provinceCode: '14', provinceName: 'Riau' },
  'duri': { name: 'Duri', provinceCode: '14', provinceName: 'Riau' },

  // ── Jambi (15) ────────────────────────────────────────────
  'jambi': { name: 'Jambi', provinceCode: '15', provinceName: 'Jambi' },

  // ── Sumatera Selatan (16) ─────────────────────────────────
  'palembang': { name: 'Palembang', provinceCode: '16', provinceName: 'Sumatera Selatan' },
  'lubuk%20lingau': { name: 'Lubuk Lingau', provinceCode: '16', provinceName: 'Sumatera Selatan' },
  'kayu%20agung': { name: 'Kayu Agung', provinceCode: '16', provinceName: 'Sumatera Selatan' },
  'prabumulih': { name: 'Prabumulih', provinceCode: '16', provinceName: 'Sumatera Selatan' },
  'indralaya': { name: 'Indralaya', provinceCode: '16', provinceName: 'Sumatera Selatan' },

  // ── Bengkulu (17) ─────────────────────────────────────────
  'bengkulu': { name: 'Bengkulu', provinceCode: '17', provinceName: 'Bengkulu' },

  // ── Lampung (18) ──────────────────────────────────────────
  'bandar-lampung': { name: 'Bandar Lampung', provinceCode: '18', provinceName: 'Lampung' },
  'metro': { name: 'Metro', provinceCode: '18', provinceName: 'Lampung' },

  // ── Kep. Bangka Belitung (19) ─────────────────────────────
  'pangkal-pinang': { name: 'Pangkal Pinang', provinceCode: '19', provinceName: 'Kepulauan Bangka Belitung' },
  'belitung': { name: 'Belitung', provinceCode: '19', provinceName: 'Kepulauan Bangka Belitung' },

  // ── Kepulauan Riau (21) ───────────────────────────────────
  'batam': { name: 'Batam', provinceCode: '21', provinceName: 'Kepulauan Riau' },
  'tanjung-pinang': { name: 'Tanjung Pinang', provinceCode: '21', provinceName: 'Kepulauan Riau' },
  'karimun': { name: 'Karimun', provinceCode: '21', provinceName: 'Kepulauan Riau' },

  // ── DKI Jakarta (31) ──────────────────────────────────────
  'jakarta': { name: 'Jakarta', provinceCode: '31', provinceName: 'DKI Jakarta' },

  // ── Jawa Barat (32) ───────────────────────────────────────
  'bandung': { name: 'Bandung', provinceCode: '32', provinceName: 'Jawa Barat' },
  'sukabumi': { name: 'Sukabumi', provinceCode: '32', provinceName: 'Jawa Barat' },
  'tasikmalaya': { name: 'Tasikmalaya', provinceCode: '32', provinceName: 'Jawa Barat' },
  'cirebon': { name: 'Cirebon', provinceCode: '32', provinceName: 'Jawa Barat' },
  'karawang': { name: 'Karawang', provinceCode: '32', provinceName: 'Jawa Barat' },
  'sumedang': { name: 'Sumedang', provinceCode: '32', provinceName: 'Jawa Barat' },
  'garut': { name: 'Garut', provinceCode: '32', provinceName: 'Jawa Barat' },
  'purwakarta': { name: 'Purwakarta', provinceCode: '32', provinceName: 'Jawa Barat' },
  'subang': { name: 'Subang', provinceCode: '32', provinceName: 'Jawa Barat' },

  // ── Jawa Tengah (33) ──────────────────────────────────────
  'semarang': { name: 'Semarang', provinceCode: '33', provinceName: 'Jawa Tengah' },
  'solo': { name: 'Solo', provinceCode: '33', provinceName: 'Jawa Tengah' },
  'tegal': { name: 'Tegal', provinceCode: '33', provinceName: 'Jawa Tengah' },
  'magelang': { name: 'Magelang', provinceCode: '33', provinceName: 'Jawa Tengah' },
  'purwokerto': { name: 'Purwokerto', provinceCode: '33', provinceName: 'Jawa Tengah' },
  'pekalongan': { name: 'Pekalongan', provinceCode: '33', provinceName: 'Jawa Tengah' },
  'cilacap': { name: 'Cilacap', provinceCode: '33', provinceName: 'Jawa Tengah' },
  'kudus': { name: 'Kudus', provinceCode: '33', provinceName: 'Jawa Tengah' },
  'kebumen': { name: 'Kebumen', provinceCode: '33', provinceName: 'Jawa Tengah' },
  'grobogan': { name: 'Grobogan', provinceCode: '33', provinceName: 'Jawa Tengah' },

  // ── DI Yogyakarta (34) ────────────────────────────────────
  'yogyakarta': { name: 'Yogyakarta', provinceCode: '34', provinceName: 'DI Yogyakarta' },

  // ── Jawa Timur (35) ───────────────────────────────────────
  'surabaya': { name: 'Surabaya', provinceCode: '35', provinceName: 'Jawa Timur' },
  'malang': { name: 'Malang', provinceCode: '35', provinceName: 'Jawa Timur' },
  'kediri': { name: 'Kediri', provinceCode: '35', provinceName: 'Jawa Timur' },
  'madiun': { name: 'Madiun', provinceCode: '35', provinceName: 'Jawa Timur' },
  'jember': { name: 'Jember', provinceCode: '35', provinceName: 'Jawa Timur' },
  'pasuruan': { name: 'Pasuruan', provinceCode: '35', provinceName: 'Jawa Timur' },
  'mojokerto': { name: 'Mojokerto', provinceCode: '35', provinceName: 'Jawa Timur' },
  'madura': { name: 'Madura', provinceCode: '35', provinceName: 'Jawa Timur' },
  'probolinggo': { name: 'Probolinggo', provinceCode: '35', provinceName: 'Jawa Timur' },
  'banyuwangi': { name: 'Banyuwangi', provinceCode: '35', provinceName: 'Jawa Timur' },
  'jombang': { name: 'Jombang', provinceCode: '35', provinceName: 'Jawa Timur' },
  'bojonegoro': { name: 'Bojonegoro', provinceCode: '35', provinceName: 'Jawa Timur' },
  'trenggalek': { name: 'Trenggalek', provinceCode: '35', provinceName: 'Jawa Timur' },

  // ── Banten (36) ───────────────────────────────────────────
  'serang': { name: 'Serang', provinceCode: '36', provinceName: 'Banten' },

  // ── Bali (51) ─────────────────────────────────────────────
  'bali': { name: 'Bali', provinceCode: '51', provinceName: 'Bali' },

  // ── Nusa Tenggara Barat (52) ──────────────────────────────
  'mataram': { name: 'Mataram', provinceCode: '52', provinceName: 'Nusa Tenggara Barat' },
  'sumbawa%20besar': { name: 'Sumbawa Besar', provinceCode: '52', provinceName: 'Nusa Tenggara Barat' },
  'dompu': { name: 'Dompu', provinceCode: '52', provinceName: 'Nusa Tenggara Barat' },

  // ── Nusa Tenggara Timur (53) ──────────────────────────────
  'kupang': { name: 'Kupang', provinceCode: '53', provinceName: 'Nusa Tenggara Timur' },
  'maumere': { name: 'Maumere', provinceCode: '53', provinceName: 'Nusa Tenggara Timur' },
  'ruteng': { name: 'Ruteng', provinceCode: '53', provinceName: 'Nusa Tenggara Timur' },
  'ende': { name: 'Ende', provinceCode: '53', provinceName: 'Nusa Tenggara Timur' },
  'waingapu': { name: 'Waingapu', provinceCode: '53', provinceName: 'Nusa Tenggara Timur' },
  'labuan%20bajo': { name: 'Labuan Bajo', provinceCode: '53', provinceName: 'Nusa Tenggara Timur' },

  // ── Kalimantan Barat (61) ─────────────────────────────────
  'pontianak': { name: 'Pontianak', provinceCode: '61', provinceName: 'Kalimantan Barat' },
  'ketapang': { name: 'Ketapang', provinceCode: '61', provinceName: 'Kalimantan Barat' },
  'putussibau': { name: 'Putussibau', provinceCode: '61', provinceName: 'Kalimantan Barat' },

  // ── Kalimantan Tengah (62) ────────────────────────────────
  'palangkaraya': { name: 'Palangkaraya', provinceCode: '62', provinceName: 'Kalimantan Tengah' },
  'sampit': { name: 'Sampit', provinceCode: '62', provinceName: 'Kalimantan Tengah' },
  'pangkalan%20bun': { name: 'Pangkalan Bun', provinceCode: '62', provinceName: 'Kalimantan Tengah' },

  // ── Kalimantan Selatan (63) ───────────────────────────────
  'banjarmasin': { name: 'Banjarmasin', provinceCode: '63', provinceName: 'Kalimantan Selatan' },
  'batulicin': { name: 'Batulicin', provinceCode: '63', provinceName: 'Kalimantan Selatan' },
  'tabalong': { name: 'Tabalong', provinceCode: '63', provinceName: 'Kalimantan Selatan' },
  'paringin': { name: 'Paringin', provinceCode: '63', provinceName: 'Kalimantan Selatan' },

  // ── Kalimantan Timur (64) ─────────────────────────────────
  'balikpapan': { name: 'Balikpapan', provinceCode: '64', provinceName: 'Kalimantan Timur' },
  'samarinda': { name: 'Samarinda', provinceCode: '64', provinceName: 'Kalimantan Timur' },
  'berau': { name: 'Berau', provinceCode: '64', provinceName: 'Kalimantan Timur' },
  'bontang': { name: 'Bontang', provinceCode: '64', provinceName: 'Kalimantan Timur' },

  // ── Kalimantan Utara (65) ─────────────────────────────────
  'tarakan': { name: 'Tarakan', provinceCode: '65', provinceName: 'Kalimantan Utara' },

  // ── Sulawesi Utara (71) ───────────────────────────────────
  'manado': { name: 'Manado', provinceCode: '71', provinceName: 'Sulawesi Utara' },
  'tomohon': { name: 'Tomohon', provinceCode: '71', provinceName: 'Sulawesi Utara' },
  'bitung': { name: 'Bitung', provinceCode: '71', provinceName: 'Sulawesi Utara' },
  'kotamobagu': { name: 'Kotamobagu', provinceCode: '71', provinceName: 'Sulawesi Utara' },

  // ── Sulawesi Tengah (72) ──────────────────────────────────
  // Luwuk listed on cities page but returns 404 (verified 2026-03-08) — omitted
  'palu': {
    name: 'Palu', provinceCode: '72', provinceName: 'Sulawesi Tengah',
    // Sub-regions from "Places to check out" (verified Playwright 2026-03-08):
    // donggala (Kab. Donggala), palu (Kota Palu), palu-barat, palu-selatan, palu-timur, palu-utara
    subRegions: ['donggala', 'palu', 'palu-barat', 'palu-selatan', 'palu-timur', 'palu-utara'],
  },

  // ── Sulawesi Selatan (73) ─────────────────────────────────
  'makassar': { name: 'Makassar', provinceCode: '73', provinceName: 'Sulawesi Selatan' },
  'parepare': {
    name: 'Parepare', provinceCode: '73', provinceName: 'Sulawesi Selatan',
    // Sub-regions (verified Playwright 2026-03-08, partial — has "Show more cities"):
    // Kota Parepare districts: bacukiki, bacukiki-barat, soreang, ujung, central-parepare
    // Kab. Bantaeng districts: central-bantaeng, bissappu, eremerasa, gantarangkeke, pajukukang, sinoa, tompobulu
    // Also covers: pangkep (Kab. Pangkajene dan Kepulauan) + more after "Show more"
    subRegions: ['bacukiki', 'bacukiki%20barat', 'soreang', 'ujung', 'central%20parepare',
      'central%20bantaeng', 'bissappu', 'eremerasa', 'gantarangkeke', 'pajukukang', 'sinoa', 'tompobulu',
      'pangkep'],
  },
  'palopo': { name: 'Palopo', provinceCode: '73', provinceName: 'Sulawesi Selatan' },

  // ── Sulawesi Tenggara (74) ────────────────────────────────
  'kendari': { name: 'Kendari', provinceCode: '74', provinceName: 'Sulawesi Tenggara' },
  'baubau': { name: 'Baubau', provinceCode: '74', provinceName: 'Sulawesi Tenggara' },

  // ── Gorontalo (75) ────────────────────────────────────────
  'gorontalo': { name: 'Gorontalo', provinceCode: '75', provinceName: 'Gorontalo' },

  // ── Sulawesi Barat (76) ───────────────────────────────────
  'mamuju': { name: 'Mamuju', provinceCode: '76', provinceName: 'Sulawesi Barat' },

  // ── Maluku (81) ───────────────────────────────────────────
  'ambon': { name: 'Ambon', provinceCode: '81', provinceName: 'Maluku' },

  // ── Maluku Utara (82) ─────────────────────────────────────
  'ternate': { name: 'Ternate', provinceCode: '82', provinceName: 'Maluku Utara' },

  // ── Papua (91) ────────────────────────────────────────────
  'jayapura': { name: 'Jayapura', provinceCode: '91', provinceName: 'Papua' },
  'merauke': { name: 'Merauke', provinceCode: '91', provinceName: 'Papua' },
  'biak': { name: 'Biak', provinceCode: '91', provinceName: 'Papua' },

  // ── Papua Barat (92) ──────────────────────────────────────
  'sorong': { name: 'Sorong', provinceCode: '92', provinceName: 'Papua Barat' },
  'manokwari': { name: 'Manokwari', provinceCode: '92', provinceName: 'Papua Barat' },
};

/**
 * Get all GoFood city slugs available for a given BPS province code.
 *
 * @param {string} provinceCode — BPS province code (e.g., '72')
 * @returns {Array<{slug: string, name: string}>}
 */
function getGoFoodCitiesForProvince(provinceCode) {
  if (!provinceCode) return [];
  const results = [];
  for (const [slug, info] of Object.entries(GOFOOD_CITIES)) {
    if (info.provinceCode === provinceCode) {
      results.push({ slug, name: info.name });
    }
  }
  return results;
}

/**
 * Look up a GoFood city slug by BPS region/city name.
 * Returns the slug or null if no GoFood coverage.
 *
 * @param {string} regionName — BPS region name (may be uppercase)
 * @param {string} [provinceName] — province name for fallback
 * @returns {string|null} — GoFood city slug or null
 */
function lookupGoFoodCitySlug(regionName, provinceName) {
  if (!regionName) return null;

  const lower = regionName.toLowerCase()
    .replace(/^(kota|kabupaten|kab\.)\s*/i, '')
    .trim();

  // Exact slug match (top-level city)
  const slug = lower.replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');
  if (GOFOOD_CITIES[slug]) return slug;

  // Exact name match (case-insensitive)
  for (const [s, info] of Object.entries(GOFOOD_CITIES)) {
    if (info.name.toLowerCase() === lower) return s;
  }

  // Fuzzy: contains match
  for (const [s, info] of Object.entries(GOFOOD_CITIES)) {
    const cityLower = info.name.toLowerCase();
    if (cityLower.includes(lower) || lower.includes(cityLower)) return s;
  }

  // Province name fallback — find any city in that province
  if (provinceName) {
    const provLower = provinceName.toLowerCase();
    for (const [s, info] of Object.entries(GOFOOD_CITIES)) {
      if (info.provinceName.toLowerCase() === provLower) return s;
    }
  }

  return null;
}

/**
 * Find which GoFood parent city covers a given BPS regency/district name.
 * Checks the subRegions arrays of GoFood cities in the same province.
 *
 * @param {string} regionName — BPS regency/district name
 * @param {string} provinceCode — BPS province code
 * @returns {{ parentCitySlug: string, regionSlug: string } | null}
 */
function findGoFoodParentCity(regionName, provinceCode) {
  if (!regionName || !provinceCode) return null;

  const lower = regionName.toLowerCase()
    .replace(/^(kota|kabupaten|kab\.)\s*/i, '')
    .trim();
  const regionSlug = lower.replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');
  const regionSlugEncoded = lower.replace(/\s+/g, '%20').replace(/[^a-z0-9%-]/g, '');

  for (const [citySlug, info] of Object.entries(GOFOOD_CITIES)) {
    if (info.provinceCode !== provinceCode) continue;
    if (!info.subRegions) continue;

    for (const sub of info.subRegions) {
      const subDecoded = decodeURIComponent(sub).toLowerCase();
      if (sub === regionSlug || sub === regionSlugEncoded ||
          subDecoded === lower || subDecoded.includes(lower) || lower.includes(subDecoded)) {
        return { parentCitySlug: citySlug, regionSlug: sub };
      }
    }
  }

  return null;
}

/**
 * Check if a BPS province has ANY GoFood coverage.
 *
 * @param {string} provinceCode — BPS province code
 * @returns {boolean}
 */
function hasGoFoodCoverage(provinceCode) {
  return getGoFoodCitiesForProvince(provinceCode).length > 0;
}
