import { cn } from '@/lib/utils';
import { PLATFORMS } from '@/lib/constants';
import { Progress } from '@/components/ui/progress';

interface ScrapeProgressProps {
  platforms: string[];
  currentIndex: number;
  label: string;
  done: boolean;
  captcha: boolean;
}

export function ScrapeProgress({
  platforms,
  currentIndex,
  label,
  done,
  captcha,
}: ScrapeProgressProps) {
  const pct = done
    ? 100
    : Math.round((currentIndex / platforms.length) * 100);

  return (
    <div className="space-y-3">
      <span
        className={cn(
          'text-sm font-medium',
          captcha ? 'text-se-orange-500' : 'text-gray-700',
        )}
      >
        {label}
      </span>
      <Progress
        value={pct}
        className={cn(
          'h-2',
          captcha && '[&>div]:bg-se-orange-500 [&>div]:animate-pulse',
          done && '[&>div]:bg-green-500',
        )}
      />
      <div className="flex flex-wrap gap-1.5">
        {platforms.map((key, i) => (
          <span
            key={key}
            className={cn(
              'text-xs px-2 py-0.5 rounded-full font-medium',
              done || i < currentIndex
                ? 'bg-green-100 text-green-700'
                : i === currentIndex && !done
                  ? 'bg-se-orange-100 text-se-orange-600 animate-pulse'
                  : 'bg-gray-100 text-gray-500',
            )}
          >
            {PLATFORMS[key]?.name ?? key}
          </span>
        ))}
      </div>
    </div>
  );
}
