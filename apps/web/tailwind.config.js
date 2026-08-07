/** @type {import('tailwindcss').Config} */
module.exports = {
  darkMode: 'class',
  content: ['./src/**/*.{ts,tsx}'],
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
        sans: ['var(--font-display)', 'ui-sans-serif', 'sans-serif'],
        display: ['var(--font-display)', 'ui-sans-serif', 'sans-serif'],
        mono: ['var(--font-mono)', 'ui-monospace', 'monospace'],
      },
      borderRadius: {
        sm: '0.375rem',
        DEFAULT: '0.5rem',
        md: '0.5rem',
        lg: '0.625rem',
        xl: '0.75rem',
        '2xl': '0.875rem',
      },
      maxWidth: {
        shell: '80rem',
      },
    },
  },
  plugins: [],
};
