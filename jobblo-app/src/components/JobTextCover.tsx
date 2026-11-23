import React, { type ReactNode } from 'react';
import { Text, View } from 'react-native';
import { categoryTint } from '../utils/categoryImage';
import { getCategoryIcon } from '../utils/categoryIcons';

/**
 * What fills a job's photo frame when the poster uploaded no photo (Abdi, "Jobs without
 * photos"). It used to be a category stock photo, which people could take for a picture of
 * the actual job. This is a light panel in the category's colour with its icon large in the
 * corner, and (when `showText`) the title and the first lines of the description. It fills
 * its parent, so it keeps the frame's size and the grid stays aligned. Same as the web's
 * JobTextCover.
 */
export function JobTextCover({
  job,
  showText = true,
  compact = false,
  badges,
  iconOnly = false,
}: {
  job: { title?: string; description?: string; categories?: string[] };
  /** Off where the title and description are already printed under the frame. */
  showText?: boolean;
  /** Smaller type for the 2-column grid. */
  compact?: boolean;
  /** Haster / Sponset: beside the icon, so they do not sit on top of it. */
  badges?: ReactNode;
  /** Just the icon, for a small thumbnail (the list view). */
  iconOnly?: boolean;
}) {
  const category = job.categories?.[0];
  const tint = categoryTint(job.categories);
  const Icon = getCategoryIcon(category ? { name: category } : null);

  // Without text (the job page, the welcome list: the title is printed nearby) the icon and
  // category sit in the middle, clear of the badges and buttons in the frame's corners.
  if (iconOnly)
    return (
      <View
        style={{
          flex: 1,
          backgroundColor: tint.bg,
          alignItems: 'center',
          justifyContent: 'center',
        }}
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
      >
        <Icon size={30} color={tint.fg} strokeWidth={1.6} />
      </View>
    );

  if (!showText)
    return (
      <View
        style={{
          flex: 1,
          backgroundColor: tint.bg,
          alignItems: 'center',
          justifyContent: 'center',
          gap: 10,
          padding: 16,
        }}
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
      >
        <Icon size={56} color={tint.fg} strokeWidth={1.5} />
        {category ? (
          <Text style={{ color: tint.fg, fontSize: 15, fontWeight: '700' }}>{category}</Text>
        ) : null}
      </View>
    );

  return (
    <View
      style={{ flex: 1, backgroundColor: tint.bg, padding: compact ? 12 : 16 }}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    >
      {/* Right padding keeps the row clear of the heart button in the top-right corner. */}
      <View
        style={{
          flexDirection: 'row',
          flexWrap: 'wrap',
          alignItems: 'center',
          gap: 6,
          paddingRight: 36,
        }}
      >
        <Icon size={compact ? 30 : 40} color={tint.fg} strokeWidth={1.6} />
        {badges}
      </View>
      <View style={{ marginTop: 'auto' }}>
        <Text
          numberOfLines={3}
          style={{
            color: '#0B0B0B',
            fontSize: compact ? 15 : 18,
            lineHeight: compact ? 19 : 23,
            fontWeight: '700',
            letterSpacing: -0.3,
          }}
        >
          {job.title || 'Uten tittel'}
        </Text>
        {job.description ? (
          <Text
            numberOfLines={compact ? 2 : 3}
            style={{
              color: '#3F423C',
              fontSize: 13,
              lineHeight: 18,
              marginTop: 4,
            }}
          >
            {job.description}
          </Text>
        ) : null}
      </View>
    </View>
  );
}
