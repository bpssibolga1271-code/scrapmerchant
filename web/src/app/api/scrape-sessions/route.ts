import { NextRequest, NextResponse } from 'next/server';
import { Platform, ScrapeStatus } from '@prisma/client';

import { prisma } from '@/lib/prisma';

interface PostBody {
  regionId: number;
  platform: Platform;
  totalMerchants: number;
  status: ScrapeStatus;
}

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);

    const limit = Math.min(100, Math.max(1, parseInt(searchParams.get('limit') ?? '10', 10)));

    const sessions = await prisma.scrapeSession.findMany({
      take: limit,
      orderBy: { startedAt: 'desc' },
      include: {
        user: {
          select: { id: true, name: true, email: true },
        },
        region: {
          select: { id: true, code: true, name: true, level: true },
        },
      },
    });

    return NextResponse.json({ sessions });
  } catch (error) {
    console.error('Error fetching scrape sessions:', error);
    return NextResponse.json(
      { error: 'Failed to fetch scrape sessions' },
      { status: 500 },
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as PostBody;

    const { regionId, platform, totalMerchants, status } = body;

    if (!regionId) {
      return NextResponse.json(
        { error: 'regionId is required' },
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
      where: { id: regionId },
    });

    if (!region) {
      return NextResponse.json(
        { error: `Region with id '${regionId}' not found` },
        { status: 404 },
      );
    }

    // For now, use the first user as a placeholder until auth is implemented
    const user = await prisma.user.findFirst();

    if (!user) {
      return NextResponse.json(
        { error: 'No user found. Please create a user first.' },
        { status: 400 },
      );
    }

    const session = await prisma.scrapeSession.create({
      data: {
        userId: user.id,
        regionId,
        platform,
        totalMerchants: totalMerchants ?? 0,
        status: status ?? 'running',
      },
      include: {
        user: {
          select: { id: true, name: true, email: true },
        },
        region: {
          select: { id: true, code: true, name: true, level: true },
        },
      },
    });

    return NextResponse.json(session, { status: 201 });
  } catch (error) {
    console.error('Error creating scrape session:', error);
    return NextResponse.json(
      { error: 'Failed to create scrape session' },
      { status: 500 },
    );
  }
}
