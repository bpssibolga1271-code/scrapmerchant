import { NextRequest, NextResponse } from 'next/server';
import ExcelJS from 'exceljs';

import { readMerchants, type MerchantRecord } from '@/lib/parquet';

type ReportTemplate = 'rekap-wilayah' | 'rekap-platform' | 'detail-merchant';

async function getRekapWilayah(
  provinceCode: string | null,
  platform: string | null,
) {
  let merchants = await readMerchants();

  if (platform && platform !== 'all') {
    merchants = merchants.filter((m) => m.platform === platform);
  }

  const countMap: Record<string, { code: string; name: string; level: string; count: number }> = {};

  for (const m of merchants) {
    if (provinceCode) {
      if (m.provinceCode !== provinceCode) continue;
      const key = m.regionCode;
      if (!countMap[key]) {
        countMap[key] = { code: m.regionCode, name: m.regionName, level: 'regency', count: 0 };
      }
      countMap[key].count++;
    } else {
      const key = m.provinceCode;
      if (!countMap[key]) {
        countMap[key] = { code: m.provinceCode, name: m.provinceName || m.provinceCode, level: 'province', count: 0 };
      }
      countMap[key].count++;
    }
  }

  return Object.values(countMap).sort((a, b) => b.count - a.count);
}

async function getRekapPlatform(
  provinceCode: string | null,
  regionCode: string | null,
) {
  let merchants = await readMerchants();

  if (regionCode) {
    merchants = merchants.filter((m) => m.regionCode === regionCode);
  } else if (provinceCode) {
    merchants = merchants.filter((m) => m.provinceCode === provinceCode);
  }

  const stats: Record<string, { platform: string; count: number; ratings: number[]; products: number[]; sales: number[] }> = {};

  for (const m of merchants) {
    if (!stats[m.platform]) {
      stats[m.platform] = { platform: m.platform, count: 0, ratings: [], products: [], sales: [] };
    }
    stats[m.platform].count++;
    if (m.rating !== null) stats[m.platform].ratings.push(m.rating);
    if (m.productCount !== null) stats[m.platform].products.push(m.productCount);
    if (m.monthlySales !== null) stats[m.platform].sales.push(m.monthlySales);
  }

  return Object.values(stats)
    .map((s) => ({
      platform: s.platform,
      count: s.count,
      avgRating: s.ratings.length > 0 ? Number((s.ratings.reduce((a, b) => a + b, 0) / s.ratings.length).toFixed(2)) : null,
      avgProducts: s.products.length > 0 ? Math.round(s.products.reduce((a, b) => a + b, 0) / s.products.length) : null,
      avgMonthlySales: s.sales.length > 0 ? Math.round(s.sales.reduce((a, b) => a + b, 0) / s.sales.length) : null,
    }))
    .sort((a, b) => b.count - a.count);
}

async function getDetailMerchant(
  provinceCode: string | null,
  regionCode: string | null,
  platform: string | null,
) {
  let merchants = await readMerchants();

  if (regionCode) {
    merchants = merchants.filter((m) => m.regionCode === regionCode);
  } else if (provinceCode) {
    merchants = merchants.filter((m) => m.provinceCode === provinceCode);
  }

  if (platform && platform !== 'all') {
    merchants = merchants.filter((m) => m.platform === platform);
  }

  return merchants.slice(0, 5000).map((m: MerchantRecord) => ({
    name: m.name,
    platform: m.platform,
    provinceName: m.provinceName,
    regionName: m.regionName,
    regionCode: m.regionCode,
    sourceUrl: m.sourceUrl,
    address: m.address,
    rating: m.rating,
    productCount: m.productCount,
    monthlySales: m.monthlySales,
  }));
}

function applyBpsHeaderStyle(row: ExcelJS.Row, colCount: number) {
  for (let i = 1; i <= colCount; i++) {
    const cell = row.getCell(i);
    cell.font = { bold: true, size: 11, name: 'Arial', color: { argb: 'FFFFFFFF' } };
    cell.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FF4472C4' },
    };
    cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
    cell.border = {
      top: { style: 'thin' },
      bottom: { style: 'thin' },
      left: { style: 'thin' },
      right: { style: 'thin' },
    };
  }
  row.height = 30;
}

function applyBpsDataStyle(row: ExcelJS.Row, colCount: number) {
  for (let i = 1; i <= colCount; i++) {
    const cell = row.getCell(i);
    cell.font = { size: 10, name: 'Arial' };
    cell.border = {
      top: { style: 'thin', color: { argb: 'FFD9D9D9' } },
      bottom: { style: 'thin', color: { argb: 'FFD9D9D9' } },
      left: { style: 'thin', color: { argb: 'FFD9D9D9' } },
      right: { style: 'thin', color: { argb: 'FFD9D9D9' } },
    };
    cell.alignment = { vertical: 'middle' };
  }
}

