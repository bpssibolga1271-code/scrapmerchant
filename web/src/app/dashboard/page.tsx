import dynamic from 'next/dynamic';

import { prisma } from '@/lib/prisma';
import StatsCard from '@/components/dashboard/StatsCard';
import RecentSessions from '@/components/dashboard/RecentSessions';
import PlatformPieChart from '@/components/charts/PlatformPieChart';
import ProvinceBarChart from '@/components/charts/ProvinceBarChart';
import TrendLineChart from '@/components/charts/TrendLineChart';

const IndonesiaMap = dynamic(
  () => import('@/components/map/IndonesiaMap'),
  { ssr: false, loading: () => (
    <div className="flex h-96 items-center justify-center rounded-xl border border-gray-200 bg-white shadow-sm">
      <p className="text-sm text-gray-500">Loading map...</p>
    </div>
  )},
);

interface ProvinceRow {
  code: string;
  name: string;
  count: bigint;
}

interface TrendRow {
  month: string;
  count: bigint;
}

interface PlatformCount {
  platform: string;
  _count: { id: number };
}

interface SessionResult {
  id: number;
  platform: string;
  status: string;
  totalMerchants: number;
  startedAt: Date;
  completedAt: Date | null;
  region: { id: number; code: string; name: string; level: string };
  user: { id: number; name: string; email: string };
}

async function getDashboardData() {
  try {
    const [totalMerchants, platformCounts, regionCount, recentSessions] =
      await Promise.all([
        prisma.merchant.count(),
        prisma.merchant.groupBy({
          by: ['platform'],
          _count: { id: true },
        }),
        prisma.region.count({ where: { level: 'province' } }),
        prisma.scrapeSession.findMany({
          take: 10,
          orderBy: { startedAt: 'desc' },
          include: {
            user: { select: { id: true, name: true, email: true } },
            region: {
              select: { id: true, code: true, name: true, level: true },
            },
          },
        }),
      ]);

    const provinceMerchantCounts: ProvinceRow[] = await prisma
      .$queryRaw<ProvinceRow[]>`
        SELECT r.code, r.name, COUNT(m.id) as count
        FROM Region r
        LEFT JOIN Merchant m ON m.regionId = r.id
        WHERE r.level = 'province'
        GROUP BY r.id, r.code, r.name
        ORDER BY count DESC
        LIMIT 10
      `
      .catch(() => [] as ProvinceRow[]);

    const merchantTrend: TrendRow[] = await prisma
      .$queryRaw<TrendRow[]>`
        SELECT DATE_FORMAT(createdAt, '%b %Y') as month, COUNT(id) as count
        FROM Merchant
        GROUP BY DATE_FORMAT(createdAt, '%Y-%m'), DATE_FORMAT(createdAt, '%b %Y')
        ORDER BY DATE_FORMAT(createdAt, '%Y-%m') ASC
        LIMIT 12
      `
      .catch(() => [] as TrendRow[]);

    const platformData = (platformCounts as PlatformCount[]).map((p) => ({
      name: p.platform.charAt(0).toUpperCase() + p.platform.slice(1),
      value: p._count.id,
    }));

    const provinceData = provinceMerchantCounts.map((p: ProvinceRow) => ({
      name: p.name,
      count: Number(p.count),
    }));

    const provinceMapData = provinceMerchantCounts.map((p: ProvinceRow) => ({
      provinceCode: p.code,
      provinceName: p.name,
      merchantCount: Number(p.count),
    }));

    const trendData = merchantTrend.map((t: TrendRow) => ({
      date: t.month,
      merchants: Number(t.count),
    }));

    const activePlatforms = platformCounts.length;
    const recentSessionCount = recentSessions.length;

    return {
      totalMerchants,
      activePlatforms,
      regionCount,
      recentSessionCount,
      platformData,
      provinceData,
      provinceMapData,
      trendData,
      recentSessions: (recentSessions as SessionResult[]).map((s) => ({
        id: s.id,
        platform: s.platform,
        status: s.status,
        totalMerchants: s.totalMerchants,
        startedAt: s.startedAt.toISOString(),
        completedAt: s.completedAt?.toISOString() ?? null,
        region: s.region,
        user: s.user,
      })),
    };
  } catch (error) {
    console.error('Failed to fetch dashboard data:', error);
    return {
      totalMerchants: 0,
      activePlatforms: 0,
      regionCount: 0,
      recentSessionCount: 0,
      platformData: [],
      provinceData: [],
      provinceMapData: [],
      trendData: [],
      recentSessions: [],
    };
  }
}

