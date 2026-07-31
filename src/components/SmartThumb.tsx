import { useState } from "react";

/**
 * Artwork comes from several providers: TMDB backdrops are 16:9, iTunes art is
 * square and Wikipedia posters are portrait. Cropping all of them to a 16:9
 * card chops off faces and titles, so anything that isn't already wide is shown
 * fully (contain) on top of a blurred, colour-matched fill of itself.
 */
export function SmartThumb({
  src,
  alt,
  className = "",
  fallback,
}: {
  src: string | null | undefined;
  alt: string;
  className?: string;
  fallback?: React.ReactNode;
}) {
  const [ratio, setRatio] = useState<number | null>(null);
  const [failed, setFailed] = useState(false);

  if (!src || failed) return <>{fallback ?? null}</>;

  // 16:9 = 1.78. Treat anything reasonably wide as a true backdrop.
  const isWide = ratio === null || ratio >= 1.6;

  return (
    <div className={`relative h-full w-full overflow-hidden ${className}`}>
      {!isWide && (
        <img
          src={src}
          alt=""
          aria-hidden
          className="absolute inset-0 h-full w-full scale-125 object-cover blur-2xl saturate-150 opacity-60"
        />
      )}
      <img
        src={src}
        alt={alt}
        loading="lazy"
        decoding="async"
        onLoad={(e) => {
          const img = e.currentTarget;
          if (img.naturalWidth && img.naturalHeight) setRatio(img.naturalWidth / img.naturalHeight);
        }}
        onError={() => setFailed(true)}
        className={`relative h-full w-full transition-transform duration-700 ease-out group-hover:scale-[1.07] ${
          isWide ? "object-cover" : "object-contain"
        }`}
      />
    </div>
  );
}
