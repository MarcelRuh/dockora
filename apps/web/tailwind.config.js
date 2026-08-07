/** @type {import('tailwindcss').Config} */
module.exports = {
  darkMode: 'class',
  content: ['./src/**/*.{ts,tsx}'],
  future: {
    // Touch: first tap must activate, not only apply :hover
    hoverOnlyWhenSupported: true,
  },
  theme: {
    extend: {
      colors: {
        dockora: {
          bg: 'var(--dockora-bg)',
          surface: 'var(--dockora-surface)',
          surface2: 'var(--dockora-surface-2)',
          border: 'var(--dockora-border)',
          text: 'var(--dockora-text)',
          muted: 'var(--dockora-muted)',
          accent: 'var(--dockora-accent)',
          accentSoft: 'var(--dockora-accent-soft)',
          accentFg: 'var(--dockora-accent-fg)',
          blue: 'var(--dockora-blue)',
          pink: 'var(--dockora-pink)',
          purple: 'var(--dockora-purple)',
          success: 'var(--dockora-success)',
          warning: 'var(--dockora-warning)',
          danger: 'var(--dockora-danger)',
          rail: 'var(--dockora-rail)',
          railText: 'var(--dockora-rail-text)',
          railMuted: 'var(--dockora-rail-muted)',
          railBorder: 'var(--dockora-rail-border)',
        },
      },
      fontFamily: {
        sans: ['var(--font-sans)', 'ui-sans-serif', 'sans-serif'],
        display: ['var(--font-display)', 'var(--font-sans)', 'sans-serif'],
        mono: ['var(--font-mono)', 'ui-monospace', 'monospace'],
      },
      borderRadius: {
        sm: '0.25rem',
        DEFAULT: '0.25rem',
        md: '0.35rem',
        lg: '0.5rem',
        xl: '0.75rem',
        '2xl': '1rem',
        full: '9999px',
      },
      boxShadow: {
        neon: '0 0 24px rgba(255, 0, 110, 0.4)',
        'neon-strong': '0 10px 40px rgba(255, 0, 110, 0.5)',
        'neon-soft': '0 0 18px rgba(131, 56, 236, 0.25)',
        'neon-blue': '0 0 24px rgba(0, 180, 216, 0.35)',
        'neon-pink': '0 0 20px rgba(255, 0, 110, 0.4)',
      },
      maxWidth: {
        shell: '110rem',
      },
    },
  },
  plugins: [],
};
