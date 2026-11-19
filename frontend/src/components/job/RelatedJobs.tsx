import { useNavigate } from 'react-router-dom';
import { MapPin } from 'lucide-react';
import { useRecommendedJobsQuery } from '../../features/jobDetail/hook.ts';
import { JobCard } from '../component/jobCard/JobCard';
import { JobCardSkeleton } from '../Loading/JobCardSkeleton';
import type { Jobs } from '../../types/Jobs';

interface RelatedJobsProps {
  currentJobId?: string;
  /** The signed-in user: their own jobs are left out. */
  viewerId?: string | null;
  /** Jobs the user has a pending or accepted application on: left out. */
  appliedJobIds?: ReadonlySet<string>;
}

const RelatedJobs: React.FC<RelatedJobsProps> = ({ currentJobId, viewerId, appliedJobIds }) => {
  const navigate = useNavigate();

  const {
    data: recommendedJobs = [],
    isLoading: isRecommendedLoading,
    hasNextPage,
    isFetchingNextPage,
    fetchNextPage,
  } = useRecommendedJobsQuery(currentJobId || '', viewerId, appliedJobIds);

  if (isRecommendedLoading) {
    return (
      <div className="grid grid-cols-2 gap-x-4 gap-y-8 sm:grid-cols-3 sm:gap-x-5 lg:grid-cols-4">
        {[1, 2, 3, 4, 5, 6].map((i) => (
          <JobCardSkeleton key={i} />
        ))}
      </div>
    );
  }

  // A first page made only of the viewer's own or applied-to jobs still has more behind it.
  if (recommendedJobs.length === 0 && !hasNextPage) {
    return (
      <div className="py-10 px-4">
        <div className="flex flex-col items-center justify-center p-10 bg-gray-50 border-2 border-dashed border-gray-200 rounded-2xl">
          <div className="bg-white p-4 rounded-full shadow-sm mb-4">
            <MapPin size={28} className="text-gray-400" />
          </div>
          <h4 className="text-base font-semibold text-gray-800 mb-1">Ingen jobber funnet</h4>
          <p className="text-gray-500 text-center text-sm leading-relaxed">
            Vi fant ingen anbefalte jobber akkurat nå.
          </p>
          <button
            onClick={() => navigate('/home')}
            className="mt-5 text-sm font-semibold text-custom-green hover:underline"
          >
            Se alle tilgjengelige jobber →
          </button>
        </div>
      </div>
    );
  }

  return (
    <div>
      <div className="grid grid-cols-2 gap-x-4 gap-y-8 sm:grid-cols-3 sm:gap-x-5 lg:grid-cols-4">
        {recommendedJobs.map((job: Jobs) => (
          <JobCard key={job._id} job={job} />
        ))}
        {isFetchingNextPage && [1, 2, 3, 4].map((i) => <JobCardSkeleton key={`more-${i}`} />)}
      </div>
      {hasNextPage && (
        <div className="mt-8 flex justify-center">
          <button
            type="button"
            onClick={() => void fetchNextPage()}
            disabled={isFetchingNextPage}
            className="rounded-full border border-[#D4D6CF] px-6 py-2.5 text-[0.9375rem] font-semibold text-[#0B0B0B] transition-colors hover:bg-[#F3F4EF] disabled:opacity-60"
          >
            {isFetchingNextPage ? 'Laster…' : 'Vis flere oppdrag'}
          </button>
        </div>
      )}
    </div>
  );
};

export default RelatedJobs;
