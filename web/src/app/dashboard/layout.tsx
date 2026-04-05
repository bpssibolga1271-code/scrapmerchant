import Sidebar from '@/components/layout/Sidebar';

export const metadata = {
  title: 'Dashboard - Sensus Ekonomi 2026',
  description: 'Dashboard Sensus Ekonomi 2026',
};

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="min-h-screen bg-gray-50">
      <Sidebar />
      <main className="lg:pl-64">
        <div className="px-4 py-6 sm:px-6 lg:px-8">{children}</div>
      </main>
    </div>
  );
}
