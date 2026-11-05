import { useEffect, useState } from 'react';
import { useOutletContext } from 'react-router-dom';
import { APIProvider } from '@vis.gl/react-google-maps';
import { MapPin } from 'lucide-react';
import type { SettingsContextType } from '../../../pages/SettingsPage';
import { formatPostalCode } from '../../../utils/norwegianFormat';
import { LocationPickerMap } from '../../CreateJobForm/LocationPickerMap';
import { AddressSearchField } from '../../CreateJobForm/AddressSearchField';
import { findAddress, type AddressHit } from '../../../api/geonorge';

const GOOGLE_MAPS_API_KEY = import.meta.env.VITE_GOOGLE_MAPS_API_KEY as string;

export const AddressesView = () => {
  const { form, handleChange, handleUpdate, updateUser, user } =
    useOutletContext<SettingsContextType>();

  // Logikk: Sjekk om det er gjort endringer i noen av de tre feltene
  const isUnchanged =
    form.address === user?.address &&
    form.postNumber === user?.postNumber &&
    form.postSted === user?.postSted &&
    form.country === (user?.country || '');

  const isDisabled = isUnchanged || updateUser?.isPending;
  /** A suggestion or a map pick confirmed the address (until the street is retyped). */
  const [picked, setPicked] = useState(false);

  /**
   * Land is never typed: a pin on the map brings the geocoder's country; a typed address
   * or postnummer is a Norwegian one (the postnummer field only takes Norway's four digits).
   */
  const fillCountry = (value: string) => {
    if (value && !form.country) handleChange('country', 'Norge');
  };

  /**
   * A map click / dragged pin / "min posisjon" replaces the whole address. Every field is set
   * from the new result, empty where it has none, so a postnummer from the last address can
   * never stay behind next to a new place. A clicked place's name leads the street
   * ("Virtual University, Dahranwala Road 129").
   */
  const handleReverseGeocode = ({
    address,
    city,
    postNumber,
    country,
    placeName,
    manual,
  }: {
    address: string;
    city: string;
    postNumber?: string;
    country?: string;
    placeName?: string;
    manual?: boolean;
  }) => {
    // Fyll kun feltene ved manuelt kartklikk / dragging (ikke automatisk på åpning)
    if (!manual) return;
    const street =
      placeName && !address.toLowerCase().includes(placeName.toLowerCase())
        ? [placeName, address].filter(Boolean).join(', ')
        : address;
    handleChange('address', street);
    handleChange('postSted', city || '');
    handleChange('postNumber', /^\d{4}$/.test(postNumber || '') ? (postNumber as string) : '');
    handleChange('country', country || '');
    setPicked(true);
  };

  // The pin: the saved address's point (looked up once in Kartverket), then wherever a
  // suggestion or a click puts it. Without it the map opened empty over a saved address.
  const [pin, setPin] = useState<[number, number] | null>(null);
  const savedStreet = user?.address?.trim() ?? '';
  useEffect(() => {
    if (!savedStreet) return;
    let live = true;
    findAddress(savedStreet, user?.postNumber ?? '', user?.postSted ?? '')
      .then((hit) => {
        if (live && hit) setPin((current) => current ?? [hit.lat, hit.lng]);
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [savedStreet, user?.postNumber, user?.postSted]);

  const locationPicker = (
    <LocationPickerMap
      coordinates={pin}
      onCoordinatesChange={setPin}
      onReverseGeocode={handleReverseGeocode}
    />
  );

  // The street is searched in Kartverket, as when posting a job: a suggestion fills gate,
  // postnummer, sted and land. Postnummer and sted stay editable below.
  const addressConfirmed = !!form.address && (picked || form.address === user?.address);
  const pickAddress = (hit: AddressHit) => {
    setPin([hit.lat, hit.lng]);
    handleChange('address', hit.address);
    handleChange('postNumber', hit.postalCode);
    handleChange('postSted', hit.city || hit.municipalityName);
    handleChange('country', 'Norge'); // Kartverket only has Norwegian addresses
    setPicked(true);
  };

  return (
    <section className="flex flex-col gap-6 max-w-2xl">
      {/* Adresse — the search: a suggestion fills the fields under it */}
      <div className="space-y-1.5">
        <label
          htmlFor="address-search"
          className="ml-1 block text-[0.6875rem] font-semibold uppercase tracking-[0.12em] text-[#9B9E96]"
        >
          Adresse <span className="text-red-500">*</span>
        </label>
        <AddressSearchField
          id="address-search"
          // The whole address on one line ("Borggata 8, 0650 Oslo"); Gateadresse below holds
          // only the street.
          value={[form.address, [form.postNumber, form.postSted].filter(Boolean).join(' ')]
            .filter(Boolean)
            .join(', ')}
          confirmed={addressConfirmed}
          offerSaved={false}
          confirmedText="Adressen er funnet"
          idleText="Skriv adressen og velg et forslag, eller klikk i kartet."
          onSelect={pickAddress}
          // Typing a new search leaves the saved fields below alone until a suggestion is picked.
          onClear={() => setPicked(false)}
        />
      </div>

      {/* Gateadresse */}
      <div className="relative group">
        <label
          htmlFor="address"
          className="absolute left-4 top-2 text-[0.6875rem] font-semibold uppercase tracking-[0.12em] text-[#9B9E96]"
        >
          Gateadresse
        </label>
        <input
          id="address"
          autoComplete="street-address"
          className="w-full border border-[#E6E7E1] bg-white outline-none focus:border-[#2E6641] focus:ring-4 focus:ring-[#2E6641]/12 rounded-2xl px-4 pt-6 pb-3 text-gray-900 font-medium transition-colors"
          value={form.address}
          onChange={(event) => {
            handleChange('address', event.target.value);
            fillCountry(event.target.value);
            setPicked(false);
          }}
        />
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {/* Postnr. */}
        <div className="relative group">
          <label
            htmlFor="postNumber"
            className="absolute left-4 top-2 text-[0.6875rem] font-semibold uppercase tracking-[0.12em] text-[#9B9E96]"
          >
            Postnr.
          </label>
          {/* Four digits, and kept as text: `type="number"` would strip the leading
              zero from real postcodes like 0150 (Oslo). */}
          <input
            id="postNumber"
            inputMode="numeric"
            autoComplete="postal-code"
            maxLength={4}
            placeholder="0150"
            className="w-full border border-[#E6E7E1] bg-white outline-none focus:border-[#2E6641] focus:ring-4 focus:ring-[#2E6641]/12 rounded-2xl px-4 pt-6 pb-3 text-gray-900 font-medium transition-colors"
            value={String(form.postNumber || '')}
            onChange={(event) => {
              handleChange('postNumber', formatPostalCode(event.target.value));
              fillCountry(event.target.value);
            }}
          />
        </div>

        {/* Sted (Poststed) */}
        <div className="relative group">
          <label
            htmlFor="postSted"
            className="absolute left-4 top-2 text-[0.6875rem] font-semibold uppercase tracking-[0.12em] text-[#9B9E96]"
          >
            Sted
          </label>
          <input
            id="postSted"
            className="w-full border border-[#E6E7E1] bg-white outline-none focus:border-[#2E6641] focus:ring-4 focus:ring-[#2E6641]/12 rounded-2xl px-4 pt-6 pb-3 text-gray-900 font-medium transition-colors"
            value={form.postSted}
            onChange={(event) => handleChange('postSted', event.target.value)}
          />
        </div>
      </div>

      {/* Kart for å velge adresse */}
      <div>
        <div className="flex items-center gap-1.5 mb-2 text-xs font-bold text-gray-500 uppercase tracking-tight ml-1">
          <MapPin size={13} />
          Velg adresse på kartet
        </div>
        {GOOGLE_MAPS_API_KEY ? (
          <APIProvider apiKey={GOOGLE_MAPS_API_KEY} libraries={['marker']}>
            {locationPicker}
          </APIProvider>
        ) : (
          locationPicker
        )}
        <p className="mt-1.5 text-xs text-gray-400 ml-1">
          Klikk på kartet eller bruk knappen for å fylle inn adressen automatisk.
        </p>
      </div>

      {/* Handling-knapp */}
      <button
        type="button"
        onClick={handleUpdate}
        disabled={isDisabled}
        className={`w-full font-bold text-lg py-3.5 rounded-2xl text-white shadow-sm transition-all duration-200
          ${
            isDisabled
              ? 'cursor-not-allowed border border-[#E6E7E1] bg-[#F4F6F0] text-[#9B9E96]!'
              : 'bg-custom-green hover:bg-[#255335] active:scale-[0.98]'
          }`}
      >
        {updateUser?.isPending ? 'Lagrer...' : 'Lagre adresser'}
      </button>
    </section>
  );
};
