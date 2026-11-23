import { useNavigate, useParams } from 'react-router-dom';
import { ExternalLink, Loader2 } from 'lucide-react';
import {
  CONTAINER,
  HEADING,
  MICRO_LABEL,
  PRIMARY_BUTTON,
  SUBHEADING,
  TEXT_LINK,
} from '../../theme/brand';
import { useSharedRenovationPlan } from '../../features/renovation/hooks';
import { fromSavedPlan, storePlanState } from '../../features/renovation/planState';
import { EstimateView, NotesList } from './parts';

/**
 * A shared renovation plan (/oppussingskalkulator/delt/:shareId): read-only, without the
 * owner. The estimate is recomputed at today's rates. "Lag din egen plan" copies it into the
 * visitor's own planner as a new, unsaved plan.
 */
export default function SharedRenovationPlanPage() {
  const { shareId = '' } = useParams();
  const navigate = useNavigate();
  const { data: plan, isLoading, isError } = useSharedRenovationPlan(shareId);

  if (isLoading)
    return (
      <div className="flex min-h-[50vh] items-center justify-center">
        <Loader2 className="animate-spin text-[#2E6641]" aria-label="Laster" />
      </div>
    );
  if (isError || !plan)
    return (
      <div className={`${CONTAINER} py-16 text-center`}>
        <p className={SUBHEADING}>Planen finnes ikke, eller den deles ikke lenger.</p>
        <button
          type="button"
          onClick={() => navigate('/oppussingskalkulator')}
          className={`${PRIMARY_BUTTON} mx-auto mt-6`}
        >
          Lag din egen plan
        </button>
      </div>
    );

  const { facts } = plan.plan;
  const copyToPlanner = () => {
    storePlanState(fromSavedPlan(plan, false));
    navigate('/oppussingskalkulator');
  };

  return (
    <div className="bg-[#EFF0EA]">
      <div className={`${CONTAINER} max-w-200 py-10 sm:py-14`}>
        <p className={MICRO_LABEL}>Delt oppussingsplan</p>
        <h1 className={`mt-3 ${HEADING}`}>{plan.title}</h1>
        <p className={`mt-4 ${SUBHEADING}`}>
          {plan.homeType ? `${plan.homeType[0].toUpperCase()}${plan.homeType.slice(1)} · ` : ''}
          {facts.sizeM2} m² · {facts.rooms} stuer og soverom · {facts.bathrooms} bad
          {plan.yearBuilt ? ` · bygget ${plan.yearBuilt}` : ''}
        </p>
        {plan.finnCode && (
          <a
            href={`https://www.finn.no/${plan.finnCode}`}
            target="_blank"
            rel="noopener noreferrer"
            className={`${TEXT_LINK} mt-2 inline-flex items-center gap-1 text-[0.875rem]`}
          >
            Se boligannonsen på FINN <ExternalLink size={13} />
          </a>
        )}
        <NotesList notes={plan.notes} />

        {plan.estimate ? (
          <EstimateView estimate={plan.estimate}>
            <button
              type="button"
              onClick={copyToPlanner}
              className={`${PRIMARY_BUTTON} mt-6 w-full`}
            >
              Lag din egen plan fra denne
            </button>
          </EstimateView>
        ) : (
          <p className={`mt-8 ${SUBHEADING}`}>
            Prisene i denne planen må beregnes på nytt.{' '}
            <button type="button" onClick={copyToPlanner} className={TEXT_LINK}>
              Åpne den i kalkulatoren
            </button>
            .
          </p>
        )}
      </div>
    </div>
  );
}
