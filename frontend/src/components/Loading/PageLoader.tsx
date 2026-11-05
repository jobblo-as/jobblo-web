/**
 * The full-screen loader, shown while a lazy route or the session resolves.
 *
 * The app's opening screen (jobblo-app/src/components/BootSplash.tsx), on the web: the sprout
 * from the logo grows — stem, then the two leaves — then sways, and a hairline sweeps under
 * it. Same paths (traced from the app's splash-icon.png, 1024 × 1024), colours and timing, at
 * the same 160 px on a desktop (128 px on a phone). Under `prefers-reduced-motion` the finished
 * sprout rests and the bar sits still. The label is for screen readers; the sprout says it.
 *
 * Cost is zero bytes of payload — one inline SVG and CSS keyframes (styles/index.css, jb-sprout-*).
 */
export function PageLoader({ label = 'Laster …' }: { label?: string }) {
  return (
    <div
      role="status"
      aria-live="polite"
      className="flex min-h-screen flex-col items-center justify-center gap-6 bg-[#EFF0EA] px-6"
    >
      <svg
        viewBox="0 0 1024 1024"
        aria-hidden="true"
        className="size-32 origin-[50%_83%] animate-[jb-sprout-sway_3.6s_ease-in-out_0.8s_infinite] sm:size-40 motion-reduce:animate-none"
      >
        <path
          d="M511 843 C505 740 503 620 512 512"
          stroke="#2F6844"
          strokeWidth="70"
          strokeLinecap="round"
          fill="none"
          className="origin-[50%_83%] animate-[jb-sprout-stem_420ms_cubic-bezier(0.33,1,0.68,1)_both] motion-reduce:animate-none"
        />
        <path
          d="M512 528 C440 410 300 365 172 392 C230 510 360 590 512 528 Z"
          fill="#1F4A2E"
          className="origin-[50%_51.5%] animate-[jb-sprout-leaf_380ms_cubic-bezier(0.34,1.56,0.64,1)_300ms_both] motion-reduce:animate-none"
        />
        <path
          d="M516 512 C560 350 700 220 888 190 C840 380 720 510 545 512 Z"
          fill="#2F6844"
          className="origin-[51%_50%] animate-[jb-sprout-leaf_420ms_cubic-bezier(0.34,1.56,0.64,1)_430ms_both] motion-reduce:animate-none"
        />
      </svg>

      {/* The hairline: a 40 % segment travelling past both ends, as wide as the sprout. */}
      <div className="h-0.5 w-32 overflow-hidden rounded-full bg-[#E6E7E1] sm:w-40">
        <div className="h-full w-2/5 rounded-full bg-[#2F6844] animate-[jb-progress_1.4s_ease-in-out_infinite] motion-reduce:translate-x-[75%] motion-reduce:animate-none" />
      </div>

      <span className="sr-only">{label}</span>
    </div>
  );
}
