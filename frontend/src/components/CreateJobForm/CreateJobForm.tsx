import { useState, useEffect } from 'react';
import toast from 'react-hot-toast';
import { createUrgentPayment, getUrgentStatus } from '../../api/stripeAPI';
import { errorBody } from '../../utils/getErrorMessage';
import { Image, Sparkles, Loader2, AlertCircle, X, ChevronDown, ChevronUp } from 'lucide-react';
import { ImageUpload } from './ImageUpload';
import { BasicInformation } from './BasicInformation';
import { TimeAndPlace } from './TimeAndPlace';
import { PaymentInformation } from './PaymentInformation';
import { StepIndicator } from './StepIndicator';
import { PackageStep } from './PackageStep';
import { ContactInformation } from './ContactInformation';
import { FormActions } from './FormActions';
import { JobPreviewModal } from './JobPreviewModal';
import { AiDraftReviewDialog } from './AiDraftReviewDialog';
import { AiDraftLoadingDialog } from './AiDraftLoadingDialog';
import { ChecklistStep } from './ChecklistStep';
import { useCreateJobForm } from '../../hooks/useCreateJobForm';
import { CARD } from '../../theme/brand';

/** The two small controls in the smart-fill card's corner. */
const AI_ICON_BUTTON =
  'flex size-8 items-center justify-center rounded-full text-[#9B9E96] transition-colors hover:bg-[#F4F6F0] hover:text-[#0B0B0B] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2E6641]/25';

interface InitialData {
  title?: string;
  description?: string;
  price?: string | number;
  address?: string;
  city?: string;
  countyCode?: string;
  municipalityCode?: string;
  areaCode?: string;
  postalCode?: string;
  latitude?: number;
  longitude?: number;
  categories?: string | string[];
  urgent?: boolean;
  equipment?: string;
  fromDate?: string;
  toDate?: string;
  durationValue?: string | number;
  durationUnit?: string;
  paymentType?: string;
  hourlyRate?: string | number;
  maxApplicants?: string | number;
  phone?: string;
  email?: string;
  images?: string[];
}

interface CreateJobFormProps {
  onSubmit: (formData: FormData) => void | Promise<unknown>;
  userId: string;
  initialData?: InitialData;
  isEditMode?: boolean;
}

