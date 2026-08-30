import Image from 'next/image';
import { cn } from '@/lib/utils';

type BrandLogoProps = {
  className?: string;
  /** Visual size preset */
  size?: 'sm' | 'md' | 'lg';
  priority?: boolean;
};

const SIZES = {
  sm: { box: 'h-9 w-9', px: 36 },
  md: { box: 'h-14 w-14', px: 56 },
  lg: { box: 'h-[7.5rem] w-[7.5rem]', px: 120 },
} as const;

/** Official Dockora mark (whale + wordmark artwork). */
export function BrandLogo({ className, size = 'md', priority = false }: BrandLogoProps) {
  const s = SIZES[size];
  return (
    <span className={cn('relative inline-flex shrink-0 overflow-hidden', s.box, className)}>
      <Image
        src="/logo.webp"
        alt="Dockora"
        width={s.px}
        height={s.px}
        sizes={`${s.px}px`}
        className="h-full w-full object-contain"
        priority={priority}
      />
    </span>
  );
}

/** Wide brand lockup for the sidebar header. */
export function BrandLogoWide({ className, priority = false }: { className?: string; priority?: boolean }) {
  return (
    <span className={cn('relative block w-full', className)}>
      <Image
        src="/logo.webp"
        alt="Dockora – Docker Management Suite"
        width={240}
        height={240}
        sizes="(max-width: 768px) 12rem, 15rem"
        className="h-auto w-full object-contain"
        priority={priority}
      />
    </span>
  );
}
