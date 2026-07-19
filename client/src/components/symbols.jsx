/** Print-style monochrome symbols for toxin formulas (color applied by parent). */

export function SymbolGlyph({ symbol, className = '' }) {
  const common = {
    viewBox: '0 0 64 64',
    className: `sym ${className}`,
    'aria-hidden': true,
    fill: 'currentColor',
  };

  switch (symbol) {
    case 'skull':
      return (
        <svg {...common}>
          <ellipse cx="32" cy="28" rx="18" ry="16" />
          <rect x="22" y="40" width="20" height="10" rx="2" />
          <circle cx="24" cy="26" r="4" fill="#fff" opacity="0.95" />
          <circle cx="40" cy="26" r="4" fill="#fff" opacity="0.95" />
          <path d="M28 36h8v3h-8z" fill="#fff" opacity="0.9" />
          <path d="M20 48h6v6h-2v-4h-2zm18 0h6v2h-2v4h-2v-4h-2z" />
        </svg>
      );
    case 'drop':
      return (
        <svg {...common}>
          <path d="M32 8C32 8 14 30 14 40a18 18 0 0036 0C50 30 32 8 32 8z" />
          <ellipse cx="26" cy="36" rx="4" ry="6" fill="#fff" opacity="0.35" />
        </svg>
      );
    case 'leaf':
      return (
        <svg {...common}>
          <path d="M32 56C32 56 12 42 12 26 12 14 22 8 32 8c10 0 20 6 20 18 0 16-20 30-20 30z" />
          <path d="M32 14v36" stroke="#fff" strokeWidth="2.5" fill="none" opacity="0.5" />
          <path d="M32 28c-6 2-10 6-12 10M32 36c6 2 10 6 12 8" stroke="#fff" strokeWidth="2" fill="none" opacity="0.45" />
        </svg>
      );
    case 'bio':
      return (
        <svg {...common}>
          <circle cx="32" cy="32" r="8" />
          <circle cx="32" cy="14" r="7" />
          <circle cx="16" cy="42" r="7" />
          <circle cx="48" cy="42" r="7" />
          <path d="M32 22v4M24.5 37l3.5-3M39.5 37l-3.5-3" stroke="#fff" strokeWidth="2.5" opacity="0.5" />
        </svg>
      );
    case 'crystal':
      return (
        <svg {...common}>
          <path d="M32 6l14 20-14 32L18 26z" />
          <path d="M32 6l-6 20h12L32 6z" fill="#fff" opacity="0.25" />
          <path d="M18 26h28" stroke="#fff" strokeWidth="1.5" opacity="0.35" fill="none" />
        </svg>
      );
    case 'flame':
      return (
        <svg {...common}>
          <path d="M32 58c-12 0-18-10-18-20 0-10 8-16 12-24 2 8 6 10 6 16 0-8 8-14 12-22 8 10 6 22 6 30 0 10-6 20-18 20z" />
          <path d="M32 50c-6 0-8-5-8-10 0-4 3-7 5-11 1 3 3 4 3 7 0-4 3-6 5-10 3 5 3 10 3 14 0 5-2 10-8 10z" fill="#fff" opacity="0.3" />
        </svg>
      );
    case 'molecule':
      return (
        <svg {...common}>
          <circle cx="32" cy="32" r="7" />
          <circle cx="14" cy="18" r="6" />
          <circle cx="50" cy="18" r="6" />
          <circle cx="14" cy="48" r="6" />
          <circle cx="50" cy="48" r="6" />
          <path d="M20 22l8 6M44 22l-8 6M20 44l8-6M44 44l-8-6" stroke="currentColor" strokeWidth="3" fill="none" />
        </svg>
      );
    case 'syringe':
      return (
        <svg {...common}>
          <rect x="38" y="8" width="10" height="14" rx="1" transform="rotate(45 43 15)" />
          <rect x="22" y="22" width="12" height="28" rx="2" transform="rotate(45 28 36)" />
          <path d="M18 48l-6 6M14 44l-4 4" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
          <rect x="40" y="12" width="16" height="4" transform="rotate(45 48 14)" />
        </svg>
      );
    default:
      return (
        <svg {...common}>
          <circle cx="32" cy="32" r="16" />
        </svg>
      );
  }
}
