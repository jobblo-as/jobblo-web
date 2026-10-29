import { Upload, Camera, Loader2, X, ArrowLeft, ArrowRight } from 'lucide-react';
import { toast } from 'react-hot-toast';
import React, { useState, useRef } from 'react';
import { compressImages } from '../../utils/compressImage';

/** One photo in the form: saved (`file` undefined, id = URL) or new. */
export interface ImageItem {
  id: string;
  url: string;
  file?: File;
}

interface ImageUploadProps {
  items: ImageItem[];
  onAddFiles: (files: File[]) => void;
  onRemove: (item: ImageItem) => void;
  onMove: (id: string, step: -1 | 1) => void;
}

const ROUND_BUTTON =
  'flex size-8 items-center justify-center rounded-full text-[#63665F] transition-colors hover:bg-[#F4F6F0] hover:text-[#0B0B0B] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2E6641]/30 disabled:opacity-30 disabled:hover:bg-transparent';

/**
 * Photos for a job: add (scaled down first), move left/right, delete. The order here is
 * the order on the job page; the first photo is the main one. State lives in useCreateJobForm.
 */
export const ImageUpload: React.FC<ImageUploadProps> = ({
  items,
  onAddFiles,
  onRemove,
  onMove,
}) => {
  const [isProcessing, setIsProcessing] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const cameraInputRef = useRef<HTMLInputElement>(null);

  /**
   * The server's own cap is 8 MB per file (backend/middleware/upload.js). Nothing should
   * ever reach it: photos are scaled down before this check, and a 1920px re-encode lands
   * a few hundred KB. This is the floor for the cases compression cannot help with — a
   * huge PNG screenshot, or a browser where the canvas path failed and the original came
   * back unchanged.
   */
  const MAX_FILE_SIZE = 8 * 1024 * 1024;
  const MAX_IMAGES = 6;

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    // Let the same file be chosen again if it was rejected the first time.
    e.target.value = '';
    if (files.length === 0) return;

    const room = MAX_IMAGES - items.length;
    if (room <= 0) {
      toast.error(`Du kan laste opp inntil ${MAX_IMAGES} bilder.`);
      return;
    }
    if (files.length > room) {
      toast.error(`Inntil ${MAX_IMAGES} bilder — de første ${room} ble lagt til.`);
    }

    setIsProcessing(true);
    try {
      // This used to reject anything over 2 MB with a toast. A photo straight off a phone
      // is 3–8 MB, so the common outcome was a person picking an ordinary picture and
      // being told no — the "entity too large" complaints started here. Scaling it down
      // first turns the same photo into something every limit in the stack accepts.
      const processed = await compressImages(files.slice(0, room));

      const validFiles: File[] = [];
      const rejected: string[] = [];
      for (const file of processed) {
        if (file.size > MAX_FILE_SIZE) rejected.push(file.name);
        else validFiles.push(file);
      }

      if (rejected.length > 0) {
        toast.error(`Disse filene er for store og ble ikke lagt til: ${rejected.join(', ')}`);
      }
      if (validFiles.length > 0) onAddFiles(validFiles);
    } finally {
      setIsProcessing(false);
    }
  };

  return (
    <div className="w-full bg-[#FFFFFFB2]">
      <input
        ref={fileInputRef}
        type="file"
        multiple
        accept="image/jpeg,image/png,image/webp"
        onChange={handleFileChange}
        className="hidden"
      />
      <input
        ref={cameraInputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        capture="environment"
        onChange={handleFileChange}
        className="hidden"
      />

      {/* Upload Box */}
      <div className="flex gap-4">
        <div
          onClick={() => !isProcessing && fileInputRef.current?.click()}
          aria-busy={isProcessing}
          className={`flex-1 flex flex-col items-center justify-center border-2 gap-2 text-[#99A1AF] border-[#D1D5DC] rounded-[14px] py-10 px-5 text-center transition-all duration-300 ease-in-out group ${
            isProcessing
              ? 'cursor-wait opacity-60'
              : 'cursor-pointer hover:border-[#4CAF50] hover:bg-[#f0f9f0]'
          }`}
        >
          <p className="">
            {isProcessing ? <Loader2 size={24} className="animate-spin" /> : <Upload size={24} />}
          </p>
          <p className="text-[12px] font-medium">{isProcessing ? 'Behandler…' : 'Last opp'}</p>
          {/* Was "Maks 2 MB per bilde" — a rule that rejected almost every phone photo.
              Large pictures are scaled down automatically now, so there is nothing for the
              person to do about size and nothing to warn them about. */}
          <p className="text-[10px] text-gray-400">Inntil 6 bilder · store bilder komprimeres</p>
        </div>
        <div
          onClick={() => !isProcessing && cameraInputRef.current?.click()}
          aria-busy={isProcessing}
          className={`flex-1 flex flex-col items-center justify-center border-2 gap-2 text-[#99A1AF] border-[#D1D5DC] rounded-[14px] py-10 px-5 text-center transition-all duration-300 ease-in-out group ${
            isProcessing
              ? 'cursor-wait opacity-60'
              : 'cursor-pointer hover:border-[#4CAF50] hover:bg-[#f0f9f0]'
          }`}
        >
          <p className="">
            <Camera size={24} />
          </p>
          <p className="text-[12px] font-medium">Ta bilde</p>
        </div>
      </div>

      {items.length > 0 && (
        // A row of tiles, like the job page's thumbnails: left/right sets the order.
        <ol className="mt-4 flex flex-wrap gap-3" aria-label="Bilder i rekkefølge">
          {items.map((item, index) => {
            const n = index + 1;
            return (
              <li key={item.id} className="w-28 shrink-0">
                <div className="relative size-28 overflow-hidden rounded-xl border border-[#E6E7E1] bg-white">
                  <img src={item.url} alt={`Bilde ${n}`} className="size-full object-cover" />
                  {index === 0 && (
                    <span className="absolute inset-x-0 bottom-0 bg-black/55 py-0.5 text-center text-[0.6875rem] font-semibold text-white">
                      Hovedbilde
                    </span>
                  )}
                  <button
                    type="button"
                    onClick={() => onRemove(item)}
                    aria-label={`Slett bilde ${n}`}
                    className="absolute right-1 top-1 flex size-7 items-center justify-center rounded-full bg-white/95 text-[#0B0B0B] shadow-sm transition-colors hover:bg-[#FCF4F3] hover:text-[#B0453B] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2E6641]/30"
                  >
                    <X size={15} />
                  </button>
                </div>
                <div className="mt-1 flex items-center justify-center gap-1">
                  <button
                    type="button"
                    onClick={() => onMove(item.id, -1)}
                    disabled={index === 0}
                    aria-label={`Flytt bilde ${n} til venstre`}
                    className={ROUND_BUTTON}
                  >
                    <ArrowLeft size={16} />
                  </button>
                  <button
                    type="button"
                    onClick={() => onMove(item.id, 1)}
                    disabled={index === items.length - 1}
                    aria-label={`Flytt bilde ${n} til høyre`}
                    className={ROUND_BUTTON}
                  >
                    <ArrowRight size={16} />
                  </button>
                </div>
              </li>
            );
          })}
        </ol>
      )}
    </div>
  );
};
