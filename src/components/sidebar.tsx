import { Search, Table2, Settings } from 'lucide-react';
import { cn } from '@/lib/utils';
import logoUrl from '@/assets/logo.png';

interface SidebarProps {
  activeTab: string;
  onTabChange: (tab: string) => void;
  status: 'idle' | 'processing' | 'done';
  badgeCount: number;
}

const NAV_ITEMS = [
  { id: 'scraper', label: 'Scraper', icon: Search },
  { id: 'preview', label: 'Data', icon: Table2 },
  { id: 'settings', label: 'Pengaturan', icon: Settings },
] as const;

export function Sidebar({ activeTab, onTabChange, status, badgeCount }: SidebarProps) {
  return (
    <aside className="flex flex-col w-[200px] bg-se-dark-950 text-white border-r border-white/10">
      {/* Brand */}
      <div className="flex items-center gap-2.5 px-4 py-4 border-b border-white/10">
        <img src={logoUrl} alt="SE2026" className="w-10 h-10 object-contain" />
        <div className="flex flex-col">
          <span className="text-[11px] font-bold tracking-wide text-white/90 leading-tight">Sensus Ekonomi</span>
          <span className="text-[10px] font-bold text-se-orange-400">2026</span>
        </div>
      </div>

      {/* Navigation */}
      <nav className="flex flex-col gap-1 px-2 py-3 flex-1">
        {NAV_ITEMS.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            onClick={() => onTabChange(id)}
            className={cn(
              'flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm font-medium transition-colors',
              activeTab === id
                ? 'bg-se-orange-500/15 text-se-orange-400'
                : 'text-white/50 hover:bg-white/5 hover:text-white/80',
            )}
          >
            <Icon className="w-[18px] h-[18px]" />
            <span>{label}</span>
            {id === 'preview' && badgeCount > 0 && (
              <span className="ml-auto text-[10px] font-bold bg-se-orange-500 text-white rounded-full px-1.5 py-0.5 min-w-[20px] text-center">
                {badgeCount > 999 ? '999+' : badgeCount}
              </span>
            )}
          </button>
        ))}
      </nav>

      {/* Status */}
      <div className="px-4 py-3 border-t border-white/10">
        <div className="flex items-center gap-2">
          <span
            className={cn(
              'w-2 h-2 rounded-full',
              status === 'idle' && 'bg-gray-400',
              status === 'processing' && 'bg-se-gold-400 animate-pulse',
              status === 'done' && 'bg-green-400',
            )}
          />
          <span className="text-xs text-white/50">
            {status === 'idle' ? 'Siap' : status === 'processing' ? 'Memproses...' : 'Selesai'}
          </span>
        </div>
      </div>
    </aside>
  );
}
