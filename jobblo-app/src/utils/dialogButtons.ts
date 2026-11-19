/**
 * Side by side only while both labels fit on one line in half the dialog on a 320 pt phone
 * (about 12 characters at 15 pt semibold); longer ones stack, full width.
 */
export function stackButtons(cancelLabel: string, confirmLabel: string): boolean {
  return Math.max(cancelLabel.length, confirmLabel.length) > 12;
}
