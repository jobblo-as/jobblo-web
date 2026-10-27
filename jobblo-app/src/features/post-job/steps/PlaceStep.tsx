import React, { useRef, useState } from 'react';
import { Keyboard, Platform, Pressable, ScrollView, Text, View } from 'react-native';
import DateTimePicker, { type DateTimePickerChangeEvent } from '@expo/ui/community/datetime-picker';
import { CalendarDays, X } from 'lucide-react-native';
import { TC, tc } from '../../../theme/colors';
import { AddressSearchField } from '../../../components/create-job/AddressSearchField';
import { addressAt, type AddressHit } from '../../../services/geonorge.service';
import { CreateJobLocationMap } from '../../../components/create-job/CreateJobLocationMap';
import { Field } from '../../../components/ui/Field';
import { useLocationTree } from '../../../hooks/useLocationTree';
import { validateCreateJobStep } from '../../../utils/createJobValidation';
import { usePostJobStore } from '../store';
import { StepFooter } from '../StepFooter';
import { totalPrice } from '../price';
import { DATE_LOCALE, t } from '../i18n';

const dateValue = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const localDate = (v: string) => {
  const [y, m, d] = v.split('-').map(Number);
  return y && m && d ? new Date(y, m - 1, d) : new Date();
};
const today = () => {
  const n = new Date();
  return new Date(n.getFullYear(), n.getMonth(), n.getDate());
};
const plusDays = (n: number) => new Date(today().getTime() + n * 86_400_000);
const label = (v: string) => (v ? localDate(v).toLocaleDateString(DATE_LOCALE, { weekday: 'short', day: 'numeric', month: 'short' }) : '');

