import * as React from 'react';
import {
  Combobox,
  ComboboxChip,
  ComboboxChips,
  ComboboxChipsInput,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxItem,
  ComboboxList,
  ComboboxValue,
  useComboboxAnchor,
} from '@/components/ui/combobox';

const SUGGESTED_KEYWORDS = [
  'shop', 'store', 'toko', 'olshop', 'grosir',
  'mart', 'swalayan', 'minimarket', 'elektronik', 'fashion',
  'makanan', 'minuman', 'obat', 'apotek', 'bangunan',
];

interface KeywordTagsProps {
  value: string[];
  onChange: (keywords: string[]) => void;
}

export function KeywordTags({ value, onChange }: KeywordTagsProps) {
  const anchor = useComboboxAnchor();
  const [inputValue, setInputValue] = React.useState('');

  // Combine suggestions with any custom keywords that aren't in the suggestions
  const allItems = React.useMemo(() => {
    const set = new Set([...SUGGESTED_KEYWORDS, ...value]);
    const q = inputValue.toLowerCase().trim();
    let items = [...set];
    if (q) {
      items = items.filter((item) => item.toLowerCase().includes(q));
    }
    return items;
  }, [value, inputValue]);

  function handleValueChange(newValue: string[]) {
    onChange(newValue);
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter' && inputValue.trim()) {
      e.preventDefault();
      const keyword = inputValue.trim().toLowerCase();
      if (!value.includes(keyword)) {
        onChange([...value, keyword]);
      }
      setInputValue('');
    }
  }

  return (
    <div className="space-y-1.5">
      <label className="text-xs font-medium text-gray-600">
        Kata Kunci Pencarian
      </label>
      <Combobox
        multiple
        items={allItems}
        value={value}
        onValueChange={handleValueChange}
        inputValue={inputValue}
        onInputValueChange={setInputValue}
      >
        <ComboboxChips ref={anchor} className="bg-white">
          <ComboboxValue>
            {value.map((keyword) => (
              <ComboboxChip key={keyword} className="bg-se-orange-100 text-se-orange-700">
                {keyword}
              </ComboboxChip>
            ))}
          </ComboboxValue>
          <ComboboxChipsInput
            placeholder={value.length === 0 ? 'Ketik kata kunci, tekan Enter...' : 'Tambah...'}
            onKeyDown={handleKeyDown}
          />
        </ComboboxChips>
        <ComboboxContent anchor={anchor}>
          <ComboboxEmpty>Tekan Enter untuk menambah "{inputValue}"</ComboboxEmpty>
          <ComboboxList>
            {(item) => (
              <ComboboxItem key={item} value={item}>
                {item}
              </ComboboxItem>
            )}
          </ComboboxList>
        </ComboboxContent>
      </Combobox>
      <p className="text-xs text-gray-400">
        Pilih dari saran atau ketik kata kunci baru, tekan Enter.
      </p>
    </div>
  );
}