async function generateExcel(
  template: ReportTemplate,
  data: Record<string, unknown>[],
  title: string,
): Promise<Uint8Array> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'BPS Sensus Ekonomi';
  workbook.created = new Date();

  const sheet = workbook.addWorksheet('Laporan', {
    properties: { defaultColWidth: 18 },
  });

  const titleRow = sheet.addRow([title]);
  titleRow.font = { bold: true, size: 14, name: 'Arial' };
  const subtitleRow = sheet.addRow([
    `Tanggal cetak: ${new Date().toLocaleDateString('id-ID', {
      day: 'numeric',
      month: 'long',
      year: 'numeric',
    })}`,
  ]);
  subtitleRow.font = { size: 10, name: 'Arial', italic: true };
  sheet.addRow([]);

  if (template === 'rekap-wilayah') {
    const columns = ['No', 'Kode Wilayah', 'Nama Wilayah', 'Jumlah Merchant'];
    const headerRow = sheet.addRow(columns);
    applyBpsHeaderStyle(headerRow, columns.length);

    sheet.getColumn(1).width = 6;
    sheet.getColumn(2).width = 15;
    sheet.getColumn(3).width = 35;
    sheet.getColumn(4).width = 20;

    let total = 0;
    data.forEach((item, idx) => {
      const row = sheet.addRow([idx + 1, item.code, item.name, item.count]);
      applyBpsDataStyle(row, columns.length);
      row.getCell(4).alignment = { horizontal: 'right', vertical: 'middle' };
      total += (item.count as number) || 0;
    });

    const totalRow = sheet.addRow(['', '', 'TOTAL', total]);
    for (let i = 1; i <= columns.length; i++) {
      const cell = totalRow.getCell(i);
      cell.font = { bold: true, size: 11, name: 'Arial' };
      cell.border = { top: { style: 'double' }, bottom: { style: 'double' } };
    }
    totalRow.getCell(4).alignment = { horizontal: 'right', vertical: 'middle' };
  } else if (template === 'rekap-platform') {
    const columns = ['No', 'Platform', 'Jumlah Merchant', 'Rata-rata Rating', 'Rata-rata Produk', 'Rata-rata Penjualan/Bulan'];
    const headerRow = sheet.addRow(columns);
    applyBpsHeaderStyle(headerRow, columns.length);

    sheet.getColumn(1).width = 6;
    sheet.getColumn(2).width = 20;
    sheet.getColumn(3).width = 18;
    sheet.getColumn(4).width = 18;
    sheet.getColumn(5).width = 18;
    sheet.getColumn(6).width = 25;

    let totalCount = 0;
    data.forEach((item, idx) => {
      const row = sheet.addRow([
        idx + 1,
        String(item.platform).charAt(0).toUpperCase() + String(item.platform).slice(1),
        item.count,
        item.avgRating ?? '-',
        item.avgProducts ?? '-',
        item.avgMonthlySales ?? '-',
      ]);
      applyBpsDataStyle(row, columns.length);
      for (let c = 3; c <= 6; c++) {
        row.getCell(c).alignment = { horizontal: 'right', vertical: 'middle' };
      }
      totalCount += (item.count as number) || 0;
    });

    const totalRow = sheet.addRow(['', 'TOTAL', totalCount, '', '', '']);
    for (let i = 1; i <= columns.length; i++) {
      const cell = totalRow.getCell(i);
      cell.font = { bold: true, size: 11, name: 'Arial' };
      cell.border = { top: { style: 'double' }, bottom: { style: 'double' } };
    }
  } else if (template === 'detail-merchant') {
    const columns = ['No', 'Nama Merchant', 'Platform', 'Provinsi', 'Kab/Kota', 'Alamat', 'URL Merchant', 'Rating', 'Jumlah Produk', 'Penjualan/Bulan'];
    const headerRow = sheet.addRow(columns);
    applyBpsHeaderStyle(headerRow, columns.length);

    sheet.getColumn(1).width = 6;
    sheet.getColumn(2).width = 30;
    sheet.getColumn(3).width = 14;
    sheet.getColumn(4).width = 22;
    sheet.getColumn(5).width = 25;
    sheet.getColumn(6).width = 35;
    sheet.getColumn(7).width = 45;
    sheet.getColumn(8).width = 10;
    sheet.getColumn(9).width = 14;
    sheet.getColumn(10).width = 18;

    data.forEach((item, idx) => {
      const row = sheet.addRow([
        idx + 1, item.name,
        String(item.platform).charAt(0).toUpperCase() + String(item.platform).slice(1),
        item.provinceName ?? '-', item.regionName ?? '-',
        item.address ?? '-', item.sourceUrl ?? '-',
        item.rating ?? '-', item.productCount ?? '-', item.monthlySales ?? '-',
      ]);
      applyBpsDataStyle(row, columns.length);
    });

    const summaryRow = sheet.addRow(['', `Total: ${data.length} merchant`, '', '', '', '', '', '', '', '', '', '']);
    summaryRow.getCell(2).font = { bold: true, size: 10, name: 'Arial', italic: true };
  }

  sheet.addRow([]);
  const footerRow = sheet.addRow(['Sumber: Sensus Ekonomi - Merchant Scraper']);
  footerRow.font = { size: 9, name: 'Arial', italic: true };

  const buffer = await workbook.xlsx.writeBuffer();
  return new Uint8Array(buffer);
}

