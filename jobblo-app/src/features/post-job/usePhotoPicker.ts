import { Alert } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { MAX_PHOTOS } from './flow';
import { usePostJobStore } from './store';
import { t } from './i18n';

/** Photos from the library for the flow ("Last opp" in the camera, "Bibliotek" in the grid). Resolves true when photos were added. */
export function usePhotoPicker() {
  const photos = usePostJobStore((s) => s.photos);
  const add = usePostJobStore((s) => s.addPhotos);
  const room = MAX_PHOTOS - photos.length;

  const fromLibrary = async () => {
    if (room <= 0) {
      Alert.alert(t('Maks 6 bilder', 'Max 6 photos'), t('Fjern et bilde for å legge til et nytt.', 'Remove a photo to add a new one.'));
      return false;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      allowsMultipleSelection: true,
      selectionLimit: room,
      quality: 0.85,
    });
    if (result.canceled || !result.assets.length) return false;
    add(
      result.assets.map((asset, index) => ({
        uri: asset.uri,
        name: asset.fileName ?? `jobb-${Date.now()}-${index}.jpg`,
        type: asset.mimeType ?? 'image/jpeg',
      }))
    );
    return true;
  };

  return { fromLibrary, room };
}
