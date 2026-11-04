/** "Storgata 1, 0155 Oslo": a job's full address, as far as it is known (as on the web). */
export function fullAddress(
  location: { address?: string; postalCode?: string; city?: string } | null | undefined
): string {
  return [location?.address, [location?.postalCode, location?.city].filter(Boolean).join(' ')]
    .filter(Boolean)
    .join(', ');
}
