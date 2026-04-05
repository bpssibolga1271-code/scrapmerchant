import { cn } from '@/lib/utils';
import { PLATFORMS } from '@/lib/constants';

interface PlatformGridProps {
  selected: string[];
  onChange: (platforms: string[]) => void;
  disabled?: boolean;
}

export function PlatformGrid({ selected, onChange, disabled }: PlatformGridProps) {
  const allKeys = Object.keys(PLATFORMS);
  const allSelected = allKeys.every((k) => selected.includes(k));

  function toggle(key: string) {
    if (disabled) return;
    onChange(
      selected.includes(key)
        ? selected.filter((k) => k !== key)
        : [...selected, key],
    );
  }

  function toggleAll() {
    if (disabled) return;
    onChange(allSelected ? [] : [...allKeys]);
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-gray-700">Platform</h2>
        <button
          onClick={toggleAll}
          disabled={disabled}
          className="text-xs text-se-orange-500 hover:text-se-orange-600 font-medium disabled:opacity-50"
        >
          {allSelected ? 'Batal Semua' : 'Pilih Semua'}
        </button>
      </div>
      <div className="grid grid-cols-3 gap-2">
        {allKeys.map((key) => {
          const platform = PLATFORMS[key]!;
          const isChecked = selected.includes(key);
          return (
            <label
              key={key}
              className={cn(
                'flex items-center gap-2 px-3 py-2 rounded-lg border cursor-pointer transition-all text-sm',
                isChecked
                  ? 'border-se-orange-400 bg-se-orange-50 text-gray-900'
                  : 'border-gray-200 bg-white text-gray-500 hover:border-gray-300',
                disabled && 'opacity-50 cursor-not-allowed',
              )}
            >
              <input
                type="checkbox"
                checked={isChecked}
                onChange={() => toggle(key)}
                disabled={disabled}
                className="sr-only"
              />
              <span
                className="w-2.5 h-2.5 rounded-full shrink-0"
                style={{ backgroundColor: platform.color }}
              />
              <span className="font-medium">{platform.name}</span>
            </label>
          );
        })}
      </div>
    </div>
  );
}
