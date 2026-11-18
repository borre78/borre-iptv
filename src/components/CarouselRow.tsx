import { ChevronLeft, ChevronRight } from 'lucide-react';
import { ReactNode, useRef } from 'react';

interface CarouselRowProps {
  title: string;
  subtitle?: string;
  actionLabel?: string;
  onAction?: () => void;
  children: ReactNode;
}

export function CarouselRow({
  title,
  subtitle,
  actionLabel,
  onAction,
  children,
}: CarouselRowProps) {
  const trackRef = useRef<HTMLDivElement>(null);

  const scrollByAmount = (direction: 'left' | 'right') => {
    const el = trackRef.current;
    if (!el) return;
    const distance = Math.max(320, el.clientWidth * 0.78);
    el.scrollBy({
      left: direction === 'left' ? -distance : distance,
      behavior: 'smooth',
    });
  };

  return (
    <section className="space-y-3.5">
      <div className="flex items-end justify-between gap-4">
        <div>
          <h2 className="font-display text-lg font-semibold tracking-tight text-white sm:text-xl">
            {title}
          </h2>
          {subtitle && (
            <p className="mt-0.5 text-xs text-zinc-400">{subtitle}</p>
          )}
        </div>

        <div className="flex items-center gap-2 shrink-0">
          {actionLabel && onAction && (
            <button
              type="button"
              onClick={onAction}
              className="mr-1 text-xs font-medium text-blue-400 transition-colors hover:text-blue-300 whitespace-nowrap"
            >
              {actionLabel}
            </button>
          )}
          <button
            type="button"
            onClick={() => scrollByAmount('left')}
            aria-label={`Desplazar ${title} a la izquierda`}
            className="hidden h-8 w-8 items-center justify-center rounded-lg border border-white/10 bg-[#13141C] text-zinc-300 transition-colors hover:border-violet-500/40 hover:text-white sm:inline-flex"
          >
            <ChevronLeft className="h-4 w-4" aria-hidden="true" />
          </button>
          <button
            type="button"
            onClick={() => scrollByAmount('right')}
            aria-label={`Desplazar ${title} a la derecha`}
            className="hidden h-8 w-8 items-center justify-center rounded-lg border border-white/10 bg-[#13141C] text-zinc-300 transition-colors hover:border-violet-500/40 hover:text-white sm:inline-flex"
          >
            <ChevronRight className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>
      </div>

      <div
        ref={trackRef}
        className="no-scrollbar flex gap-4 overflow-x-auto pb-2 scroll-smooth"
      >
        {children}
      </div>
    </section>
  );
}
