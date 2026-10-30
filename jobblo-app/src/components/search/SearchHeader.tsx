import React from 'react';
import { View, Text, Pressable } from 'react-native';
import { Search, SlidersHorizontal, X } from 'lucide-react-native';
import { SearchInput } from '../ui/SearchInput';
import { GlassBackButton, GlassFill, useGlass } from '../ui/GlassButton';
import { LIQUID_GLASS } from '../GlassTabBar';
import { TC } from '../../theme/colors';

interface SearchHeaderProps {
  title: string;
  onBack: () => void;
  searchText: string;
  onSearchChange: (text: string) => void;
  /** The search field shows under the bar while open. */
  searchOpen: boolean;
  onToggleSearch: () => void;
  onFilterPress: () => void;
  activeFilterCount: number;
}

/**
 * FINN's category bar: "‹" in a glass circle, the title centred, and a glass pill with
 * filter and search on the right. Search opens the field under the bar; the filter icon
 * carries the active-filter count.
 */
export function SearchHeader({
  title,
  onBack,
  searchText,
  onSearchChange,
  searchOpen,
  onToggleSearch,
  onFilterPress,
  activeFilterCount,
}: SearchHeaderProps) {
  const pill = useGlass(22);
  return (
    <View className="px-4 pb-3 pt-3">
      <View className="h-11 flex-row items-center">
        <GlassBackButton label="forrige side" onPress={onBack} />
        <Text
          numberOfLines={1}
          accessibilityRole="header"
          className="flex-1 px-2 text-center text-[1.0625rem] font-semibold text-ink"
        >
          {title}
        </Text>
        <View
          className="h-11 flex-row items-center px-1"
          style={[pill, { elevation: LIQUID_GLASS ? 0 : 4 }]}
        >
          <GlassFill radius={22} />
          <Pressable
            onPress={onFilterPress}
            accessibilityRole="button"
            accessibilityLabel={
              activeFilterCount > 0 ? `Filtrer, ${activeFilterCount} aktive` : 'Filtrer'
            }
            hitSlop={4}
            className="h-10 w-10 items-center justify-center active:opacity-60"
          >
            <SlidersHorizontal size={19} color={TC.ink} strokeWidth={2} />
            {activeFilterCount > 0 ? (
              <View className="absolute right-0.5 top-0.5 h-4 min-w-4 items-center justify-center rounded-full bg-brand px-1">
                <Text className="text-[0.6875rem] font-bold text-white">{activeFilterCount}</Text>
              </View>
            ) : null}
          </Pressable>
          <Pressable
            onPress={onToggleSearch}
            accessibilityRole="button"
            accessibilityLabel={searchOpen ? 'Lukk søk' : 'Søk etter oppdrag'}
            accessibilityState={{ expanded: searchOpen }}
            hitSlop={4}
            className="h-10 w-10 items-center justify-center active:opacity-60"
          >
            {searchOpen ? (
              <X size={20} color={TC.ink} strokeWidth={2} />
            ) : (
              <Search size={19} color={TC.ink} strokeWidth={2} />
            )}
          </Pressable>
        </View>
      </View>

      {searchOpen ? (
        <View className="mt-3 flex-row">
          <SearchInput
            value={searchText}
            onChange={onSearchChange}
            placeholder="Søk etter oppdrag"
            autoFocus={!searchText}
          />
        </View>
      ) : null}
    </View>
  );
}
