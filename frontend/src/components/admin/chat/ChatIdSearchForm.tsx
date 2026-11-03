import React, { useState } from 'react';
import { Loader2, Search } from 'lucide-react';
import { Input } from '../../developer/ui/input';
import { Button } from '../../developer/ui/button';

interface ChatIdSearchFormProps {
  onSearch: (chatId: string) => void;
  defaultValue?: string;
  loading?: boolean;
}

export function ChatIdSearchForm({
  onSearch,
  defaultValue = '',
  loading = false,
}: ChatIdSearchFormProps) {
  const [value, setValue] = useState(defaultValue);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = value.trim();
    if (trimmed.length > 0) onSearch(trimmed);
  };

  return (
    <form onSubmit={handleSubmit} className="flex items-center gap-2" role="search">
      <div className="relative flex-1">
        <Search
          className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground"
          aria-hidden="true"
        />
        <Input
          type="text"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder="Skriv inn Chat ID (24-tegns MongoDB ObjectId)…"
          aria-label="Chat ID"
          className="bg-card pl-8 font-mono"
          autoComplete="off"
          spellCheck={false}
        />
      </div>
      <Button type="submit" disabled={value.trim().length === 0 || loading}>
        {loading ? (
          <Loader2 className="animate-spin" aria-hidden="true" />
        ) : (
          <Search aria-hidden="true" />
        )}
        Søk
      </Button>
    </form>
  );
}
