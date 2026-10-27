import { Alert, Linking } from 'react-native';

/**
 * Evidence files come back as signed URLs ("…/after.pdf?sv=…&sig=…"), so the query and
 * fragment must go before the extension is checked; otherwise a PDF was rendered as an image.
 */
export function isPdfUrl(url: string) {
  return /\.pdf$/i.test(url.split(/[?#]/)[0] ?? '');
}

/** Opens a document in the system viewer. Never throws: a failure is shown, not swallowed. */
export async function openDocument(url: string) {
  try {
    if (await Linking.canOpenURL(url)) {
      await Linking.openURL(url);
      return;
    }
  } catch {
    // Falls through to the same message.
  }
  Alert.alert('Kunne ikke åpne dokumentet', 'Denne filen kan ikke åpnes på denne enheten.');
}
