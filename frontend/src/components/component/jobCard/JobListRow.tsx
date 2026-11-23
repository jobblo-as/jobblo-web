import { Link } from 'react-router-dom';
import { MapPin, ShieldCheck, Zap } from 'lucide-react';
import type { Jobs } from '../../../types/Jobs.ts';
import { jobPhoto } from '../../../assets/images/categories';
import { JobTextCover } from './JobTextCover';

/**
 * A job in the list view (the grid/list toggle next to "Nyeste først", "Jobs without photos"
 * task 4). Text first: title, the first lines of the description, then price, place and
 * SafePay; the photo (or the category's colour and icon) is a small thumbnail on the right.
 * It suits jobs posted without a photo, which are most of the text anyway.
 *
 * A plain link: unlike the grid card it holds no buttons (save is on the job page).
 */
export function JobListRow({ job }: { job: Jobs }) {
  const photo = jobPhoto(job);
  const price =
    typeof job.price === 'number' ? job.price.toLocaleString('nb-NO') : job.price || '0';
  const place = job.location?.city || job.location?.address || 'Norge';
  const isClosed = job.status === 'closed';

  return (
    <Link
      to={`/job-listing/${job._id}`}
      className="group flex gap-4 rounded-2xl border border-[#E6E7E1] bg-white p-4 transition-colors hover:border-[#2E6641]/45 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#2E6641]/20 sm:gap-5 sm:p-5"
    >
      <div className="min-w-0 flex-1">
        {(job.urgent || job.promoted || isClosed) && (
          <div className="mb-1.5 flex flex-wrap gap-1.5">
            {job.urgent && (
              <span className="inline-flex h-6 items-center gap-1 rounded-full bg-[#122A1C] px-2.5 text-[0.6875rem] font-semibold text-white">
                <Zap size={11} strokeWidth={2.4} /> Haster
              </span>
            )}
            {job.promoted && (
              <span className="inline-flex h-6 items-center gap-1 rounded-full bg-[#EAF1E9] px-2.5 text-[0.6875rem] font-semibold text-[#2E6641]">
                <Zap size={11} strokeWidth={2.4} /> Sponset
              </span>
            )}
            {isClosed && (
              <span className="inline-flex h-6 items-center rounded-full bg-[#EDEEE8] px-2.5 text-[0.6875rem] font-semibold text-[#63665F]">
                Fullført
              </span>
            )}
          </div>
        )}
        <h3 className="line-clamp-2 text-[1rem] font-semibold leading-snug tracking-[-0.02em] text-[#0B0B0B] group-hover:text-[#2E6641] sm:text-[1.0625rem]">
          {job.title || 'Uten tittel'}
        </h3>
        {job.description && (
          <p className="mt-1 line-clamp-2 text-[0.875rem] leading-relaxed text-[#63665F]">
            {job.description}
          </p>
        )}
        <p className="mt-2.5 flex flex-wrap items-center gap-x-1.5 text-[0.8125rem] leading-5 text-[#63665F]">
          <span className="font-semibold tabular-nums text-[#0B0B0B]">{price} kr</span>
          <span aria-hidden="true" className="text-[#9B9E96]">
            ·
          </span>
          <span className="inline-flex min-w-0 items-center gap-1">
            <MapPin size={12} strokeWidth={2} className="shrink-0 text-[#9B9E96]" />
            <span className="truncate">{place}</span>
          </span>
          <span aria-hidden="true" className="text-[#9B9E96]">
            ·
          </span>
          <span className="inline-flex items-center gap-1 font-medium text-[#2E6641]">
            <ShieldCheck size={12} strokeWidth={2.2} />
            SafePay
          </span>
        </p>
      </div>

      <div className="size-20 shrink-0 overflow-hidden rounded-xl sm:size-24">
        {photo ? (
          <img
            src={photo}
            alt=""
            loading="lazy"
            decoding="async"
            className={`size-full object-cover ${isClosed ? 'opacity-55' : ''}`}
          />
        ) : (
          <JobTextCover job={job} iconOnly dimmed={isClosed} />
        )}
      </div>
    </Link>
  );
}
