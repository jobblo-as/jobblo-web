import React from 'react';
import { Plus, Briefcase, Users, Bell, Star, ClipboardList } from 'lucide-react';

interface EmptyStateProps {
  type: 'jobs' | 'applicants' | 'notifications' | 'reviews' | 'applications';
  title?: string;
  description?: string;
  actionLabel?: string;
  onActionClick?: () => void;
}

const config: Record<
  string,
  {
    icon: React.ReactNode;
    defaultTitle: string;
    defaultDescription: string;
    defaultActionLabel: string | null;
  }
> = {
  jobs: {
    icon: <Briefcase size={40} className="text-custom-green" />,
    defaultTitle: 'Ingen oppdrag enda',
    defaultDescription: 'Opprett ditt første oppdrag og finn kvalifiserte arbeidere.',
    defaultActionLabel: 'Opprett oppdrag',
  },
  applicants: {
    icon: <Users size={40} className="text-custom-green" />,
    defaultTitle: 'Ingen søkere enda',
    defaultDescription: 'Vent på at søkere skal søke om jobben din.',
    defaultActionLabel: null,
  },
  notifications: {
    icon: <Bell size={40} className="text-custom-green" />,
    defaultTitle: 'Ingen varsler',
    defaultDescription: 'Du har ingen nye varsler enda.',
    defaultActionLabel: null,
  },
  reviews: {
    icon: <Star size={40} className="text-custom-green" />,
    defaultTitle: 'Ingen anmeldelser enda',
    defaultDescription: 'Start å samle anmeldelser etter fullførte oppdrag.',
    defaultActionLabel: null,
  },
  applications: {
    icon: <ClipboardList size={40} className="text-custom-green" />,
    defaultTitle: 'Ingen søknader enda',
    defaultDescription:
      'Du har ikke søkt på noen oppdrag ennå. Utforsk oppdrag for å komme i gang.',
    defaultActionLabel: 'Utforsk oppdrag',
  },
};

/** What happens after "Opprett annonse" — shown under an empty job list. */
const JOB_STEPS: Array<[string, string]> = [
  ['Beskriv jobben', 'Hva, hvor og når. Tar et par minutter.'],
  ['Få søknader', 'Folk i nærheten sender deg tilbud.'],
  ['Velg og betal trygt', 'Pengene holdes av SafePay til jobben er gjort.'],
];

const EmptyState: React.FC<EmptyStateProps> = ({
  type,
  title,
  description,
  actionLabel,
  onActionClick,
}) => {
  const typeConfig = config[type] ?? config['jobs'];
  const { icon, defaultTitle, defaultDescription, defaultActionLabel } = typeConfig;

  return (
    <div className="mx-auto w-full max-w-2xl rounded-3xl border border-[#E6E7E1] bg-white px-6 py-12 text-center sm:px-10">
      <div className="mx-auto mb-5 flex size-16 items-center justify-center rounded-2xl bg-[#EAF1E9] [&_svg]:size-7">
        {icon}
      </div>
      <h3 className="text-[1.125rem] font-bold tracking-[-0.02em] text-[#0B0B0B]">
        {title || defaultTitle}
      </h3>
      <p className="mx-auto mt-2 max-w-sm text-[0.875rem] leading-relaxed text-[#63665F]">
        {description || defaultDescription}
      </p>
      {(actionLabel || defaultActionLabel) && onActionClick && (
        <button
          type="button"
          onClick={onActionClick}
          className="mt-6 inline-flex h-11 items-center justify-center gap-2 rounded-xl bg-[#2E6641] px-5 text-[0.9375rem] font-semibold text-white transition-colors hover:bg-[#255335] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#2E6641]/20"
        >
          <Plus size={16} strokeWidth={2.4} />
          {actionLabel || defaultActionLabel}
        </button>
      )}
      {type === 'jobs' && onActionClick && (
        <ol className="mx-auto mt-10 grid max-w-xl gap-4 border-t border-[#EFF0EA] pt-8 text-left sm:grid-cols-3">
          {JOB_STEPS.map(([step, text], i) => (
            <li key={step} className="flex gap-3">
              <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-[#F0F1EC] text-[0.75rem] font-semibold text-[#0B0B0B]">
                {i + 1}
              </span>
              <span className="text-[0.8125rem] leading-snug text-[#63665F]">
                <span className="block font-semibold text-[#0B0B0B]">{step}</span>
                {text}
              </span>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
};

export default EmptyState;
