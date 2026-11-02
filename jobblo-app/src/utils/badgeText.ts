/**
 * The `text-*` / `dark:text-*` classes of a badge's tone ("bg-tint text-brand-text" →
 * "text-brand-text").
 * React Native Text does not inherit colour from its View, so a tone set on the View left
 * the label default black: invisible on the dark tint in dark mode.
 */
export const badgeText = (tone: string) =>
  tone
    .split(/\s+/)
    .filter((c) => /^(dark:)?text-/.test(c))
    .join(' ');
