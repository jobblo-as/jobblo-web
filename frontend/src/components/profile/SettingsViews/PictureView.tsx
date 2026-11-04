import { useOutletContext } from 'react-router-dom';
import type { SettingsContextType } from '../../../pages/SettingsPage';
import { Camera, ImagePlus, Loader2 } from 'lucide-react';
import { DEFAULT_AVATAR } from '../../../constants/assets';
import { PILL_PRIMARY, PILL_SECONDARY } from '../../../theme/brand';

export const PictureView = () => {
  const {
    user,
    updateUser,
    fileInputRef,
    cameraInputRef,
    handlePhotoSelect,
    handleCameraSelect,
    handleFileChange,
  } = useOutletContext<SettingsContextType>();
  const uploading = updateUser.isPending;

  return (
    <section className="relative flex flex-col items-center overflow-hidden px-6 py-12 text-center sm:py-16">
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -top-40 left-1/2 size-120 -translate-x-1/2 rounded-full bg-[radial-gradient(circle,rgba(46,102,65,0.10),rgba(46,102,65,0)_68%)]"
      />

      {/* The photo itself opens the picker; the badge says so. */}
      <button
        type="button"
        onClick={handlePhotoSelect}
        disabled={uploading}
        aria-label="Velg nytt profilbilde"
        className="group relative rounded-full focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#2E6641]/25"
      >
        <span className="block rounded-full bg-[#2E6641]/10 p-2">
          <img
            src={user?.avatarUrl || DEFAULT_AVATAR}
            alt=""
            className={`size-44 rounded-full border-4 border-white object-cover shadow-[0_18px_40px_rgba(11,11,11,0.12)] transition sm:size-48 ${
              uploading ? 'opacity-50' : 'group-hover:brightness-95'
            }`}
          />
        </span>
        {uploading && (
          <span className="absolute inset-0 flex items-center justify-center">
            <Loader2 size={32} className="animate-spin text-[#2E6641]" aria-hidden="true" />
          </span>
        )}
        <span
          aria-hidden="true"
          className="absolute bottom-3 right-3 flex size-11 items-center justify-center rounded-full border-4 border-white bg-[#2E6641] text-white shadow-md transition group-hover:bg-[#255335]"
        >
          <Camera size={18} strokeWidth={2.2} />
        </span>
      </button>

      <h2 className="relative mt-6 text-[1.5rem] font-bold tracking-[-0.02em] text-[#0B0B0B] sm:text-[1.75rem]">
        Vis hvem du er
      </h2>
      <p className="relative mx-auto mt-2 max-w-sm text-[0.9375rem] leading-relaxed text-[#63665F]">
        Et tydelig bilde av ansiktet ditt gjør at folk stoler mer på deg — og svarer raskere.
      </p>

      <input
        type="file"
        ref={fileInputRef}
        onChange={handleFileChange}
        className="hidden"
        accept="image/jpeg,image/png,image/webp"
        title="Last opp profilbilde"
      />

      <input
        type="file"
        ref={cameraInputRef}
        onChange={handleFileChange}
        className="hidden"
        accept="image/jpeg,image/png,image/webp"
        capture="user"
        title="Ta profilbilde"
      />

      <div className="relative mt-7 flex flex-col items-center gap-3 sm:flex-row">
        <button
          type="button"
          onClick={handlePhotoSelect}
          disabled={uploading}
          className={`${PILL_PRIMARY} disabled:opacity-60`}
        >
          <ImagePlus size={18} strokeWidth={2.2} aria-hidden="true" />
          {uploading ? 'Laster opp …' : 'Velg bilde'}
        </button>
        <button
          type="button"
          onClick={handleCameraSelect}
          disabled={uploading}
          className={`${PILL_SECONDARY} disabled:opacity-60`}
        >
          <Camera size={18} strokeWidth={2.2} aria-hidden="true" />
          Ta bilde
        </button>
      </div>
      <p className="relative mt-4 text-[0.8125rem] font-medium text-[#9B9E96]">
        JPG, PNG eller WebP
      </p>
    </section>
  );
};
