import { NextRequest, NextResponse } from 'next/server';
import { RegionLevel } from '@prisma/client';

import { prisma } from '@/lib/prisma';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);

    const level = searchParams.get('level') as RegionLevel | null;
    const parentId = searchParams.get('parentId');

    if (parentId) {
      const regions = await prisma.region.findMany({
        where: { parentId: parseInt(parentId, 10) },
        orderBy: { name: 'asc' },
        select: {
          id: true,
          code: true,
          name: true,
          level: true,
          parentId: true,
        },
      });

      return NextResponse.json({ regions });
    }

    if (level) {
      const validLevels: RegionLevel[] = ['province', 'regency', 'district'];
      if (!validLevels.includes(level)) {
        return NextResponse.json(
          { error: `Invalid level. Must be one of: ${validLevels.join(', ')}` },
          { status: 400 },
        );
      }

      const regions = await prisma.region.findMany({
        where: { level },
        orderBy: { name: 'asc' },
        select: {
          id: true,
          code: true,
          name: true,
          level: true,
          parentId: true,
        },
      });

      return NextResponse.json({ regions });
    }

    const regions = await prisma.region.findMany({
      where: { level: 'province' },
      orderBy: { name: 'asc' },
      select: {
        id: true,
        code: true,
        name: true,
        level: true,
        parentId: true,
      },
    });

    return NextResponse.json({ regions });
  } catch (error) {
    console.error('Error fetching regions:', error);
    return NextResponse.json(
      { error: 'Failed to fetch regions' },
      { status: 500 },
    );
  }
}
