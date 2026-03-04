'use client';

interface Session {
  id: number;
  platform: string;
  status: string;
  totalMerchants: number;
  startedAt: string;
  completedAt: string | null;
  region: {
    id: number;
    code: string;
    name: string;
    level: string;
  };
  user: {
    id: number;
    name: string;
    email: string;
  };
}

interface RecentSessionsProps {
  sessions: Session[];
}

const statusColors: Record<string, string> = {
  completed: 'bg-green-100 text-green-700',
  running: 'bg-yellow-100 text-yellow-700',
  failed: 'bg-red-100 text-red-700',
};

const platformColors: Record<string, string> = {
  tokopedia: 'bg-green-100 text-green-700',
  shopee: 'bg-orange-100 text-orange-700',
  grabfood: 'bg-emerald-100 text-emerald-700',
  gofood: 'bg-red-100 text-red-700',
  lazada: 'bg-blue-100 text-blue-700',
  blibli: 'bg-indigo-100 text-indigo-700',
  zalora: 'bg-pink-100 text-pink-700',
};

function formatDate(dateStr: string): string {
  const date = new Date(dateStr);
  return date.toLocaleDateString('id-ID', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export default function RecentSessions({ sessions }: RecentSessionsProps) {
  if (sessions.length === 0) {
    return (
      <div className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
        <h3 className="text-lg font-semibold text-gray-900">Recent Scrape Sessions</h3>
        <p className="mt-4 text-center text-sm text-gray-500">
          No scrape sessions yet. Start a new scraping task to see results here.
        </p>
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-gray-200 bg-white shadow-sm">
      <div className="border-b border-gray-200 px-6 py-4">
        <h3 className="text-lg font-semibold text-gray-900">Recent Scrape Sessions</h3>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="border-b border-gray-100 bg-gray-50">
              <th className="px-6 py-3 font-medium text-gray-500">Time</th>
              <th className="px-6 py-3 font-medium text-gray-500">Platform</th>
              <th className="px-6 py-3 font-medium text-gray-500">Region</th>
              <th className="px-6 py-3 font-medium text-gray-500">Merchants</th>
              <th className="px-6 py-3 font-medium text-gray-500">Status</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {sessions.map((session) => (
              <tr key={session.id} className="hover:bg-gray-50">
                <td className="whitespace-nowrap px-6 py-3 text-gray-600">
                  {formatDate(session.startedAt)}
                </td>
                <td className="px-6 py-3">
                  <span
                    className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-medium capitalize ${
                      platformColors[session.platform] ?? 'bg-gray-100 text-gray-700'
                    }`}
                  >
                    {session.platform}
                  </span>
                </td>
                <td className="px-6 py-3 text-gray-600">{session.region.name}</td>
                <td className="px-6 py-3 font-medium text-gray-900">
                  {session.totalMerchants.toLocaleString()}
                </td>
                <td className="px-6 py-3">
                  <span
                    className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-medium capitalize ${
                      statusColors[session.status] ?? 'bg-gray-100 text-gray-700'
                    }`}
                  >
                    {session.status}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
