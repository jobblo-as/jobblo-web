import { useEffect, useRef, useState } from 'react';
import { AlertCircle, CheckCircle2, Loader2, MapPin, Search, X } from 'lucide-react';
import { searchAddresses, type AddressHit } from '../../api/geonorge';

interface AddressSearchFieldProps {
  id?: string;
  /** The confirmed address; shown in the input until the user starts typing. */
  value: string;
  /** Extra line under a confirmed address, e.g. "0155 Oslo". */
  detail?: string;
  confirmed: boolean;
  error?: string;
  onSelect: (hit: AddressHit) => void;
  onClear: () => void;
}

/**
 * One search field with Kartverket suggestions; replaces street + fylke + kommune + sted.
 * The same field as the app's (jobblo-app components/create-job/AddressSearchField).
 */
export function AddressSearchField({ id, value, detail, confirmed, error, onSelect, onClear }: AddressSearchFieldProps) {
  const [query, setQuery] = useState(value);
  const [hits, setHits] = useState<AddressHit[]>([]);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);
  const [focused, setFocused] = useState(false);
  const skipSearch = useRef(true);

  // Follow the form (draft restore, map click, GPS) without searching for it. An emptied value
  // is ignored: that is the user typing over a confirmed address, and their text must stay.
  useEffect(() => {
    if (!value) return;
    skipSearch.current = true;
    setQuery(value);
  }, [value]);

  useEffect(() => {
    if (skipSearch.current) {
      skipSearch.current = false;
      return;
    }
    const q = query.trim();
    if (q.length < 3) {
      setHits([]);
      setLoading(false);
      return;
    }
    const controller = new AbortController();
    setLoading(true);
    const timer = setTimeout(() => {
      searchAddresses(q, controller.signal)
        .then((found) => {
          setHits(found);
          setFailed(false);
        })
        .catch(() => {
          if (!controller.signal.aborted) setFailed(true);
        })
        .finally(() => {
          if (!controller.signal.aborted) setLoading(false);
        });
    }, 300);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [query]);

  const pick = (hit: AddressHit) => {
    skipSearch.current = true;
    setQuery(hit.address);
    setHits([]);
    onSelect(hit);
  };

  const clear = () => {
    setQuery('');
    setHits([]);
    onClear();
  };

  const showList = focused && query.trim().length >= 3 && !confirmed;
  const listId = id ? `${id}-suggestions` : undefined;

  return (
    <div className="relative space-y-1.5">
      <div
        data-invalid={error ? 'true' : undefined}
        className={`flex items-center gap-2 rounded-xl border bg-white px-4 transition-all focus-within:ring-4 md:px-5 ${
          error
            ? 'border-red-500 focus-within:ring-red-500/5'
            : confirmed
              ? 'border-[#2D7A4D]/50 focus-within:ring-[#2D7A4D]/5'
              : 'border-gray-200 focus-within:border-[#2D7A4D] focus-within:ring-[#2D7A4D]/5'
        }`}
      >
        {confirmed ? <CheckCircle2 size={17} className="shrink-0 text-[#2D7A4D]" /> : <Search size={17} className="shrink-0 text-gray-400" />}
        <input
          id={id}
          type="text"
          role="combobox"
          aria-expanded={showList}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-invalid={error ? true : undefined}
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            // Typing over a confirmed address means a new one is being chosen.
            if (confirmed) onClear();
          }}
          onFocus={() => setFocused(true)}
          onBlur={() => setTimeout(() => setFocused(false), 150)}
          placeholder="Søk etter adresse, f.eks. Storgata 1"
          autoComplete="off"
          className="min-w-0 flex-1 bg-transparent py-3 text-sm outline-none md:py-4 md:text-base"
        />
        {loading ? <Loader2 size={16} className="shrink-0 animate-spin text-[#2D7A4D]" /> : null}
        {query && !loading ? (
          <button type="button" onClick={clear} aria-label="Tøm adresse" className="-mr-1 rounded-full p-1 text-gray-500 hover:bg-gray-100">
            <X size={16} />
          </button>
        ) : null}
      </div>

      {showList ? (
        <ul id={listId} role="listbox" className="absolute left-0 right-0 z-20 overflow-hidden rounded-xl border border-gray-200 bg-white shadow-lg">
          {hits.length ? (
            hits.map((hit, index) => (
              <li key={`${hit.address}-${hit.postalCode}-${index}`} role="option" aria-selected={false}>
                <button
                  type="button"
                  // mousedown, not click: the input's blur would close the list first.
                  onMouseDown={(e) => {
                    e.preventDefault();
                    pick(hit);
                  }}
                  className={`flex w-full items-center gap-2.5 px-4 py-3 text-left hover:bg-gray-50 ${index ? 'border-t border-gray-100' : ''}`}
                >
                  <MapPin size={16} className="shrink-0 text-[#2D7A4D]" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium text-gray-900">{hit.address}</span>
                    <span className="block truncate text-xs text-gray-500">
                      {[hit.postalCode, hit.city].filter(Boolean).join(' ')}
                      {hit.municipalityName && hit.municipalityName !== hit.city ? ` · ${hit.municipalityName}` : ''}
                    </span>
                  </span>
                </button>
              </li>
            ))
          ) : !loading ? (
            <li className="px-4 py-3 text-sm text-gray-500">
              {failed ? 'Adressesøket svarer ikke. Prøv igjen, eller klikk i kartet.' : 'Fant ingen adresse. Prøv en annen skrivemåte, eller klikk i kartet.'}
            </li>
          ) : null}
        </ul>
      ) : null}

      {error ? (
        <p className="ml-1 flex items-center gap-1.5 text-[10px] font-bold text-red-500 md:text-xs">
          <AlertCircle size={12} /> {error}
        </p>
      ) : confirmed ? (
        <p className="ml-1 text-[11px] font-medium text-[#2D7A4D] md:text-xs">Lokasjon bekreftet{detail ? ` · ${detail}` : ''}</p>
      ) : (
        <p className="ml-1 text-[11px] text-gray-500 md:text-xs">Velg et forslag fra listen, eller klikk i kartet.</p>
      )}
    </div>
  );
}
