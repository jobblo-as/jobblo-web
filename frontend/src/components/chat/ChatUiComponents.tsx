import { MessagesSquare } from 'lucide-react';

/** The chat icon in two soft rings, shared by the empty list and the empty reading pane. */
export const ChatRings = ({ small = false }: { small?: boolean }) => (
  <span
    aria-hidden="true"
    className={`relative mx-auto flex items-center justify-center rounded-full bg-[#2E6641]/5 ${
      small ? 'size-20' : 'size-28'
    }`}
  >
    <span
      className={`flex items-center justify-center rounded-full bg-[#2E6641]/10 ${
        small ? 'size-14' : 'size-20'
      }`}
    >
      <span
        className={`flex items-center justify-center rounded-full bg-white text-[#2E6641] shadow-[0_10px_24px_rgba(11,11,11,0.10)] ${
          small ? 'size-10' : 'size-13'
        }`}
      >
        <MessagesSquare size={small ? 18 : 24} strokeWidth={2} />
      </span>
    </span>
  </span>
);

/** Shown in the reading pane on desktop before a conversation is picked. */
export const EmptyChatState = () => (
  <div className="relative flex h-full flex-col items-center justify-center overflow-hidden bg-[#EFF0EA] px-8 text-center">
    <div
      aria-hidden="true"
      className="pointer-events-none absolute left-1/2 top-1/2 size-140 -translate-x-1/2 -translate-y-1/2 rounded-full bg-[radial-gradient(circle,rgba(46,102,65,0.10),rgba(46,102,65,0)_68%)]"
    />
    <ChatRings />
    <h2 className="relative mt-5 text-[1.375rem] font-bold tracking-[-0.02em] text-[#0B0B0B]">
      Velg en samtale
    </h2>
    <p className="relative mt-2 max-w-80 text-[0.9375rem] leading-relaxed text-[#63665F]">
      Meldingene dine om oppdrag samles her. Velg en samtale fra listen for å fortsette.
    </p>

    {/* A sample exchange, so the empty pane shows what it is for. */}
    <div aria-hidden="true" className="relative mt-8 w-full max-w-xs space-y-2 text-left">
      <p className="w-fit max-w-[85%] rounded-2xl rounded-bl-md border border-[#E6E7E1] bg-white px-3.5 py-2.5 text-[0.8125rem] font-semibold text-[#0B0B0B] shadow-[0_6px_16px_rgba(11,11,11,0.05)]">
        Hei! Jeg kan male stua di på lørdag.
      </p>
      <p className="ml-auto w-fit max-w-[85%] rounded-2xl rounded-br-md bg-[#2E6641] px-3.5 py-2.5 text-[0.8125rem] font-semibold text-white opacity-80">
        Supert, hva koster det?
      </p>
      <p className="w-fit rounded-2xl rounded-bl-md border border-[#E6E7E1] bg-white px-3.5 py-2.5 text-[0.8125rem] font-semibold text-[#9B9E96] opacity-60">
        Skriver …
      </p>
    </div>
  </div>
);
