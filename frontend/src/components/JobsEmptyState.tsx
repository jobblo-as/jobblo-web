import type { ReactNode } from 'react';
import { ShieldCheck } from 'lucide-react';
import { SERVICE_SHOWCASE } from '../assets/images/categories';
import { CARD } from '../theme/brand';

/**
 * "No jobs" for a job list (the /home feed, the search page): three of the services
 * overlapped, so the page still looks like Jobblo when there is nothing to list.
 * `actions` = the buttons; `reassure` adds the SafePay line under them.
 */
export function JobsEmptyState({
  title,
  text,
  actions,
  reassure = true,
  className = '',
}: {
  title: string;
  text: string;
  actions?: ReactNode;
  reassure?: boolean;
  className?: string;
}) {
  return (
    <div
      className={`${CARD} relative overflow-hidden px-6 py-12 text-center sm:py-16 ${className}`}
    >
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -top-40 left-1/2 size-120 -translate-x-1/2 rounded-full bg-[radial-gradient(circle,rgba(46,102,65,0.10),rgba(46,102,65,0)_68%)]"
      />
      <div aria-hidden="true" className="relative mx-auto flex w-fit -space-x-4">
        {SERVICE_SHOWCASE.slice(0, 3).map((s, i) => (
          <img
            key={s.name}
            src={s.src}
            alt=""
            loading="lazy"
            className={`size-16 rounded-full border-4 border-white object-cover shadow-[0_10px_24px_rgba(11,11,11,0.10)] sm:size-20 ${
              i === 1 ? '-translate-y-2' : ''
            }`}
          />
        ))}
      </div>
      <h3 className="relative mt-6 text-[1.25rem] font-bold tracking-[-0.01em] text-[#0B0B0B] sm:text-[1.5rem]">
        {title}
      </h3>
      <p className="relative mx-auto mt-2 max-w-md text-[0.9375rem] leading-relaxed text-[#63665F]">
        {text}
      </p>
      {actions && (
        <div className="relative mt-7 flex flex-col items-center justify-center gap-3 sm:flex-row">
          {actions}
        </div>
      )}
      {reassure && (
        <p className="relative mt-6 flex items-center justify-center gap-1.5 text-[0.8125rem] font-medium text-[#2E6641]">
          <ShieldCheck size={14} strokeWidth={2.3} aria-hidden="true" />
          Betaling holdes trygt til du har godkjent
        </p>
      )}
    </div>
  );
}
