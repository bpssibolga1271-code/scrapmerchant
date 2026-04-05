import { useState } from 'react';
import { Check, ChevronsUpDown } from 'lucide-react';
import { cn, titleCase } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import type { BpsRegion } from '@/lib/types';

interface RegionComboboxProps {
  label: string;
  placeholder: string;
  regions: BpsRegion[];
  value: string;
  onChange: (code: string, name: string) => void;
  disabled?: boolean;
}

export function RegionCombobox({
  label,
  placeholder,
  regions,
  value,
  onChange,
  disabled,
}: RegionComboboxProps) {
  const [open, setOpen] = useState(false);
  const selected = regions.find((r) => r.kode_bps === value);

  return (
    <div className="space-y-1.5">
      <label className="text-xs font-medium text-gray-600">{label}</label>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            variant="outline"
            role="combobox"
            aria-expanded={open}
            disabled={disabled || regions.length === 0}
            className="w-full justify-between font-normal bg-white border-gray-200 text-left h-9"
          >
            <span className="truncate">
              {selected ? titleCase(selected.nama_bps) : placeholder}
            </span>
            <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
          </Button>
        </PopoverTrigger>
        <PopoverContent
          className="w-[--radix-popover-trigger-width] p-0"
          align="start"
        >
          <Command>
            <CommandInput placeholder={`Cari ${label.toLowerCase()}...`} />
            <CommandList>
              <CommandEmpty>Tidak ditemukan.</CommandEmpty>
              <CommandGroup>
                {regions.map((region) => (
                  <CommandItem
                    key={region.kode_bps}
                    value={region.nama_bps}
                    onSelect={() => {
                      onChange(region.kode_bps, titleCase(region.nama_bps));
                      setOpen(false);
                    }}
                  >
                    <Check
                      className={cn(
                        'mr-2 h-4 w-4',
                        value === region.kode_bps ? 'opacity-100' : 'opacity-0',
                      )}
                    />
                    {titleCase(region.nama_bps)}
                  </CommandItem>
                ))}
              </CommandGroup>
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
    </div>
  );
}
