/**
 * "Jobs without photos" task 3. A description too short to answer ("Noen som er flinke med
 * speilglass?"): fewer than 12 words or 80 characters. Same rule as the backend
 * (aiController isShortDescription) and the web (utils/descriptionHelp). Pure: the check runs it.
 */
export const isShortDescription = (text: string) => {
  const t = text.trim();
  return t.length < 80 || t.split(/\s+/).filter(Boolean).length < 12;
};

/** The answers as lines under the description: "Størrelse: 120 x 80 cm". Empty answers skipped. */
export const appendAnswers = (
  description: string,
  answers: { label: string; answer: string }[]
): string => {
  const lines = answers
    .map(({ label, answer }) => ({ label: label.trim(), answer: answer.trim() }))
    .filter(({ answer }) => answer)
    .map(({ label, answer }) => `${label}: ${answer}`);
  if (!lines.length) return description;
  return `${description.trim()}\n\n${lines.join('\n')}`;
};
