import React, { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, Text, TextInput, View } from 'react-native';
import { CheckCircle2, Home, MapPin, Search, X } from 'lucide-react-native';
import { findAddress, searchAddresses, type AddressHit } from '../../services/geonorge.service';
import { useProfile } from '../../hooks/useProfile';
import { TC, tc } from '../../theme/colors';

interface AddressSearchFieldProps {
  /** The confirmed address; shown in the input until the user starts typing. */
  value: string;
  /** Extra line under a confirmed address, e.g. "0155 Oslo · Oslo kommune". */
  detail?: string;
  confirmed: boolean;
  error?: string;
  onSelect: (hit: AddressHit) => void;
  onClear: () => void;
  /** Offer the profile's saved address first. Off where that address is being edited. */
  offerSaved?: boolean;
  /** The line under the field: once confirmed, and before. */
  confirmedText?: string;
  idleText?: string;
  /** e.g. to scroll the field above the keyboard, so its suggestions show. */
  onFocus?: () => void;
}

/** One search field with Kartverket suggestions; replaces street + fylke + kommune + sted. */
export function AddressSearchField({
  value,
  detail,
  confirmed,
  error,
  onSelect,
  onClear,
  offerSaved = true,
  confirmedText = 'Lokasjon bekreftet',
  idleText = 'Velg et forslag fra listen, eller trykk i kartet.',
  onFocus,
}: AddressSearchFieldProps) {
  const [query, setQuery] = useState(value);
  const [hits, setHits] = useState<AddressHit[]>([]);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);
  const [focused, setFocused] = useState(false);
  const skipSearch = useRef(true);
  const [savedBusy, setSavedBusy] = useState(false);

  // "Mine adresser": the address saved in Innstillinger, offered first in the list (as on web).
  const { data: profile } = useProfile();
  const p = profile as { address?: string; postNumber?: string; postSted?: unknown } | undefined;
  const savedStreet = p?.address?.trim() ?? '';
  const savedPostNumber = p?.postNumber?.trim() ?? '';
  const savedPostSted =
    typeof p?.postSted === 'string'
      ? p.postSted.trim()
      : ((p?.postSted as { city?: string } | undefined)?.city ?? '');
  const savedLine = [savedPostNumber, savedPostSted].filter(Boolean).join(' ');
  const q = query.trim().toLowerCase();
  const showSaved =
    offerSaved && !!savedStreet && (!q || `${savedStreet} ${savedLine}`.toLowerCase().includes(q));

  // Follow the form (draft restore, map tap, GPS) without searching for it. An emptied value
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

  /** The saved address, made exact through Kartverket; else it is searched like typed text. */
  const pickSaved = async () => {
    setSavedBusy(true);
    const hit = await findAddress(savedStreet, savedPostNumber, savedPostSted).catch(() => null);
    setSavedBusy(false);
    if (hit) pick(hit);
    else setQuery(savedStreet);
  };

  const clear = () => {
    setQuery('');
    setHits([]);
    onClear();
  };

  const showList = focused && !confirmed && (query.trim().length >= 3 || showSaved);
  const showHits = query.trim().length >= 3;

  return (
    <View className="gap-1.5">
      <Text className="text-[0.8125rem] font-semibold text-ink">
        Adresse<Text className="text-danger"> *</Text>
      </Text>
      <View
        className={`h-12 flex-row items-center gap-2 rounded-lg border bg-surface px-3 ${
          error ? 'border-danger' : confirmed ? 'border-brand-text/50' : 'border-line'
        }`}
      >
        {confirmed ? (
          <CheckCircle2 size={17} color={TC.brandText} />
        ) : (
          <Search size={17} color={tc('#9B9E96', 'subtle')} />
        )}
        <TextInput
          value={query}
          onChangeText={(text) => {
            setQuery(text);
            // Typing over a confirmed address means a new one is being chosen.
            if (confirmed) onClear();
          }}
          onFocus={() => {
            setFocused(true);
            onFocus?.();
          }}
          onBlur={() => setTimeout(() => setFocused(false), 150)}
          placeholder="Søk etter adresse, f.eks. Storgata 1"
          placeholderTextColor={TC.placeholder}
          autoCorrect={false}
          returnKeyType="search"
          className="flex-1 text-[1.0625rem] text-ink"
          accessibilityLabel="Adresse"
        />
        {loading ? <ActivityIndicator size="small" color={TC.brandText} /> : null}
        {query && !loading ? (
          <Pressable onPress={clear} hitSlop={8} accessibilityLabel="Tøm adresse">
            <X size={16} color={tc('#63665F', 'muted')} />
          </Pressable>
        ) : null}
      </View>

      {showList ? (
        <View className="overflow-hidden rounded-lg border border-line bg-surface">
          {showSaved ? (
            <View className="bg-surface-2">
              <Text className="px-3 pt-2.5 text-[0.6875rem] font-semibold uppercase tracking-wide text-muted">
                Mine adresser
              </Text>
              <Pressable
                onPress={() => void pickSaved()}
                accessibilityRole="button"
                accessibilityLabel={`Mine adresser: ${savedStreet} ${savedLine}`}
                className="flex-row items-center gap-2.5 px-3 pt-1 pb-3 active:opacity-70"
              >
                {savedBusy ? (
                  <ActivityIndicator size="small" color={TC.brandText} />
                ) : (
                  <Home size={16} color={TC.brandText} />
                )}
                <View className="min-w-0 flex-1">
                  <Text className="text-[0.9375rem] font-medium text-ink" numberOfLines={1}>
                    {savedStreet}
                  </Text>
                  {savedLine ? (
                    <Text className="text-[0.8125rem] text-muted" numberOfLines={1}>
                      {savedLine}
                    </Text>
                  ) : null}
                </View>
              </Pressable>
            </View>
          ) : null}
          {!showHits ? null : hits.length ? (
            hits.map((hit, index) => (
              <Pressable
                key={`${hit.address}-${hit.postalCode}-${index}`}
                onPress={() => pick(hit)}
                className={`flex-row items-center gap-2.5 px-3 py-3 active:bg-surface-2 ${index || showSaved ? 'border-t border-line-soft' : ''}`}
              >
                <MapPin size={16} color={TC.brandText} />
                <View className="min-w-0 flex-1">
                  <Text className="text-[0.9375rem] font-medium text-ink" numberOfLines={1}>
                    {hit.address}
                  </Text>
                  <Text className="text-[0.8125rem] text-muted" numberOfLines={1}>
                    {[hit.postalCode, hit.city].filter(Boolean).join(' ')}
                    {hit.municipalityName && hit.municipalityName !== hit.city
                      ? ` · ${hit.municipalityName}`
                      : ''}
                  </Text>
                </View>
              </Pressable>
            ))
          ) : !loading ? (
            <Text className="px-3 py-3 text-[0.875rem] text-muted">
              {failed
                ? 'Adressesøket svarer ikke. Prøv igjen, eller trykk i kartet.'
                : 'Fant ingen adresse. Prøv en annen skrivemåte, eller trykk i kartet.'}
            </Text>
          ) : null}
        </View>
      ) : null}

      {error ? (
        <Text className="text-[0.8125rem] font-medium text-danger">{error}</Text>
      ) : confirmed ? (
        <Text className="text-[0.8125rem] font-medium text-brand-text">
          {confirmedText}
          {detail ? ` · ${detail}` : ''}
        </Text>
      ) : (
        <Text className="text-[0.8125rem] text-muted">{idleText}</Text>
      )}
    </View>
  );
}
