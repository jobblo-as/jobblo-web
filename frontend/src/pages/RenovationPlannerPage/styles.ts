import type { AreaKey, Quality, Scope } from '../../features/renovation/renovationAPI';

/** Formatting and class names shared by the planner pages. */

export type AreaChoice = { scope: Scope; quality?: Quality };

/** A listing photo and the area whose job it goes on ('' = the whole home: every job). */
export type PhotoItem = { file: File; area: AreaKey | '' };

export const kr = (value: number) => `${value.toLocaleString('nb-NO')} kr`;
export const range = (low: number, high: number) =>
  low === high ? kr(low) : `${low.toLocaleString('nb-NO')}–${kr(high)}`;
export const weeks = ([min, max]: [number, number]) =>
  min === max ? `ca. ${min} uke${min === 1 ? '' : 'r'}` : `ca. ${min}–${max} uker`;

// CHIP's shape with its own colours left out: appending active colours to CHIP lost to its
// bg-white/border classes (CSS order, not class order, decides), so nothing looked selected.
const CHIP_SHAPE =
  'inline-flex h-9 items-center gap-2 rounded-full border px-4 text-[0.8125rem] font-medium transition-colors focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#2E6641]/15';
export const chipClass = (active: boolean) =>
  `${CHIP_SHAPE} ${
    active
      ? 'border-[#2E6641] bg-[#EAF1E9] text-[#2E6641]'
      : 'border-[#E6E7E1] bg-white text-[#63665F] hover:border-[#2E6641]/45 hover:text-[#2E6641]'
  }`;

export const INPUT =
  'h-11 w-full rounded-xl border border-[#E6E7E1] bg-white px-3.5 text-[0.9375rem] text-[#0B0B0B] outline-none transition focus:border-[#2E6641]/45 focus:ring-4 focus:ring-[#2E6641]/12';

export const FIELD_LABEL = 'text-[0.8125rem] font-medium text-[#63665F]';