/** Where (one Kartverket address search fills address, sted, fylke and kommune) and when. */
export function PlaceStep() {
  const { values, update, next } = usePostJobStore();
  const locations = useLocationTree().data ?? [];
  const [picker, setPicker] = useState<'fromDate' | 'toDate' | null>(null);
  const [showErrors, setShowErrors] = useState(false);
  const [lookingUp, setLookingUp] = useState(false);
  const [lookupError, setLookupError] = useState('');
  const lookup = useRef(0);
  const [touchingMap, setTouchingMap] = useState(false);
  // The full-address fields sit under the map: typing there scrolls them up above the keyboard.
  const scrollRef = useRef<React.ComponentRef<typeof ScrollView>>(null);
  const addressY = useRef(0);
  const showAddressFields = () => {
    const go = () => scrollRef.current?.scrollTo({ y: Math.max(0, addressY.current - 12), animated: true });
    // Once the keyboard is up and the screen has shrunk; already up (next field) = nothing to do.
    const sub = Keyboard.addListener('keyboardDidShow', () => {
      sub.remove();
      go();
    });
    setTimeout(() => sub.remove(), 1000);
  };

  const errors = validateCreateJobStep(3, {
    values,
    imageCount: 0,
    phone: '',
    displayedPrice: totalPrice(values),
  });
  // The shared validator speaks Norwegian; the flow's language decides what is shown.
  const addressError = errors.address || errors.coordinates;
  const placeErrors = {
    address: addressError && t(addressError, 'Search for the address and choose a suggestion.'),
    fromDate: errors.fromDate && t(errors.fromDate, 'Choose a start date from today or later.'),
    toDate: errors.toDate && t(errors.toDate, 'The end date cannot be before the start date.'),
    postalCode: values.postalCode && !/^\d{4}$/.test(values.postalCode) ? t('Postnummeret har 4 sifre.', 'The postal code has 4 digits.') : '',
  };
  const invalid = Boolean(placeErrors.address || placeErrors.fromDate || placeErrors.toDate || placeErrors.postalCode);

  // Same lookup as the old form: kommunenummer → fylke in our location tree (name as a fallback).
  const pickAddress = (hit: AddressHit) => {
    const sameName = (name: string) => name.toLowerCase() === hit.municipalityName.toLowerCase();
    const county =
      locations.find((c) => c.children?.some((m) => m.code === hit.municipalityCode)) ??
      locations.find((c) => c.children?.some((m) => sameName(m.name)));
    const municipality = county?.children?.find((m) => m.code === hit.municipalityCode || sameName(m.name));
    update({
      address: hit.address,
      postalCode: hit.postalCode,
      city: hit.city || hit.municipalityName,
      countyCode: county?.code ?? '',
      municipalityCode: municipality?.code ?? '',
      areaCode: '',
      coordinates: [hit.lat, hit.lng],
    });
  };
  // A point from the map (tap, dragged pin, GPS): the pin stays where it was put; the nearest
  // Kartverket address fills address, sted, fylke and kommune.
  const pickPoint = async ([lat, lng]: [number, number]) => {
    const id = ++lookup.current;
    update({ coordinates: [lat, lng] });
    setLookupError('');
    setLookingUp(true);
    try {
      const hit = await addressAt(lat, lng);
      if (id !== lookup.current) return; // a newer tap won
      if (hit) {
        pickAddress(hit);
        update({ coordinates: [lat, lng] });
      } else {
        update({ address: '', postalCode: '', city: '', countyCode: '', municipalityCode: '', areaCode: '' });
        setLookupError(t('Fant ingen adresse her. Flytt nålen nærmere en vei eller et hus.', 'No address here. Move the pin closer to a road or house.'));
      }
    } catch {
      if (id === lookup.current) setLookupError(t('Kunne ikke finne adressen. Prøv igjen eller søk.', 'Could not find the address. Try again or search.'));
    } finally {
      if (id === lookup.current) setLookingUp(false);
    }
  };
  const confirmed = Boolean(values.address) && !(values.coordinates[0] === 0 && values.coordinates[1] === 0);

  const setDate = (key: 'fromDate' | 'toDate', v: string) => {
    update(key === 'fromDate' && values.toDate && values.toDate < v ? { fromDate: v, toDate: '' } : { [key]: v });
  };
  const onPicked = (_e: DateTimePickerChangeEvent, selected?: Date) => {
    if (selected && picker) setDate(picker, dateValue(selected));
    setPicker(null);
  };

  const quick = [
    { text: t('I dag', 'Today'), v: dateValue(today()) },
    { text: t('I morgen', 'Tomorrow'), v: dateValue(plusDays(1)) },
  ];

  return (
    <View className="flex-1">
      <ScrollView
        ref={scrollRef}
        contentContainerStyle={{ padding: 16, paddingBottom: 24 }}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="interactive"
        scrollEnabled={!touchingMap}
      >
        <Text className="text-[1.625rem] font-bold leading-tight tracking-[-0.02em] text-ink">{t('Hvor skal jobben gjøres?', 'Where is the job?')}</Text>
        <View className="mt-4">
          <AddressSearchField
            value={values.address}
            detail={confirmed ? values.city : undefined}
            confirmed={confirmed}
            error={showErrors ? placeErrors.address : undefined}
            onSelect={(hit) => {
              lookup.current++; // a search pick beats a lookup still on its way
              setLookingUp(false);
              setLookupError('');
              pickAddress(hit);
            }}
            onClear={() => update({ address: '', postalCode: '', city: '', countyCode: '', municipalityCode: '', areaCode: '', coordinates: [0, 0] })}
          />
        </View>
        <View className="mt-4">
          <CreateJobLocationMap coordinates={values.coordinates} onCoordinatesChange={(point) => void pickPoint(point)} busy={lookingUp} onTouchingChange={setTouchingMap} />
        </View>
        {lookupError ? <Text className="mt-2 text-[0.8125rem] font-medium text-danger">{lookupError}</Text> : null}

        {/* The full address, filled from the search or the map and correctable by hand (e.g. a
            house letter or flat number). Only the person chosen for the job sees it. */}
        <Text className="mt-6 text-[1.0625rem] font-semibold text-ink" onLayout={(e) => (addressY.current = e.nativeEvent.layout.y)}>
          {t('Full adresse', 'Full address')}
        </Text>
        <View className="mt-3 gap-3">
          <Field
            label={t('Gateadresse', 'Street address')}
            required
            value={values.address}
            onChangeText={(address) => update({ address })}
            placeholder={t('F.eks. Storgata 5B', 'E.g. Storgata 5B')}
            autoComplete="street-address"
            textContentType="streetAddressLine1"
            maxLength={120}
            onFocus={showAddressFields}
          />
          <View className="flex-row gap-3">
            <Field
              className="w-28"
              label={t('Postnummer', 'Postal code')}
              value={values.postalCode}
              onChangeText={(postalCode) => update({ postalCode: postalCode.replace(/\D/g, '') })}
              placeholder="0150"
              keyboardType="number-pad"
              autoComplete="postal-code"
              textContentType="postalCode"
              maxLength={4}
              onFocus={showAddressFields}
              error={showErrors ? placeErrors.postalCode || undefined : undefined}
            />
            <Field
              className="flex-1"
              label={t('Sted', 'City')}
              value={values.city}
              onChangeText={(city) => update({ city })}
              placeholder="Oslo"
              textContentType="addressCity"
              maxLength={60}
              onFocus={showAddressFields}
            />
          </View>
        </View>
        <Text className="mt-2 text-[0.8125rem] leading-5 text-muted">{t('Stedet vises med en nål på kartet i annonsen.', 'The place is shown with a pin on the map in the listing.')}</Text>

        <Text className="mt-8 text-[1.25rem] font-bold text-ink">{t('Når?', 'When?')}</Text>
        <Text className="mt-3 text-[0.875rem] font-semibold text-ink">{t('Fra dato', 'Start date')}</Text>
        <View className="mt-2 flex-row flex-wrap gap-2">
          {quick.map((q) => {
            const selected = values.fromDate === q.v;
            return (
              <Pressable
                key={q.text}
                onPress={() => setDate('fromDate', q.v)}
                accessibilityRole="radio"
                accessibilityState={{ selected }}
                className={`h-10 justify-center rounded-full border px-4 ${selected ? 'border-brand bg-tint' : 'border-line bg-surface'}`}
              >
                <Text className={`text-[0.875rem] font-medium ${selected ? 'text-brand-text' : 'text-ink'}`}>{q.text}</Text>
              </Pressable>
            );
          })}
          <Pressable
            onPress={() => setPicker('fromDate')}
            accessibilityRole="button"
            className={`h-10 flex-row items-center gap-1.5 rounded-full border px-4 ${values.fromDate && !quick.some((q) => q.v === values.fromDate) ? 'border-brand bg-tint' : 'border-line bg-surface'}`}
          >
            <CalendarDays size={16} color={TC.ink} />
            <Text className="text-[0.875rem] font-medium text-ink">
              {values.fromDate && !quick.some((q) => q.v === values.fromDate) ? label(values.fromDate) : t('Velg dato', 'Pick a date')}
            </Text>
          </Pressable>
        </View>
        {showErrors && placeErrors.fromDate ? <Text className="mt-1 text-[0.8125rem] font-medium text-danger">{placeErrors.fromDate}</Text> : null}

        <Text className="mt-5 text-[0.875rem] font-semibold text-ink">{t('Til dato', 'End date')} <Text className="font-normal text-muted">{t('(valgfritt)', '(optional)')}</Text></Text>
        <View className="mt-2 flex-row items-center gap-2">
          <Pressable
            onPress={() => setPicker('toDate')}
            accessibilityRole="button"
            className="h-10 flex-row items-center gap-1.5 rounded-full border border-line bg-surface px-4"
          >
            <CalendarDays size={16} color={TC.ink} />
            <Text className="text-[0.875rem] font-medium text-ink">{values.toDate ? label(values.toDate) : t('Fleksibel – velg sluttdato', 'Flexible – pick an end date')}</Text>
          </Pressable>
          {values.toDate ? (
            <Pressable onPress={() => update({ toDate: '' })} hitSlop={8} accessibilityRole="button" accessibilityLabel={t('Fjern sluttdato', 'Remove end date')} className="h-10 w-10 items-center justify-center">
              <X size={18} color={tc('#63665F', 'muted')} />
            </Pressable>
          ) : null}
        </View>
        {showErrors && placeErrors.toDate ? <Text className="mt-1 text-[0.8125rem] font-medium text-danger">{placeErrors.toDate}</Text> : null}
      </ScrollView>

      {picker ? (
        <View className="absolute bottom-20 left-4 right-4 rounded-xl bg-surface p-2">
          <DateTimePicker
            value={localDate(picker === 'fromDate' ? values.fromDate : values.toDate || values.fromDate)}
            mode="date"
            minimumDate={picker === 'toDate' && values.fromDate ? localDate(values.fromDate) : today()}
            presentation="dialog"
            display={Platform.OS === 'ios' ? 'spinner' : 'default'}
            onValueChange={onPicked}
            onDismiss={() => setPicker(null)}
          />
        </View>
      ) : null}

      <StepFooter label={t('Fortsett', 'Continue')} onPress={() => (invalid ? setShowErrors(true) : next())} />
    </View>
  );
}
