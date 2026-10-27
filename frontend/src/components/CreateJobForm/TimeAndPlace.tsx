import React, { useRef, useState } from 'react';
import {
  MapPin,
  Calendar,
  Clock,
  Info,
  AlertCircle,
  Loader2,
} from 'lucide-react';
import { APIProvider } from '@vis.gl/react-google-maps';
import { useLocationTree } from '../../features/locations/hooks';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../Ui/select';
import { LocationPickerMap } from './LocationPickerMap';
import { AddressSearchField } from './AddressSearchField';
import { addressAt, type AddressHit } from '../../api/geonorge';

const GOOGLE_MAPS_API_KEY = import.meta.env.VITE_GOOGLE_MAPS_API_KEY as string;

interface TimeAndPlaceProps {
  address: string;
  setAddress: (val: string) => void;
  city: string;
  setCity: (val: string) => void;
  postalCode?: string;
  setPostalCode?: (val: string) => void;
  countyCode?: string;
  setCountyCode?: (val: string) => void;
  municipalityCode?: string;
  setMunicipalityCode?: (val: string) => void;
  areaCode?: string;
  setAreaCode?: (val: string) => void;
  coordinates?: [number, number] | null;
  setCoordinates?: (val: [number, number]) => void;
  durationValue: string | number;
  setDurationValue: (val: string) => void;
  durationUnit: string;
  setDurationUnit: (val: string) => void;
  fromDate: string;
  setFromDate: (val: string) => void;
  toDate: string;
  setToDate: (val: string) => void;
  errors?: Partial<Record<string, string>>;
}

