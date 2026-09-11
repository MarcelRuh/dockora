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

/** Hex mark + HTML wordmark (not a baked lockup image). */
export function BrandLogoWide({ className, priority = false, size = 'md' }: BrandLogoWideProps) {
  return (
    <span className={cn('inline-flex items-center gap-3', className)}>
      <BrandLogo size={size} priority={priority} alt="" />
      <span className="min-w-0 text-left leading-none">
        <span className="dockora-logo-gradient block text-[1.35rem]">DOCKORA</span>
        <span className="dockora-logo-tagline mt-1.5 block text-[0.58rem]">Docker Management Suite</span>
      </span>
    </span>
  );
}
