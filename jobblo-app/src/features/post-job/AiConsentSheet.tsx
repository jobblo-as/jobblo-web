import React from 'react';
import { Text, View } from 'react-native';
import { Sparkles } from 'lucide-react-native';
import { BottomSheet } from '../../components/ui/BottomSheet';
import { Button } from '../../components/ui/Button';
import { TC } from '../../theme/colors';
import { useAiConsent } from './aiConsent';
import { t } from './i18n';

/**
 * Asked once, before the camera opens (App Store 5.1.2(i)): says what goes to which AI and lets
 * the person say no. Either answer is saved; closing it without one counts as "no".
 */
export function AiConsentSheet({ visible }: { visible: boolean }) {
  const setConsent = useAiConsent((s) => s.set);
  return (
    <BottomSheet
      visible={visible}
      onClose={() => setConsent(false)}
      title={t('AI-hjelper', 'AI helper')}
    >
      <View className="items-center pb-2">
        <View className="h-14 w-14 items-center justify-center rounded-full bg-tint">
          <Sparkles size={26} color={TC.brandText} />
        </View>
        <Text className="mt-4 text-center text-[1.0625rem] leading-6 text-ink">
          {t(
            'AI-hjelperen gir tips om bildene og foreslår kategori, tittel, beskrivelse og pris.',
            'The AI helper gives tips on your photos and suggests the category, title, description and price.'
          )}
        </Text>
        <Text className="mt-3 text-center text-[0.9375rem] leading-6 text-muted">
          {t(
            'Da sendes bildene og svarene dine i annonsen til OpenAI, som behandler dem for Jobblo. De brukes ikke til å trene AI-modeller. Les mer i personvernerklæringen.',
            'Your photos and answers in the listing are then sent to OpenAI, which processes them for Jobblo. They are not used to train AI models. Read more in the privacy policy.'
          )}
        </Text>
        <Text className="mt-3 text-center text-[0.9375rem] leading-6 text-muted">
          {t('Du kan endre valget på tekst-steget.', 'You can change this on the text step.')}
        </Text>
      </View>
      <View className="mt-5 gap-3">
        <Button
          label={t('Bruk AI-hjelper', 'Use the AI helper')}
          fullWidth
          onPress={() => setConsent(true)}
        />
        <Button
          label={t('Fortsett uten AI', 'Continue without AI')}
          variant="secondary"
          fullWidth
          onPress={() => setConsent(false)}
        />
      </View>
    </BottomSheet>
  );
}
