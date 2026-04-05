import { getServerSession } from 'next-auth';

import { authOptions } from '@/lib/auth';
import Sidebar from '@/components/layout/Sidebar';
import UserManagement from '@/components/settings/UserManagement';

export const metadata = {
  title: 'Pengaturan - SE Merchant Scraper',
  description: 'Admin settings for SE Merchant Scraper',
};

export default async function SettingsPage() {
  const session = await getServerSession(authOptions);

  if (!session || session.user.role !== 'admin') {
    return (
      <div className="min-h-screen bg-gray-50">
        <Sidebar />
        <main className="lg:pl-64">
          <div className="px-4 py-6 sm:px-6 lg:px-8">
            <div className="flex min-h-[60vh] items-center justify-center">
              <div className="text-center">
                <svg
                  className="mx-auto h-12 w-12 text-red-400"
                  fill="none"
                  viewBox="0 0 24 24"
                  strokeWidth={1.5}
                  stroke="currentColor"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M18.364 18.364A9 9 0 0 0 5.636 5.636m12.728 12.728A9 9 0 0 1 5.636 5.636m12.728 12.728L5.636 5.636"
                  />
                </svg>
                <h2 className="mt-4 text-xl font-semibold text-gray-900">
                  Unauthorized
                </h2>
                <p className="mt-2 text-sm text-gray-500">
                  Anda tidak memiliki akses ke halaman ini. Hanya admin yang
                  dapat mengakses pengaturan.
                </p>
              </div>
            </div>
          </div>
        </main>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <Sidebar />
      <main className="lg:pl-64">
        <div className="px-4 py-6 sm:px-6 lg:px-8">
          <div className="space-y-6">
            {/* Page header */}
            <div>
              <h1 className="text-2xl font-bold text-gray-900">Pengaturan</h1>
              <p className="mt-1 text-sm text-gray-500">
                Kelola user dan konfigurasi sistem
              </p>
            </div>

            {/* User Management section */}
            <UserManagement />
          </div>
        </div>
      </main>
    </div>
  );
}
