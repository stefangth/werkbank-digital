interface Address { street?: string | null; postal_code?: string | null; city?: string | null }

/** Directions link that opens the maps app on both platforms; null without street and city. */
export function mapsLink(address: Address): string | null {
  const street = address.street?.trim();
  const city = address.city?.trim();
  if (!street || !city) return null;
  const place = [address.postal_code?.trim(), city].filter(Boolean).join(" ");
  return `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(`${street}, ${place}`)}`;
}