function generateCsv(
  template: ReportTemplate,
  data: Record<string, unknown>[],
): string {
  if (template === 'rekap-wilayah') {
    const header = 'No,Kode Wilayah,Nama Wilayah,Jumlah Merchant';
    const rows = data.map((item, idx) => `${idx + 1},"${item.code}","${item.name}",${item.count}`);
    return [header, ...rows].join('\n');
  }

  if (template === 'rekap-platform') {
    const header = 'No,Platform,Jumlah Merchant,Rata-rata Rating,Rata-rata Produk,Rata-rata Penjualan/Bulan';
    const rows = data.map((item, idx) => `${idx + 1},"${item.platform}",${item.count},${item.avgRating ?? ''},${item.avgProducts ?? ''},${item.avgMonthlySales ?? ''}`);
    return [header, ...rows].join('\n');
  }

  const header = 'No,Nama Merchant,Platform,Provinsi,Kab/Kota,Alamat,URL Merchant,Rating,Jumlah Produk,Penjualan/Bulan';
  const rows = data.map((item, idx) =>
    `${idx + 1},"${item.name}","${item.platform}","${item.provinceName ?? ''}","${item.regionName ?? ''}","${(item.address as string)?.replace(/"/g, '""') ?? ''}","${item.sourceUrl ?? ''}",${item.rating ?? ''},${item.productCount ?? ''},${item.monthlySales ?? ''}`,
  );
  return [header, ...rows].join('\n');
}

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);

    const template = searchParams.get('template') as ReportTemplate | null;
    const provinceCode = searchParams.get('provinceCode');
    const regionCode = searchParams.get('regionCode');
    const platform = searchParams.get('platform');
    const format = searchParams.get('format');

    if (!template) {
      return NextResponse.json(
        { error: 'template parameter is required (rekap-wilayah, rekap-platform, detail-merchant)' },
        { status: 400 },
      );
    }

    const validTemplates: ReportTemplate[] = ['rekap-wilayah', 'rekap-platform', 'detail-merchant'];
    if (!validTemplates.includes(template)) {
      return NextResponse.json(
        { error: `Invalid template. Must be one of: ${validTemplates.join(', ')}` },
        { status: 400 },
      );
    }

    let data: Record<string, unknown>[];
    let title: string;

    switch (template) {
      case 'rekap-wilayah':
        data = await getRekapWilayah(provinceCode, platform);
        title = provinceCode ? 'Rekap Merchant per Kabupaten/Kota' : 'Rekap Merchant per Provinsi';
        break;
      case 'rekap-platform':
        data = await getRekapPlatform(provinceCode, regionCode);
        title = 'Rekap Merchant per Platform';
        break;
      case 'detail-merchant':
        data = await getDetailMerchant(provinceCode, regionCode, platform);
        title = 'Detail Data Merchant';
        break;
      default:
        data = [];
        title = 'Laporan';
    }

    if (format === 'xlsx') {
      const buffer = await generateExcel(template, data, title);
      const filename = `${template}_${new Date().toISOString().slice(0, 10)}.xlsx`;
      return new NextResponse(buffer as unknown as BodyInit, {
        headers: {
          'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
          'Content-Disposition': `attachment; filename="${filename}"`,
        },
      });
    }

    if (format === 'csv') {
      const csv = generateCsv(template, data);
      const filename = `${template}_${new Date().toISOString().slice(0, 10)}.csv`;
      return new NextResponse(csv, {
        headers: {
          'Content-Type': 'text/csv; charset=utf-8',
          'Content-Disposition': `attachment; filename="${filename}"`,
        },
      });
    }

    return NextResponse.json({
      template,
      title,
      data,
      total: data.length,
      generatedAt: new Date().toISOString(),
    });
  } catch (error) {
    console.error('Error generating report:', error);
    return NextResponse.json(
      { error: 'Failed to generate report' },
      { status: 500 },
    );
  }
}
