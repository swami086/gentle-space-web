type MapEmbedProps = {
  lat: number | null;
  lng: number | null;
  address: string;
};

function mapsSearchUrl(lat: number | null, lng: number | null, address: string): string {
  const q = lat != null && lng != null ? `${lat},${lng}` : address;
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(q)}`;
}

export function MapEmbed({ lat, lng, address }: MapEmbedProps) {
  const embedKey = process.env.GOOGLE_MAPS_EMBED_KEY;
  const hasCoords = lat != null && lng != null;
  const placeQuery = hasCoords ? `${lat},${lng}` : address.trim();
  const canEmbed = Boolean(embedKey && placeQuery);
  const openInMapsHref = mapsSearchUrl(lat, lng, address);

  return (
    <section className="flex flex-col gap-3">
      {canEmbed ? (
        <div className="aspect-[16/10] overflow-hidden rounded-[var(--radius-md)] border border-[var(--border)]">
          <iframe
            title={`Map for ${address || placeQuery}`}
            src={`https://www.google.com/maps/embed/v1/place?key=${embedKey}&q=${encodeURIComponent(placeQuery)}`}
            className="h-full w-full border-0"
            loading="lazy"
            referrerPolicy="no-referrer-when-downgrade"
            allowFullScreen
          />
        </div>
      ) : (
        <div className="flex aspect-[16/10] items-center justify-center rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface-tint)] px-4 text-center">
          <span className="text-sm text-[var(--muted)]">{address || "Location unavailable"}</span>
        </div>
      )}

      <a
        href={openInMapsHref}
        target="_blank"
        rel="noopener noreferrer"
        className="text-sm font-semibold text-[var(--accent)] transition hover:text-[var(--accent-dark)]"
      >
        Open in Google Maps
      </a>
    </section>
  );
}
