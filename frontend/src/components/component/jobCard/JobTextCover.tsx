import { useCategories } from '../../../features/categories/hooks';
import { categoryTint, sameCategory } from '../../../assets/images/categories';
import { CategoryIcon } from '../../CategoryIcon';

/**
 * What fills a job card's photo frame when the poster uploaded no photo.
 *
 * It used to be a category stock photo, which people could take for a picture of the
 * actual job. This is a light panel in the category's colour with its icon, and (when
 * `showText`) the title and the first lines of the description. It fills its parent, so
 * it keeps whatever size the photo frame has and the grid stays aligned.
 */
export function JobTextCover({
  job,
  showText = true,
  dimmed = false,
  iconOnly = false,
}: {
  job: { title?: string; description?: string; categories?: string[] };
  /** Off where the card already prints the title and description under the frame. */
  showText?: boolean;
  dimmed?: boolean;
  /** Just the icon, for a small thumbnail (the list view). */
  iconOnly?: boolean;
}) {
  const { data: categories = [] } = useCategories();
  const names = job.categories ?? [];
  const category = categories.find((cat) => names.some((name) => sameCategory(name, cat.name)));
  const tint = categoryTint(names);

  // Without text (the job page, the landing list: the title is printed nearby) the icon and
  // category sit in the middle, clear of the badges and buttons in the frame's corners.
  if (iconOnly)
    return (
      <div
        className={`flex size-full items-center justify-center ${dimmed ? 'opacity-55' : ''}`}
        style={{ backgroundColor: tint.bg, color: tint.fg }}
      >
        <CategoryIcon name={category?.icon} fallback="briefcase" size={30} strokeWidth={1.6} />
      </div>
    );

  if (!showText)
    return (
      <div
        className={`flex size-full flex-col items-center justify-center gap-3 p-4 ${dimmed ? 'opacity-55' : ''}`}
        style={{ backgroundColor: tint.bg, color: tint.fg }}
      >
        <CategoryIcon name={category?.icon} fallback="briefcase" size={56} strokeWidth={1.5} />
        {names[0] && <p className="text-[0.9375rem] font-semibold">{category?.name ?? names[0]}</p>}
      </div>
    );

  return (
    <div
      className={`flex size-full flex-col p-4 sm:p-5 ${dimmed ? 'opacity-55' : ''}`}
      style={{ backgroundColor: tint.bg }}
    >
      <span style={{ color: tint.fg }}>
        <CategoryIcon name={category?.icon} fallback="briefcase" size={44} strokeWidth={1.6} />
      </span>

      {/* pb leaves room for the promoted/urgent badges pinned to the bottom of the frame. */}
      <div className="mt-auto pb-8">
        <p className="line-clamp-3 text-[1.125rem] font-semibold leading-snug tracking-[-0.02em] text-[#0B0B0B] sm:text-[1.25rem]">
          {job.title || 'Uten tittel'}
        </p>
        {job.description && (
          <p className="mt-2 line-clamp-3 text-[0.8125rem] leading-relaxed text-[#3F423C]">
            {job.description}
          </p>
        )}
      </div>
    </div>
  );
}
