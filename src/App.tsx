import { useState, useEffect, useCallback } from 'react';
import { Sidebar } from '@/components/sidebar';
import { ScraperTab } from '@/tabs/scraper-tab';
import { PreviewTab } from '@/tabs/preview-tab';
import { SettingsTab } from '@/tabs/settings-tab';
import { storage } from '@/lib/storage';

export default function App() {
  const [activeTab, setActiveTab] = useState('scraper');
  const [status, setStatus] = useState<'idle' | 'processing' | 'done'>('idle');
  const [badgeCount, setBadgeCount] = useState(0);

  const refreshBadge = useCallback(async () => {
    const m = await storage.getMerchants();
    setBadgeCount(m.length);
  }, []);

  useEffect(() => {
    refreshBadge();
  }, [activeTab, refreshBadge]);

  return (
    <div className="flex h-screen w-full bg-gray-50 font-sans text-gray-900">
      <Sidebar
        activeTab={activeTab}
        onTabChange={setActiveTab}
        status={status}
        badgeCount={badgeCount}
      />
      <main className="flex-1 overflow-y-auto p-5">
        {activeTab === 'scraper' && (
          <ScraperTab onStatusChange={setStatus} onDataChange={refreshBadge} />
        )}
        {activeTab === 'preview' && <PreviewTab />}
        {activeTab === 'settings' && <SettingsTab onDataChange={refreshBadge} />}
      </main>
    </div>
  );
}
