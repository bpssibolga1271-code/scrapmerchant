import Sidebar from '@/components/layout/Sidebar';

export const metadata = {
  title: 'Dashboard - SE Merchant Scraper',
  description: 'Dashboard overview for SE Merchant Scraper',
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
