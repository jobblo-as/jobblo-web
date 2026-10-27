/**
 * The questions on the "Detaljer" screen (FINN: fields depend on the category). Answers go into
 * the AI prompt for the title/description and become tags on the job.
 * ponytail: lives in the app; when admins should edit them, move to the Category model
 * (a `detailFields` array) and serve it with /filter/options.
 */
import type { DurationUnit } from '../../services/createJob.service';
import { t } from './i18n';

export interface DetailQuestion {
  key: string;
  label: string;
  options: string[];
}

const CATEGORY_QUESTIONS: Record<string, DetailQuestion[]> = {
  maling: [
    {
      key: 'what',
      label: t('Hva skal males?', 'What needs painting?'),
      options: [
        t('Vegger', 'Walls'),
        t('Tak', 'Ceiling'),
        t('Vinduer og karmer', 'Windows and frames'),
        t('Dører', 'Doors'),
        t('Utvendig', 'Exterior'),
      ],
    },
    {
      key: 'rooms',
      label: t('Hvor mange rom?', 'How many rooms?'),
      options: [
        t('1 rom', '1 room'),
        t('2–3 rom', '2–3 rooms'),
        t('4 rom eller flere', '4 rooms or more'),
      ],
    },
  ],
  rengjoring: [
    {
      key: 'what',
      label: t('Hva slags vask?', 'What kind of cleaning?'),
      options: [
        t('Vanlig vask', 'Regular cleaning'),
        t('Flyttevask', 'Move-out cleaning'),
        t('Vindusvask', 'Window cleaning'),
        t('Storrengjøring', 'Deep cleaning'),
      ],
    },
    {
      key: 'size',
      label: t('Hvor stort er det?', 'How big is it?'),
      options: [t('Under 50 m²', 'Under 50 m²'), '50–100 m²', t('Over 100 m²', 'Over 100 m²')],
    },
  ],
  flytting: [
    {
      key: 'what',
      label: t('Hva skal flyttes?', 'What needs moving?'),
      options: [
        t('Noen få ting', 'A few items'),
        t('Leilighet', 'Apartment'),
        t('Hus', 'House'),
        t('Kontor', 'Office'),
      ],
    },
    {
      key: 'stairs',
      label: t('Bæring i trapper?', 'Carrying on stairs?'),
      options: [t('Nei / heis', 'No / lift'), t('Ja, noen etasjer', 'Yes, a few floors')],
    },
  ],
  hagearbeid: [
    {
      key: 'what',
      label: t('Hva skal gjøres?', 'What needs doing?'),
      options: [
        t('Klippe plen', 'Mow the lawn'),
        t('Hekk og busker', 'Hedges and bushes'),
        t('Rake og rydde', 'Rake and tidy'),
        t('Felle trær', 'Fell trees'),
      ],
    },
  ],
  rorlegger: [
    {
      key: 'what',
      label: t('Hva gjelder det?', 'What is it about?'),
      options: [
        t('Lekkasje', 'Leak'),
        t('Tett avløp', 'Blocked drain'),
        t('Montere nytt', 'Install something new'),
        t('Annet', 'Other'),
      ],
    },
  ],
  montering: [
    {
      key: 'what',
      label: t('Hva skal monteres?', 'What needs assembling?'),
      options: [
        t('Møbler', 'Furniture'),
        t('TV på vegg', 'TV on the wall'),
        t('Hyller og skap', 'Shelves and cabinets'),
        t('Annet', 'Other'),
      ],
    },
  ],
  transport: [
    {
      key: 'what',
      label: t('Hva skal fraktes?', 'What needs transporting?'),
      options: [
        t('Små ting', 'Small items'),
        t('Møbler', 'Furniture'),
        t('Hvitevarer', 'Appliances'),
        t('Til gjenvinning', 'To recycling'),
      ],
    },
  ],
  oppussing: [
    {
      key: 'what',
      label: t('Hva skal pusses opp?', 'What needs renovating?'),
      options: [
        t('Bad', 'Bathroom'),
        t('Kjøkken', 'Kitchen'),
        t('Gulv', 'Floor'),
        t('Annet', 'Other'),
      ],
    },
  ],
};

const norm = (s: string) =>
  s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/ø/g, 'o')
    .replace(/æ/g, 'ae')
    .replace(/å/g, 'a')
    .trim();

/** Questions for a category name (accent- and case-insensitive); none for unknown categories. */
export function questionsFor(category: string): DetailQuestion[] {
  return CATEGORY_QUESTIONS[norm(category)] ?? [];
}

/** "Hvor lang tid tror du det tar?" → the job's duration. */
export const DURATION_OPTIONS: { label: string; value: string; unit: DurationUnit }[] = [
  { label: t('Under en time', 'Under an hour'), value: '1', unit: 'hours' },
  { label: t('2–3 timer', '2–3 hours'), value: '3', unit: 'hours' },
  { label: t('En halv dag', 'Half a day'), value: '4', unit: 'hours' },
  { label: t('En hel dag', 'A full day'), value: '1', unit: 'days' },
  { label: t('Flere dager', 'Several days'), value: '3', unit: 'days' },
];

export const EQUIPMENT_OPTIONS = [
  { label: t('Ingen utstyr nødvendig', 'No equipment needed'), value: 'utstyrfri' },
  { label: t('Noe utstyr trengs', 'Some equipment needed'), value: 'delvis utstyr' },
  { label: t('Utstyr må medbringes', 'Bring your own equipment'), value: 'trengs utstyr' },
] as const;

/** The AI prompt from what the user has told us so far. The photos go along as images (the server tells the model). */
export function describeForAi(input: {
  summary: string;
  category: string;
  answers: Record<string, string>;
  durationLabel?: string;
  equipmentLabel?: string;
  photoCount: number;
  photoNotes?: string[];
}): string {
  const notes = (input.photoNotes ?? []).filter(Boolean);
  const lines = [
    input.summary.trim()
      ? `${t('Kunden skriver', 'The customer writes')}: ${input.summary.trim()}`
      : '',
    // The camera AI helper's notes, one per photo: what the photos show.
    notes.length ? `${t('Bildene viser', 'The photos show')}: ${notes.join('; ')}` : '',
    `${t('Kategori', 'Category')}: ${input.category}`,
    ...questionsFor(input.category).map((q) =>
      input.answers[q.key] ? `${q.label} ${input.answers[q.key]}` : ''
    ),
    input.durationLabel ? `${t('Antatt tid', 'Estimated time')}: ${input.durationLabel}` : '',
    input.equipmentLabel ? `${t('Utstyr', 'Equipment')}: ${input.equipmentLabel}` : '',
  ];
  return lines.filter(Boolean).join('\n');
}
