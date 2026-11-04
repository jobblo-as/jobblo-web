import React from 'react';
import { Linking, Pressable, Text, View } from 'react-native';
import { Mail, Phone } from 'lucide-react-native';
import { tc } from '../../theme/colors';
import { formatPhone } from '../../utils/phone';

/**
 * A contract party's phone and e-mail, tap to call / write (as on the web's PartyContact).
 * The order endpoints send them to the two parties only; for the customer the job's own
 * contact (its phone is required) comes before the profile's.
 */
export function PartyContact({ phone, email }: { phone?: string; email?: string }) {
  if (!phone && !email) return null;
  const muted = tc('#63665F', 'muted');
  const row = (Icon: typeof Phone, text: string, url: string, label: string) => (
    <Pressable
      onPress={() => void Linking.openURL(url)}
      accessibilityRole="link"
      accessibilityLabel={label}
      hitSlop={6}
      className="flex-row items-center justify-center gap-1.5 active:opacity-70"
    >
      <Icon size={13} color={muted} />
      <Text className="text-[0.8125rem] text-brand-text" numberOfLines={1}>
        {text}
      </Text>
    </Pressable>
  );
  return (
    <View className="mt-2 gap-1.5">
      {phone
        ? row(
            Phone,
            formatPhone(phone),
            `tel:${phone.replace(/\s/g, '')}`,
            `Ring ${formatPhone(phone)}`
          )
        : null}
      {email ? row(Mail, email, `mailto:${email}`, `Send e-post til ${email}`) : null}
    </View>
  );
}