export default async function DashboardPage() {
  const data = await getDashboardData();

  return (
    <div className="space-y-6">
      {/* Page header */}
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Dashboard</h1>
        <p className="mt-1 text-sm text-gray-500">
          Overview of merchant scraping data across Indonesia
        </p>
      </div>

      {/* Stats row */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatsCard
          title="Total Merchants"
          value={data.totalMerchants.toLocaleString()}
          description="All scraped merchants"
          icon={
            <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 21v-7.5a.75.75 0 0 1 .75-.75h3a.75.75 0 0 1 .75.75V21m-4.5 0H2.36m11.14 0H18m0 0h3.64m-1.39 0V9.349M3.75 21V9.349m0 0a3.001 3.001 0 0 0 3.75-.615A2.993 2.993 0 0 0 9.75 9.75c.896 0 1.7-.393 2.25-1.016a2.993 2.993 0 0 0 2.25 1.016c.896 0 1.7-.393 2.25-1.016A3.001 3.001 0 0 0 20.25 9.35m-16.5 0a3.004 3.004 0 0 1-.621-4.72l1.189-1.19A1.5 1.5 0 0 1 5.378 3h13.243a1.5 1.5 0 0 1 1.06.44l1.19 1.189a3 3 0 0 1-.621 4.72M6.75 18h3.75a.75.75 0 0 0 .75-.75V13.5a.75.75 0 0 0-.75-.75H6.75a.75.75 0 0 0-.75.75v3.75c0 .414.336.75.75.75Z" />
            </svg>
          }
        />
        <StatsCard
          title="Platforms Active"
          value={data.activePlatforms}
          description="E-commerce platforms"
          icon={
            <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 16.875h3.375m0 0h3.375m-3.375 0V13.5m0 3.375v3.375M6 10.5h2.25a2.25 2.25 0 0 0 2.25-2.25V6a2.25 2.25 0 0 0-2.25-2.25H6A2.25 2.25 0 0 0 3.75 6v2.25A2.25 2.25 0 0 0 6 10.5Zm0 9.75h2.25A2.25 2.25 0 0 0 10.5 18v-2.25a2.25 2.25 0 0 0-2.25-2.25H6a2.25 2.25 0 0 0-2.25 2.25V18A2.25 2.25 0 0 0 6 20.25Zm9.75-9.75H18a2.25 2.25 0 0 0 2.25-2.25V6A2.25 2.25 0 0 0 18 3.75h-2.25A2.25 2.25 0 0 0 13.5 6v2.25a2.25 2.25 0 0 0 2.25 2.25Z" />
            </svg>
          }
        />
        <StatsCard
          title="Regions Covered"
          value={data.regionCount}
          description="Provinces in Indonesia"
          icon={
            <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 10.5a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z" />
              <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 10.5c0 7.142-7.5 11.25-7.5 11.25S4.5 17.642 4.5 10.5a7.5 7.5 0 1 1 15 0Z" />
            </svg>
          }
        />
        <StatsCard
          title="Recent Scrapes"
          value={data.recentSessionCount}
          description="Latest scraping sessions"
          icon={
            <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6h4.5m4.5 0a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" />
            </svg>
          }
        />
      </div>

      {/* Choropleth map */}
      <div className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
        <h3 className="text-lg font-semibold text-gray-900">Merchant Density Map</h3>
        <p className="mt-1 mb-4 text-sm text-gray-500">
          Merchant distribution across Indonesian provinces
        </p>
        <IndonesiaMap data={data.provinceMapData} />
      </div>

      {/* Charts row */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <PlatformPieChart data={data.platformData} />
        <ProvinceBarChart data={data.provinceData} />
      </div>

      {/* Trend chart */}
      <TrendLineChart data={data.trendData} />

      {/* Recent sessions table */}
      <RecentSessions sessions={data.recentSessions} />
    </div>
  );
}
