import { NextRequest, NextResponse } from 'next/server';

import {
  appendMerchants,
  deleteMerchants,
  getMerchantStats,
  readMerchants,
  type MerchantRecord,
} from '@/lib/parquet';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const format = searchParams.get('format');

    // Return stats summary
    if (format === 'stats') {
      const stats = await getMerchantStats();
      return NextResponse.json(stats);
    }

    // Return all data as JSON (for backward compatibility)
    const merchants = await readMerchants();

    const platform = searchParams.get('platform');
    const regionCode = searchParams.get('regionCode');
    const search = searchParams.get('search');
    const page = Math.max(1, parseInt(searchParams.get('page') ?? '1', 10));
    const limit = Math.min(10000, Math.max(1, parseInt(searchParams.get('limit') ?? '20', 10)));

    let filtered = merchants;

    if (platform) {
      filtered = filtered.filter((m) => m.platform === platform);
    }
    if (regionCode) {
      filtered = filtered.filter(
        (m) => m.regionCode === regionCode || m.provinceCode === regionCode,
      );
    }
    if (search) {
      const q = search.toLowerCase();
      filtered = filtered.filter(
        (m) =>
          m.name.toLowerCase().includes(q) ||
          m.address?.toLowerCase().includes(q) ||
          m.category?.toLowerCase().includes(q),
      );
    }

    const total = filtered.length;
    const skip = (page - 1) * limit;
    const paginated = filtered.slice(skip, skip + limit);

    return NextResponse.json({
      merchants: paginated,
      total,
      page,
      limit,
    });
  } catch (error) {
    console.error('Error fetching merchants:', error);
    return NextResponse.json(
      { error: 'Failed to fetch merchants' },
      { status: 500 },
    );
  }
}

interface IncomingMerchant {
  name: string;
  address?: string;
  category?: string;
  phone?: string;
  rating?: number;
  productCount?: number;
  joinDate?: string;
  monthlySales?: number;
  totalTransactions?: number;
  operatingHours?: string;
  ownerName?: string;
  sourceUrl?: string;
}

interface PostBody {
  merchants: IncomingMerchant[];
  regionCode: string;
  regionName?: string;
  provinceCode?: string;
  provinceName?: string;
  platform: string;
}

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as PostBody;

    const { merchants, regionCode, platform } = body;

    if (!merchants || !Array.isArray(merchants) || merchants.length === 0) {
      return NextResponse.json(
        { error: 'merchants array is required and must not be empty' },
        { status: 400 },
      );
    }

    if (!regionCode) {
      return NextResponse.json(
        { error: 'regionCode is required' },
        { status: 400 },
      );
    }

    if (!platform) {
      return NextResponse.json(
        { error: 'platform is required' },
        { status: 400 },
      );
    }

    const now = new Date().toISOString();

    const records: MerchantRecord[] = merchants.map((m) => ({
      platform,
      name: m.name,
      address: m.address ?? null,
      category: m.category ?? null,
      phone: m.phone ?? null,
      rating: m.rating ?? null,
      productCount: m.productCount ?? null,
      joinDate: m.joinDate ?? null,
      monthlySales: m.monthlySales ?? null,
      totalTransactions: m.totalTransactions ?? null,
      operatingHours: m.operatingHours ?? null,
      ownerName: m.ownerName ?? null,
      sourceUrl: m.sourceUrl ?? null,
      regionCode,
      regionName: body.regionName ?? regionCode,
      provinceCode: body.provinceCode ?? regionCode.slice(0, 2),
      provinceName: body.provinceName ?? '',
      createdAt: now,
    }));

    const result = await appendMerchants(records);

    return NextResponse.json({
      success: true,
      count: result.added,
      skipped: result.skipped,
    });
  } catch (error) {
    console.error('Error ingesting merchants:', error);
    return NextResponse.json(
      { error: 'Failed to ingest merchant data' },
      { status: 500 },
    );
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);

    const platform = searchParams.get('platform');
    const regionCode = searchParams.get('regionCode');
    const dateFrom = searchParams.get('dateFrom');
    const dateTo = searchParams.get('dateTo');
    const deleteAll = searchParams.get('all') === 'true';

    if (!deleteAll && !platform && !regionCode && !dateFrom && !dateTo) {
      return NextResponse.json(
        { error: 'Specify filters or use ?all=true to delete everything' },
        { status: 400 },
      );
    }

    const deleted = await deleteMerchants({
      platform: platform ?? undefined,
      regionCode: regionCode ?? undefined,
      dateFrom: dateFrom ?? undefined,
      dateTo: dateTo ?? undefined,
      all: deleteAll,
    });

    return NextResponse.json({
      success: true,
      deleted: deleted === -1 ? 'all' : deleted,
    });
  } catch (error) {
    console.error('Error deleting merchants:', error);
    return NextResponse.json(
      { error: 'Failed to delete merchants' },
      { status: 500 },
    );
  }
}
