import React from 'react';
import { Pressable, ScrollView, Text, View, useWindowDimensions } from 'react-native';
import { getAllCategoriesIcon, getCategoryIcon } from '../utils/categoryIcons';
import type { Category } from '../types/Category';
import { TC } from '../theme/colors';

interface CategoryGridProps {
  categories: Array<Category | { name: string }>;
  /** '' = "Alle". */
  selected: string;
  onSelect: (name: string) => void;
}

/**
 * FINN-style category grid: always two rows, four columns on screen, a line icon over its
 * name, no boxes. More categories continue to the right and scroll sideways. The selected
 * one gets a solid green circle with a white icon.
 */
export function CategoryGrid({ categories, selected, onSelect }: CategoryGridProps) {
  const { width } = useWindowDimensions();
  const tileWidth = (width - 32) / 4; // 16 px screen padding each side
  // Under 80 pt a tile (320 pt phones) split "Hagearbeid" mid-word: smaller label, less padding.
  const narrow = tileWidth < 80;
  const tiles = [{ name: 'Alle' }, ...categories];
  // Reads left to right per row: the first half fills the top row, the rest the bottom row.
  const perRow = Math.max(4, Math.ceil(tiles.length / 2));
  const columns = Array.from({ length: perRow }, (_, i) =>
    [tiles[i], tiles[i + perRow]].filter(Boolean)
  );

  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      className="-mx-4"
      contentContainerStyle={{ paddingHorizontal: 16 }}
      snapToInterval={tileWidth}
      decelerationRate="fast"
    >
      {columns.map((column, columnIndex) => (
        <View key={columnIndex} style={{ width: tileWidth }}>
          {column.map((category) => {
            const isAll = category.name === 'Alle';
            const active = isAll ? selected === '' : selected === category.name;
            const Icon = isAll ? getAllCategoriesIcon() : getCategoryIcon(category);
            return (
              <Pressable
                key={category.name}
                onPress={() => onSelect(isAll || active ? '' : category.name)}
                accessibilityRole="button"
                accessibilityState={{ selected: active }}
                accessibilityLabel={isAll ? 'Alle kategorier' : category.name}
                className={`h-[104px] items-center ${narrow ? 'px-0.5' : 'px-1'} pt-2 active:opacity-60`}
              >
                {/* Android dropped the rounded corners when the background colour changed on
                    an existing view (a square showed instead of a circle), with a className
                    and with inline style alike. Keyed on `active`, the view is created anew
                    with its colour and radius together, which Android does draw round. */}
                <View
                  key={active ? 'on' : 'off'}
                  style={{
                    width: 48,
                    height: 48,
                    borderRadius: 24,
                    alignItems: 'center',
                    justifyContent: 'center',
                    // Solid brand green: the soft tint was almost the page colour in light
                    // mode, so the selected category could not be told apart.
                    backgroundColor: active ? TC.brand : 'transparent',
                  }}
                >
                  <Icon size={24} color={active ? '#FFFFFF' : TC.brandText} strokeWidth={1.75} />
                </View>
                <Text
                  className={`mt-1.5 text-center ${narrow ? 'text-[0.75rem]' : 'text-[0.8125rem]'} leading-4 ${active ? 'font-semibold text-brand-text' : 'text-ink'}`}
                  numberOfLines={2}
                  adjustsFontSizeToFit
                  minimumFontScale={0.85}
                >
                  {category.name}
                </Text>
              </Pressable>
            );
          })}
        </View>
      ))}
    </ScrollView>
  );
}
