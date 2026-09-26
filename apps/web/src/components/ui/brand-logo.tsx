import Image from 'next/image';
import { cn } from '@/lib/utils';

type BrandLogoSize = 'sm' | 'md' | 'lg';

type BrandLogoProps = {
  className?: string;
  /** Visual size preset */
  size?: BrandLogoSize;
  priority?: boolean;
  /** Empty string marks the image decorative (wordmark is adjacent text). */
  alt?: string;
};

const SIZES = {
  sm: { box: 'h-9 w-9', px: 36 },
  md: { box: 'h-14 w-14', px: 56 },
  lg: { box: 'h-[4.5rem] w-[4.5rem]', px: 72 },
} as const;

/** Square Dockora mark (whale + containers in hex). */
export function BrandLogo({ className, size = 'md', priority = false, alt = 'Dockora' }: BrandLogoProps) {
  const s = SIZES[size];
  return (
    <span className={cn('relative inline-flex shrink-0 overflow-hidden', s.box, className)}>
      <Image
        src="/logo.webp"
        alt={alt}
        width={s.px}
        height={s.px}
        sizes={`${s.px}px`}
        className="h-full w-full object-contain"
        priority={priority}
      />
    </span>
  );
}

type BrandLogoWideProps = {
  className?: string;
  priority?: boolean;
  size?: BrandLogoSize;
};

const WORDMARK = {
  sm: { mark: 'text-base', tag: 'mt-1 text-[0.55rem]', gap: 'gap-2' },
  md: { mark: 'text-[1.35rem]', tag: 'mt-1.5 text-[0.62rem]', gap: 'gap-3' },
  lg: { mark: 'text-[1.65rem]', tag: 'mt-1.5 text-[0.68rem]', gap: 'gap-3' },
} as const;

/** Hex mark + HTML wordmark (not a baked lockup image). */
export function BrandLogoWide({ className, priority = false, size = 'md' }: BrandLogoWideProps) {
  const text = WORDMARK[size];
  return (
    <span className={cn('inline-flex shrink-0 items-center', text.gap, className)}>
      <BrandLogo size={size} priority={priority} alt="" />
      <span className="text-left">
        <span className={cn('dockora-logo-gradient block', text.mark)}>DOCKORA</span>
        <span className={cn('dockora-logo-tagline block', text.tag)}>Docker Management Suite</span>
      </span>
    </span>
  );
}
