import { NextRequest, NextResponse } from 'next/server';
import { Prisma } from '@prisma/client';

import { prisma } from '@/lib/prisma';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);

    const provinceCode = searchParams.get('provinceCode');
    const regencyCode = searchParams.get('regencyCode');
    const districtCode = searchParams.get('districtCode');
    const platform = searchParams.get('platform');
    const category = searchParams.get('category');
    const dateFrom = searchParams.get('dateFrom');
    const dateTo = searchParams.get('dateTo');
    const search = searchParams.get('search');
    const page = Math.max(1, parseInt(searchParams.get('page') ?? '1', 10));
    const limit = Math.min(100, Math.max(1, parseInt(searchParams.get('limit') ?? '20', 10)));

    const where: Prisma.MerchantWhereInput = {};

    if (provinceCode) {
      where.region = { code: provinceCode };
    }

    if (regencyCode) {
      where.region = { code: regencyCode };
    }

    if (districtCode) {
      where.region = { code: districtCode };
    }

    if (platform) {
      where.platform = platform as Prisma.EnumPlatformFilter['equals'];
    }

    if (category) {
      where.category = { contains: category };
    }

    if (dateFrom || dateTo) {
      where.createdAt = {};
      if (dateFrom) {
        where.createdAt.gte = new Date(dateFrom);
      }
      if (dateTo) {
        where.createdAt.lte = new Date(dateTo);
      }
    }

    if (search) {
      where.name = { contains: search };
    }

    const skip = (page - 1) * limit;

    const [merchants, total] = await Promise.all([
      prisma.merchant.findMany({
        where,
        include: {
          region: {
            select: { id: true, code: true, name: true, level: true },
          },
        },
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
      }),
      prisma.merchant.count({ where }),
    ]);

    return NextResponse.json({
      merchants,
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
  socialMediaLinks?: Record<string, string>;
  ownerName?: string;
  sourceUrl?: string;
}

interface PostBody {
  merchants: IncomingMerchant[];
  regionCode: string;
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

    const region = await prisma.region.findUnique({
      where: { code: regionCode },
    });

    if (!region) {
      return NextResponse.json(
        { error: `Region with code '${regionCode}' not found` },
        { status: 404 },
      );
    }

    const data = merchants.map((m) => ({
      regionId: region.id,
      platform: platform as Prisma.EnumPlatformFilter['equals'],
      name: m.name,
      address: m.address ?? null,
      category: m.category ?? null,
      phone: m.phone ?? null,
      rating: m.rating ?? null,
      productCount: m.productCount ?? null,
      joinDate: m.joinDate ? new Date(m.joinDate) : null,
      monthlySales: m.monthlySales ?? null,
      totalTransactions: m.totalTransactions ?? null,
      operatingHours: m.operatingHours ?? null,
      socialMediaLinks: m.socialMediaLinks ?? Prisma.JsonNull,
      ownerName: m.ownerName ?? null,
      sourceUrl: m.sourceUrl ?? null,
    }));

    const result = await prisma.merchant.createMany({ data });

    return NextResponse.json({
      success: true,
      count: result.count,
    });
  } catch (error) {
    console.error('Error ingesting merchants:', error);
    return NextResponse.json(
      { error: 'Failed to ingest merchant data' },
      { status: 500 },
    );
  }
}
