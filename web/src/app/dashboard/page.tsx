import { prisma } from '@/lib/prisma';
import { getMerchantStats, readMerchants } from '@/lib/parquet';
import StatsCard from '@/components/dashboard/StatsCard';
import RecentSessions from '@/components/dashboard/RecentSessions';
import PlatformPieChart from '@/components/charts/PlatformPieChart';
import ProvinceBarChart from '@/components/charts/ProvinceBarChart';
import TrendLineChart from '@/components/charts/TrendLineChart';

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
    const [merchantStats, regionCount, recentSessions] = await Promise.all([
      getMerchantStats(),
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

    // Build chart data from parquet stats
    const platformData = Object.entries(merchantStats.platforms).map(
      ([name, value]) => ({
        name: name.charAt(0).toUpperCase() + name.slice(1),
        value,
      }),
    );

    const provinceData = Object.entries(merchantStats.regions)
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 10);

    // Build trend data from parquet records
    const merchants = await readMerchants();
    const trendMap: Record<string, number> = {};
    for (const m of merchants) {
      const month = m.createdAt.slice(0, 7); // YYYY-MM
      trendMap[month] = (trendMap[month] || 0) + 1;
    }
    const trendData = Object.entries(trendMap)
      .sort(([a], [b]) => a.localeCompare(b))
      .slice(-12)
      .map(([date, count]) => ({ date, merchants: count }));

    return {
      totalMerchants: merchantStats.total,
      activePlatforms: Object.keys(merchantStats.platforms).length,
      regionCount,
      recentSessionCount: recentSessions.length,
      platformData,
      provinceData,
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
        <h1 className="text-2xl font-bold text-gray-900">Dasbor</h1>
        <p className="mt-1 text-sm text-gray-500">
          Ringkasan data merchant hasil scraping seluruh Indonesia
        </p>
      </div>

      {/* Stats row */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatsCard
          title="Total Merchant"
          value={data.totalMerchants.toLocaleString()}
          description="Semua merchant yang di-scrape"
          icon={
            <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 21v-7.5a.75.75 0 0 1 .75-.75h3a.75.75 0 0 1 .75.75V21m-4.5 0H2.36m11.14 0H18m0 0h3.64m-1.39 0V9.349M3.75 21V9.349m0 0a3.001 3.001 0 0 0 3.75-.615A2.993 2.993 0 0 0 9.75 9.75c.896 0 1.7-.393 2.25-1.016a2.993 2.993 0 0 0 2.25 1.016c.896 0 1.7-.393 2.25-1.016A3.001 3.001 0 0 0 20.25 9.35m-16.5 0a3.004 3.004 0 0 1-.621-4.72l1.189-1.19A1.5 1.5 0 0 1 5.378 3h13.243a1.5 1.5 0 0 1 1.06.44l1.19 1.189a3 3 0 0 1-.621 4.72M6.75 18h3.75a.75.75 0 0 0 .75-.75V13.5a.75.75 0 0 0-.75-.75H6.75a.75.75 0 0 0-.75.75v3.75c0 .414.336.75.75.75Z" />
            </svg>
          }
        />
        <StatsCard
          title="Platform Aktif"
          value={data.activePlatforms}
          description="Platform e-commerce"
          icon={
            <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 16.875h3.375m0 0h3.375m-3.375 0V13.5m0 3.375v3.375M6 10.5h2.25a2.25 2.25 0 0 0 2.25-2.25V6a2.25 2.25 0 0 0-2.25-2.25H6A2.25 2.25 0 0 0 3.75 6v2.25A2.25 2.25 0 0 0 6 10.5Zm0 9.75h2.25A2.25 2.25 0 0 0 10.5 18v-2.25a2.25 2.25 0 0 0-2.25-2.25H6a2.25 2.25 0 0 0-2.25 2.25V18A2.25 2.25 0 0 0 6 20.25Zm9.75-9.75H18a2.25 2.25 0 0 0 2.25-2.25V6A2.25 2.25 0 0 0 18 3.75h-2.25A2.25 2.25 0 0 0 13.5 6v2.25a2.25 2.25 0 0 0 2.25 2.25Z" />
            </svg>
          }
        />
        <StatsCard
          title="Wilayah Tercakup"
          value={data.regionCount}
          description="Provinsi di Indonesia"
          icon={
            <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 10.5a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z" />
              <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 10.5c0 7.142-7.5 11.25-7.5 11.25S4.5 17.642 4.5 10.5a7.5 7.5 0 1 1 15 0Z" />
            </svg>
          }
        />
        <StatsCard
          title="Scraping Terkini"
          value={data.recentSessionCount}
          description="Sesi scraping terbaru"
          icon={
            <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6h4.5m4.5 0a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" />
            </svg>
          }
        />
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
