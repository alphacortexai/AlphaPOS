import Image from 'next/image';

type LogoVariant = 'inline' | 'stacked' | 'mark';

const Mark = ({ priority = false }: { priority?: boolean }) => (
  <Image className="logo-mark" src="/brand/mark.png" alt="" width={105} height={86} priority={priority} unoptimized />
);

const Word = ({ priority = false }: { priority?: boolean }) => (
  <Image className="logo-word" src="/brand/wordmark.png" alt="AlphaPOS" width={165} height={34} priority={priority} unoptimized />
);

export default function Logo({ variant = 'inline' }: { variant?: LogoVariant }) {
  const priority = variant !== 'inline';
  if (variant === 'mark') return <Mark priority={priority} />;
  if (variant === 'stacked') {
    return (
      <div className="logo-stack">
        <Mark priority={priority} />
        <Word priority={priority} />
      </div>
    );
  }
  return (
    <span className="logo-inline">
      <Mark />
      <Word />
    </span>
  );
}
