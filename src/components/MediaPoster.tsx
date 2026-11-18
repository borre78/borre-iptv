import { Film, Radio, Tv } from 'lucide-react';
import { useState } from 'react';
import { MediaType } from '../types/iptv';

interface MediaPosterProps {
  src?: string;
  alt: string;
  type: MediaType;
  className?: string;
}

export function MediaPoster({ src, alt, type, className = '' }: MediaPosterProps) {
  const [hasError, setHasError] = useState(false);

  const Icon = type === 'live' ? Radio : type === 'series' ? Tv : Film;

  if (!src || hasError) {
    return (
      <div
        className={`flex h-full w-full flex-col items-center justify-center bg-gradient-to-br from-[#161822] via-[#101118] to-[#0C0D12] p-4 text-center ${className}`}
      >
        <div className="mb-2.5 flex h-11 w-11 items-center justify-center rounded-xl bg-white/[0.04] text-violet-400">
          <Icon className="h-5 w-5" aria-hidden="true" />
        </div>
        <span className="line-clamp-3 text-xs font-medium leading-snug text-zinc-400">
          {alt}
        </span>
      </div>
    );
  }

  return (
    <img
      src={src}
      alt={alt}
      loading="lazy"
      referrerPolicy="no-referrer"
      onError={() => setHasError(true)}
      className={`h-full w-full object-cover ${className}`}
    />
  );
}