export default function CreateJobForm({
  onSubmit,
  userId,
  initialData,
  isEditMode = false,
}: CreateJobFormProps) {
  const {
    currentStep,
    setCurrentStep,
    title,
    setTitle,
    description,
    setDescription,
    address,
    setAddress,
    city,
    setCity,
    countyCode,
    setCountyCode,
    municipalityCode,
    setMunicipalityCode,
    areaCode,
    setAreaCode,
    postalCode,
    setPostalCode,
    coordinates,
    setCoordinates,
    categories,
    setCategories,
    price,
    setPrice,
    tags,
    setTags,
    setDurationValue,
    setDurationUnit,
    setHourlyRate,
    durationValue,
    durationUnit,
    hourlyRate,
    paymentType,
    setPaymentType,
    urgent,
    setUrgent,
    maxApplicants,
    setMaxApplicants,
    fromDate,
    setFromDate,
    toDate,
    setToDate,
    phone,
    setPhone,
    email,
    setEmail,
    selectedImages,
    handleImageSelection,
    handleExistingImageRemove,
    imageItems,
    moveImage,
    showPreview,
    setShowPreview,
    smartFillPrompt,
    setSmartFillPrompt,
    handleAiSmartFill,
    cancelAiSmartFill,
    urgentPurchaseId,
    setUrgentPurchaseId,
    aiDraftRows,
    applyAiDraft,
    smartFillPricingNote,
    setSmartFillPricingNote,
    isGeneratingFullListing,
    isSubmitting,
    handleNext,
    handleBack,
    handleFinalSubmit,
    validateAll,
    handleCancel,
    previewJobData,
    errors,
    checklistItems,
    setChecklistItems,
  } = useCreateJobForm(userId, initialData, isEditMode, onSubmit);

  // "Nesten ferdig" (new jobs only): shown after page 2 validates, before publishing.
  const [packageOpen, setPackageOpen] = useState(false);

  // Hast is paid before publishing: Stripe sends the user back here with ?hast=paid or
  // ?hast=cancelled; the saved draft refills the form, and the server confirms the payment.
  const [hastBusy, setHastBusy] = useState(false);
  const startHastPayment = async () => {
    if (!validateAll()) {
      setPackageOpen(false);
      return;
    }
    setHastBusy(true);
    try {
      const res = await createUrgentPayment();
      // Paid before and not used yet (e.g. the page reloaded): no second charge.
      if (res.alreadyPaid && res.purchaseId) {
        setUrgentPurchaseId(res.purchaseId);
        setHastBusy(false);
        return;
      }
      if (res.url) window.location.assign(res.url);
    } catch (err) {
      setHastBusy(false);
      toast.error(errorBody(err)?.message || 'Kunne ikke starte betalingen. Prøv igjen.');
    }
  };
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const outcome = params.get('hast');
    if (!outcome || isEditMode) return;
    const sessionId = params.get('session_id');
    window.history.replaceState(null, '', window.location.pathname);
    setPackageOpen(true);
    setUrgent(true);
    if (outcome !== 'paid' || !sessionId) {
      toast('Betalingen ble avbrutt. Du kan prøve igjen eller velge Standard.');
      return;
    }
    let cancelled = false;
    setHastBusy(true);
    (async () => {
      // The webhook may still be on its way: ask a few times.
      for (let attempt = 0; attempt < 10 && !cancelled; attempt += 1) {
        try {
          const data = await getUrgentStatus(sessionId);
          if (data.status === 'paid') {
            setUrgentPurchaseId(data.purchaseId);
            setHastBusy(false);
            return;
          }
          if (data.status !== 'pending') break;
        } catch {
          // retry below
        }
        await new Promise((resolve) => setTimeout(resolve, 2000));
      }
      if (!cancelled) {
        setHastBusy(false);
        toast.error('Fant ingen fullført betaling. Prøv å betale på nytt.');
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // AI panel state with localStorage
  const [isAiPanelHidden, setIsAiPanelHidden] = useState(() => {
    const saved = localStorage.getItem('jobblo-ai-panel-hidden');
    return saved === 'true';
  });
  const [isAiPanelMinimized, setIsAiPanelMinimized] = useState(() => {
    const saved = localStorage.getItem('jobblo-ai-panel-minimized');
    return saved === 'true';
  });

  useEffect(() => {
    localStorage.setItem('jobblo-ai-panel-hidden', isAiPanelHidden.toString());
  }, [isAiPanelHidden]);

  useEffect(() => {
    localStorage.setItem('jobblo-ai-panel-minimized', isAiPanelMinimized.toString());
  }, [isAiPanelMinimized]);

  return (
    <div className="mx-auto w-full max-w-3xl px-4 pb-4 sm:px-6">
      <StepIndicator
        currentStep={packageOpen ? 3 : currentStep}
        setCurrentStep={(step) => {
          setPackageOpen(false);
          setCurrentStep(step);
        }}
        extraStep={isEditMode ? undefined : 'Nesten ferdig'}
      />

      <form onSubmit={(e) => e.preventDefault()}>
        <div>
          {packageOpen && (
            <PackageStep
              urgent={urgent}
              setUrgent={setUrgent}
              onPay={startHastPayment}
              paying={hastBusy}
              paid={!!urgentPurchaseId}
            />
          )}

          {!packageOpen && currentStep === 1 && (
            <div className="animate-in fade-in slide-in-from-bottom-2 space-y-5 duration-300">
              {/* `data-invalid` is what `scrollToFirstError` looks for. This card marks its
                  error state with a bespoke `border-[#B4453A]` rather than the `border-red-500`
                  the step components use, so it matched none of the utility's selectors:
                  "Vennligst last opp minst ett bilde" was the one error on the form that never
                  scrolled into view. */}
              <div
                data-invalid={errors?.images ? 'true' : undefined}
                className={`box-card-custom p-5 md:p-6 transition-colors ${
                  errors?.images ? 'border-[#B4453A]' : ''
                }`}
              >
                <div className="mb-5 flex items-start gap-3">
                  <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-[#EAF1E9] text-[#2E6641]">
                    <Image size={16} strokeWidth={2} />
                  </span>
                  <div>
                    <h2 className="text-[0.9375rem] font-semibold tracking-[-0.02em] text-[#0B0B0B]">
                      Bilder <span className="font-normal text-[#9B9E96]">· valgfritt</span>
                    </h2>
                    <p className="mt-0.5 text-[0.8125rem] text-[#63665F]">
                      Vis frem oppdraget med inntil 6 bilder
                    </p>
                  </div>
                </div>
                <ImageUpload
                  items={imageItems}
                  onAddFiles={(files) => handleImageSelection([...selectedImages, ...files])}
                  onRemove={(item) =>
                    item.file
                      ? handleImageSelection(selectedImages.filter((file) => file !== item.file))
                      : handleExistingImageRemove(item.url)
                  }
                  onMove={moveImage}
                />
                {errors?.images && (
                  <p className="mt-4 flex items-center gap-1.5 text-[0.8125rem] font-medium text-[#B4453A]">
                    <AlertCircle size={14} /> {errors.images}
                  </p>
                )}
              </div>

              {/* AI Assistant Integrated Section */}
              {/* Smart-fill. It was a dark green slab with an indigo (#4F46E5) button and
                  a yellow sparkle — three colours from outside the palette, on the loudest
                  element of the page, above the form it is only an optional shortcut to.
                  It is a quiet card now, and the button that starts it is outlined rather
                  than filled, so the eye still lands on the form first. */}
              {!isAiPanelHidden && (
                <div className={`${CARD} overflow-hidden`}>
                  {isAiPanelMinimized ? (
                    <div className="flex items-center justify-between gap-3 p-4">
                      <button
                        type="button"
                        onClick={() => setIsAiPanelMinimized(false)}
                        className="flex min-w-0 flex-1 items-center gap-3 text-left"
                      >
                        <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-[#EAF1E9] text-[#2E6641]">
                          <Sparkles size={16} strokeWidth={2} />
                        </span>
                        <span className="min-w-0">
                          <span className="block text-[0.9375rem] font-semibold text-[#0B0B0B]">
                            Foreslå et utkast
                          </span>
                          <span className="block truncate text-[0.8125rem] text-[#63665F]">
                            Klikk for å utvide
                          </span>
                        </span>
                      </button>
                      <div className="flex shrink-0 items-center gap-1">
                        <button
                          type="button"
                          onClick={() => setIsAiPanelMinimized(false)}
                          aria-label="Utvid smart-utfylling"
                          className={AI_ICON_BUTTON}
                        >
                          <ChevronDown size={16} />
                        </button>
                        <button
                          type="button"
                          onClick={() => setIsAiPanelHidden(true)}
                          aria-label="Skjul smart-utfylling"
                          className={AI_ICON_BUTTON}
                        >
                          <X size={16} />
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div className="p-5 md:p-6">
                      <div className="flex items-start gap-3">
                        <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-[#EAF1E9] text-[#2E6641]">
                          <Sparkles size={16} strokeWidth={2} />
                        </span>
                        <div className="min-w-0 flex-1">
                          <h2 className="text-[0.9375rem] font-semibold tracking-[-0.02em] text-[#0B0B0B]">
                            Foreslå et utkast
                          </h2>
                          <p className="mt-1 max-w-md text-[0.8125rem] leading-relaxed text-[#63665F]">
                            Bruk bildene over, skriv kort hva som skal gjøres, eller begge deler. Vi
                            lager et utkast du ser over før noe fylles inn.
                          </p>
                        </div>
                        <div className="flex shrink-0 items-center gap-1">
                          <button
                            type="button"
                            onClick={() => setIsAiPanelMinimized(true)}
                            aria-label="Minimer smart-utfylling"
                            className={AI_ICON_BUTTON}
                          >
                            <ChevronUp size={16} />
                          </button>
                          <button
                            type="button"
                            onClick={() => setIsAiPanelHidden(true)}
                            aria-label="Skjul smart-utfylling"
                            className={AI_ICON_BUTTON}
                          >
                            <X size={16} />
                          </button>
                        </div>
                      </div>

                      <div className="mt-4 space-y-3">
                        <textarea
                          value={smartFillPrompt}
                          onChange={(e) => setSmartFillPrompt(e.target.value)}
                          aria-label="Beskriv oppdraget (valgfritt)"
                          placeholder="Valgfritt: f.eks. Male en liten bod på 8 m² utvendig, bør være ferdig i mai."
                          className="min-h-25 w-full resize-none rounded-2xl border border-[#E6E7E1] bg-white px-4 py-3 text-[0.9375rem] leading-relaxed text-[#0B0B0B] outline-none transition-colors placeholder:text-[#9B9E96] focus:border-[#2E6641]/45 focus:ring-4 focus:ring-[#2E6641]/10"
                        />
                        <div className="flex flex-wrap items-center gap-3">
                          <button
                            type="button"
                            onClick={handleAiSmartFill}
                            disabled={
                              isGeneratingFullListing ||
                              (selectedImages.length === 0 && smartFillPrompt.trim().length < 5)
                            }
                            className="inline-flex h-11 items-center gap-2 rounded-full bg-[#2E6641] px-6 text-[0.9375rem] font-semibold text-white transition-colors hover:bg-[#255335] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#2E6641]/25 disabled:cursor-not-allowed disabled:opacity-50"
                          >
                            {isGeneratingFullListing ? (
                              <Loader2 size={15} className="animate-spin" />
                            ) : (
                              <Sparkles size={15} strokeWidth={2} />
                            )}
                            {isGeneratingFullListing ? 'Lager forslag…' : 'Foreslå et utkast'}
                          </button>
                          <span className="text-[0.8125rem] text-[#63665F]">
                            {selectedImages.length > 0
                              ? `Bruker ${Math.min(selectedImages.length, 3)} ${
                                  Math.min(selectedImages.length, 3) === 1 ? 'bilde' : 'bilder'
                                }${smartFillPrompt.trim() ? ' og teksten' : ''}`
                              : 'Legg til bilder eller skriv minst 5 tegn'}
                          </span>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* Show button when AI panel is hidden */}
              {isAiPanelHidden && (
                <button
                  type="button"
                  onClick={() => {
                    setIsAiPanelHidden(false);
                    setIsAiPanelMinimized(false);
                  }}
                  className="inline-flex h-10 items-center gap-2 rounded-full border border-[#E6E7E1] bg-white px-4 text-[0.875rem] font-medium text-[#63665F] transition-colors hover:border-[#2E6641]/45 hover:text-[#2E6641]"
                >
                  <Sparkles size={15} strokeWidth={2} className="text-[#2E6641]" />
                  Vis smart-utfylling
                </button>
              )}

              <BasicInformation
                title={title}
                setTitle={setTitle}
                description={description}
                setDescription={setDescription}
                // Edit mode can seed an array; BasicInformation only ever selects one, so it reads a string.
                categories={categories as string}
                setCategories={setCategories}
                tags={tags}
                setTags={setTags}
                maxApplicants={maxApplicants}
                setMaxApplicants={setMaxApplicants}
                errors={errors}
                aiPricingNote={smartFillPricingNote}
                onDismissAiPricingNote={() => setSmartFillPricingNote('')}
              />
            </div>
          )}

          {!packageOpen && currentStep === 2 && (
            <div className="animate-in fade-in slide-in-from-right-2 space-y-5 duration-300">
              <TimeAndPlace
                address={address}
                setAddress={setAddress}
                city={city}
                setCity={setCity}
                countyCode={countyCode}
                setCountyCode={setCountyCode}
                municipalityCode={municipalityCode}
                setMunicipalityCode={setMunicipalityCode}
                areaCode={areaCode}
                setAreaCode={setAreaCode}
                postalCode={postalCode}
                setPostalCode={setPostalCode}
                coordinates={coordinates}
                setCoordinates={setCoordinates}
                durationValue={durationValue}
                setDurationValue={setDurationValue}
                durationUnit={durationUnit}
                setDurationUnit={setDurationUnit}
                fromDate={fromDate}
                setFromDate={setFromDate}
                toDate={toDate}
                setToDate={setToDate}
                errors={errors}
              />
              <PaymentInformation
                paymentType={paymentType}
                setPaymentType={setPaymentType}
                price={price}
                setPrice={setPrice}
                hourlyRate={hourlyRate}
                setHourlyRate={setHourlyRate}
                errors={errors}
              />
              <ChecklistStep
                checklistItems={checklistItems}
                setChecklistItems={setChecklistItems}
                currentCategory={Array.isArray(categories) ? categories[0] : categories}
              />
              <ContactInformation
                phone={phone}
                setPhone={setPhone}
                email={email}
                setEmail={setEmail}
                errors={errors}
              />
            </div>
          )}
        </div>

        <FormActions
          currentStep={currentStep}
          handleBack={packageOpen ? () => setPackageOpen(false) : handleBack}
          handleCancel={handleCancel}
          handleNext={handleNext}
          handleFinalSubmit={
            isEditMode || packageOpen
              ? handleFinalSubmit
              : () => {
                  if (validateAll()) {
                    setPackageOpen(true);
                    window.scrollTo({ top: 0 });
                  }
                }
          }
          finalLabel={isEditMode || packageOpen ? undefined : 'Gå videre'}
          // Hast: no publishing until its "Betal 39 kr" has gone through.
          hideFinal={packageOpen && urgent && !urgentPurchaseId}
          setShowPreview={setShowPreview}
          isSubmitting={isSubmitting}
        />
      </form>

      <AiDraftLoadingDialog
        open={isGeneratingFullListing}
        photos={selectedImages}
        onCancel={cancelAiSmartFill}
      />
      <AiDraftReviewDialog rows={aiDraftRows} onApply={applyAiDraft} />

      <JobPreviewModal
        showPreview={showPreview}
        setShowPreview={setShowPreview}
        previewJobData={previewJobData}
      />
    </div>
  );
}