export const TimeAndPlace: React.FC<TimeAndPlaceProps> = ({
  address,
  setAddress,
  city,
  setCity,
  postalCode = '',
  setPostalCode,
  setCountyCode,
  setMunicipalityCode,
  setAreaCode,
  coordinates,
  setCoordinates,
  durationValue,
  setDurationValue,
  durationUnit,
  setDurationUnit,
  fromDate,
  setFromDate,
  toDate,
  setToDate,
  errors,
}) => {
  const { data: locationTree = [] } = useLocationTree();
  const [lookingUp, setLookingUp] = useState(false);
  const [lookupError, setLookupError] = useState('');
  const lookup = useRef(0);
  const confirmed = !!address && !!coordinates;

  /** A Kartverket hit fills address, postnummer, sted, fylke, kommune and the point (as in the app). */
  const pickAddress = (hit: AddressHit) => {
    // kommunenummer → fylke in our tree (both are Kartverket codes); the name is a fallback.
    const sameName = (name: string) => name.toLowerCase() === hit.municipalityName.toLowerCase();
    const county =
      locationTree.find((c) => c.children?.some((m) => m.code === hit.municipalityCode)) ??
      locationTree.find((c) => c.children?.some((m) => sameName(m.name)));
    const municipality = county?.children?.find((m) => m.code === hit.municipalityCode || sameName(m.name));
    setAddress(hit.address);
    setPostalCode?.(hit.postalCode);
    setCity(hit.city || hit.municipalityName);
    setCountyCode?.(county?.code ?? '');
    setMunicipalityCode?.(municipality?.code ?? '');
    setAreaCode?.('');
    setCoordinates?.([hit.lat, hit.lng]);
  };

  const clearAddress = () => {
    setAddress('');
    setPostalCode?.('');
    setCity('');
    setCountyCode?.('');
    setMunicipalityCode?.('');
    setAreaCode?.('');
  };

  // A point from the map (click, dragged pin, GPS): the pin stays where it was put; the nearest
  // Kartverket address fills the rest.
  const pickPoint = async ([lat, lng]: [number, number]) => {
    const id = ++lookup.current;
    setCoordinates?.([lat, lng]);
    setLookupError('');
    setLookingUp(true);
    try {
      const hit = await addressAt(lat, lng);
      if (id !== lookup.current) return; // a newer click won
      if (hit) {
        pickAddress(hit);
        setCoordinates?.([lat, lng]);
      } else {
        clearAddress();
        setLookupError('Fant ingen adresse her. Flytt nålen nærmere en vei eller et hus.');
      }
    } catch {
      if (id === lookup.current) setLookupError('Kunne ikke finne adressen. Prøv igjen eller søk.');
    } finally {
      if (id === lookup.current) setLookingUp(false);
    }
  };

  // Fylke/kommune have no fields of their own any more: their errors point at the address.
  const locationError =
    errors?.address ||
    (errors?.countyCode || errors?.municipalityCode
      ? 'Fant ikke kommunen for adressen. Velg et annet forslag, eller klikk i kartet.'
      : undefined);

  const inputClass = (invalid?: boolean) =>
    `w-full px-4 md:px-6 py-3 md:py-4 rounded-xl border bg-white text-sm md:text-base outline-none transition-all ${
      invalid
        ? 'border-red-500 focus:border-red-500 focus:ring-4 focus:ring-red-500/5'
        : 'border-gray-200 focus:border-[#2D7A4D] focus:ring-4 focus:ring-[#2D7A4D]/5'
    }`;
  const labelClass = 'text-[11px] md:text-[13px] font-bold text-gray-400 uppercase tracking-wider ml-1';
  const postalCodeError = postalCode && !/^\d{4}$/.test(postalCode) ? 'Postnummeret har 4 sifre.' : '';

  /*
    One Kartverket address search, as in the app: it fills address, postnummer, sted, fylke and
    kommune and drops the pin. Fylke/kommune are no longer dropdowns; they follow the address.
  */
  const locationFields = (
    <>
      <div className="space-y-2">
        <label htmlFor="job-address" className={labelClass}>
          Adresse <span className="text-red-500">*</span>
        </label>
        <AddressSearchField
          id="job-address"
          value={address}
          detail={confirmed ? [postalCode, city].filter(Boolean).join(' ') : undefined}
          confirmed={confirmed}
          error={locationError}
          onSelect={(hit) => {
            lookup.current++; // a search pick beats a lookup still on its way
            setLookingUp(false);
            setLookupError('');
            pickAddress(hit);
          }}
          onClear={clearAddress}
        />
      </div>

      <div className="mt-5 md:mt-6 space-y-2" data-invalid={errors?.coordinates ? 'true' : undefined}>
        <LocationPickerMap coordinates={coordinates} onCoordinatesChange={(point) => void pickPoint(point)} />
        {lookingUp ? (
          <p className="ml-1 flex items-center gap-1.5 text-xs text-gray-500">
            <Loader2 size={12} className="animate-spin" /> Finner adressen …
          </p>
        ) : null}
        {lookupError ? <p className="ml-1 text-xs font-medium text-red-500">{lookupError}</p> : null}
        {errors?.coordinates ? (
          <p className="ml-1 flex items-center gap-1.5 text-[10px] font-bold text-red-500 md:text-xs">
            <AlertCircle size={12} /> {errors.coordinates}
          </p>
        ) : null}
      </div>

      {/* The full address, filled from the search or the map and correctable by hand (e.g. a
          house letter). Only the person chosen for the job sees it. */}
      <p className="mt-6 text-sm font-semibold text-gray-800">Full adresse</p>
      <div className="mt-3 grid grid-cols-1 gap-4 md:grid-cols-[1fr_8rem_1fr]">
        <div className="space-y-2">
          <label htmlFor="job-street" className={labelClass}>Gateadresse</label>
          <input
            id="job-street"
            type="text"
            value={address}
            onChange={(e) => setAddress(e.target.value)}
            placeholder="F.eks. Storgata 5B"
            autoComplete="street-address"
            maxLength={120}
            className={inputClass(false)}
          />
        </div>
        <div className="space-y-2">
          <label htmlFor="job-postal-code" className={labelClass}>Postnr.</label>
          <input
            id="job-postal-code"
            type="text"
            inputMode="numeric"
            value={postalCode}
            onChange={(e) => setPostalCode?.(e.target.value.replace(/\D/g, '').slice(0, 4))}
            placeholder="0150"
            autoComplete="postal-code"
            aria-invalid={postalCodeError ? true : undefined}
            className={inputClass(!!postalCodeError)}
          />
          {postalCodeError ? <p className="ml-1 text-[10px] font-bold text-red-500 md:text-xs">{postalCodeError}</p> : null}
        </div>
        <div className="space-y-2">
          <label htmlFor="job-city" className={labelClass}>Sted</label>
          <input
            id="job-city"
            type="text"
            value={city}
            onChange={(e) => setCity(e.target.value)}
            placeholder="Oslo"
            maxLength={60}
            aria-invalid={errors?.city ? true : undefined}
            className={inputClass(!!errors?.city)}
          />
          {errors?.city && (
            <p className="ml-1 flex items-center gap-1.5 text-[10px] font-bold text-red-500 md:text-xs">
              <AlertCircle size={12} /> {errors.city}
            </p>
          )}
        </div>
      </div>
      <p className="mt-2 ml-1 text-xs text-gray-500">Stedet vises med en nål på kartet i annonsen.</p>
    </>
  );

  return (
    <div className="space-y-6 md:space-y-8 animate-in fade-in slide-in-from-right-4 duration-500">
      {/* 1. Location Section */}
      <div className="box-card-custom rounded-[14px] p-4 md:p-6">
        <div className="flex items-center gap-3 mb-6">
          <div className="w-10 h-10 bg-[#2D7A4D]/10 rounded-full flex items-center justify-center text-[#2D7A4D] shrink-0">
            <MapPin size={22} />
          </div>
          <div>
            <h2 className="font-bold text-lg md:text-xl text-custom-black">
              Hvor skal det gjøres?
            </h2>
            <p className="text-gray-500 text-xs md:text-sm">
              Oppgi adresse og bekreft lokasjon på kartet
            </p>
          </div>
        </div>

        {GOOGLE_MAPS_API_KEY ? (
          <APIProvider apiKey={GOOGLE_MAPS_API_KEY} libraries={['marker', 'geocoding']}>
            {locationFields}
          </APIProvider>
        ) : (
          locationFields
        )}
      </div>

      {/* 2. Time Section */}
      <div className="box-card-custom rounded-[14px] p-4 md:p-6">
        <div className="flex items-center gap-3 mb-6">
          <div className="w-10 h-10 bg-[#2D7A4D]/10 rounded-full flex items-center justify-center text-[#2D7A4D] shrink-0">
            <Calendar size={22} />
          </div>
          <div>
            <h2 className="font-bold text-lg md:text-xl text-custom-black">Når skal det gjøres?</h2>
            <p className="text-gray-500 text-xs md:text-sm">Velg datoer som passer for deg</p>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 md:gap-6">
          <div className="space-y-2">
            <label htmlFor="job-from-date" className="text-[11px] md:text-[13px] font-bold text-gray-400 uppercase tracking-wider ml-1">
              Fra dato
            </label>
            <input
              id="job-from-date"
              title="Velg fra dato"
              type="date"
              value={fromDate ? fromDate.split('T')[0] : ''}
              onChange={(e) => setFromDate(e.target.value)}
              className={`w-full px-4 md:px-6 py-3 md:py-4 rounded-xl border bg-white text-sm md:text-base outline-none transition-all cursor-pointer
                ${errors?.fromDate ? 'border-red-500 focus:border-red-500 focus:ring-4 focus:ring-red-500/5' : 'border-gray-200 focus:border-[#2D7A4D] focus:ring-4 focus:ring-[#2D7A4D]/5'}`}
            />
            {errors?.fromDate && (
              <p className="mt-1 text-red-500 text-[10px] md:text-xs font-bold flex items-center gap-1.5 animate-in fade-in slide-in-from-top-1">
                <AlertCircle size={12} /> {errors.fromDate}
              </p>
            )}
          </div>
          <div className="space-y-2">
            <label htmlFor="job-to-date" className="text-[11px] md:text-[13px] font-bold text-gray-400 uppercase tracking-wider ml-1">
              Til dato
            </label>
            <input
              id="job-to-date"
              title="Velg til dato"
              type="date"
              value={toDate ? toDate.split('T')[0] : ''}
              onChange={(e) => setToDate(e.target.value)}
              className={`w-full px-4 md:px-6 py-3 md:py-4 rounded-xl border bg-white text-sm md:text-base outline-none transition-all cursor-pointer
                ${errors?.toDate ? 'border-red-500 focus:border-red-500 focus:ring-4 focus:ring-red-500/5' : 'border-gray-200 focus:border-[#2D7A4D] focus:ring-4 focus:ring-[#2D7A4D]/5'}`}
            />
            {errors?.toDate && (
              <p className="mt-1 text-red-500 text-[10px] md:text-xs font-bold flex items-center gap-1.5 animate-in fade-in slide-in-from-top-1">
                <AlertCircle size={12} /> {errors.toDate}
              </p>
            )}
          </div>
        </div>

        <div className="mt-4 md:mt-6 flex items-start gap-3 p-3 md:p-4 bg-blue-50 rounded-xl border border-blue-100 text-blue-700 text-xs md:text-sm">
          <Info size={16} className="shrink-0 mt-0.5" />
          <p>La feltene stå tomme dersom du er fleksibel på tidspunkt.</p>
        </div>
      </div>

      {/* 3. Duration Section */}
      <div className="box-card-custom rounded-[14px] p-4 md:p-6">
        <div className="flex items-center gap-3 mb-6">
          <div className="w-10 h-10 bg-[#2D7A4D]/10 rounded-full flex items-center justify-center text-[#2D7A4D] shrink-0">
            <Clock size={22} />
          </div>
          <div>
            <h2 className="font-bold text-lg md:text-xl text-custom-black">
              Forventet varighet <span className="text-red-500">*</span>
            </h2>
            <p className="text-gray-500 text-xs md:text-sm">
              Hvor lang tid antar du at oppdraget tar?
            </p>
          </div>
        </div>

        <div className="flex flex-col sm:flex-row gap-3 md:gap-4">
          <div className="flex-1 space-y-2">
            <input
              type="number"
              min={1}
              value={durationValue ?? ''}
              onChange={(e) => setDurationValue(e.target.value)}
              placeholder="F.eks. 2"
              className={`w-full px-4 md:px-6 py-3 md:py-4 rounded-xl border bg-white text-sm md:text-base outline-none transition-all
                ${errors?.durationValue ? 'border-red-500 focus:border-red-500 focus:ring-4 focus:ring-red-500/5' : 'border-gray-200 focus:border-[#2D7A4D] focus:ring-4 focus:ring-[#2D7A4D]/5'}`}
            />
            {errors?.durationValue && (
              <p className="mt-1 text-red-500 text-[10px] md:text-xs font-bold flex items-center gap-1.5 animate-in fade-in slide-in-from-top-1">
                <AlertCircle size={12} /> {errors.durationValue}
              </p>
            )}
          </div>
          <div className="h-fit space-y-2">
            <Select
              value={durationUnit || undefined}
              onValueChange={(value) => setDurationUnit(value)}
            >
              <SelectTrigger className="w-full sm:w-32 md:w-40 px-4 md:px-4 py-3 md:py-4 rounded-xl border border-gray-200 bg-white text-sm md:text-base font-bold text-[#2D7A4D] focus:border-[#2D7A4D] focus:ring-4 focus:ring-[#2D7A4D]/5">
                <SelectValue placeholder="Velg" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="minutes">Minutter</SelectItem>
                <SelectItem value="hours">Timer</SelectItem>
                <SelectItem value="days">Dager</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        <div className="mt-4 md:mt-6 flex items-start gap-3 p-3 md:p-4 bg-blue-50 rounded-xl border border-blue-100 text-blue-700 text-xs md:text-sm">
          <Info size={16} className="shrink-0 mt-0.5" />
          <p>
            Et grovt anslag er nok — du kan alltid justere dette senere i samtalen
            med søkere.
          </p>
        </div>
      </div>
    </div>
  );
};
