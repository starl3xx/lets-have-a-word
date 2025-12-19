/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    './pages/**/*.{js,ts,jsx,tsx,mdx}',
    './components/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      /**
       * Milestone 7.0: Design Tokens
       * Unified color palette, typography, and animation system
       */

      // Brand & Semantic Colors
      colors: {
        // Primary brand blue (from TopTicker)
        brand: {
          DEFAULT: '#2D68C7',
          50: '#EBF1FA',
          100: '#D7E3F5',
          200: '#AFCAEB',
          300: '#87AFE0',
          400: '#5F94D6',
          500: '#2D68C7', // Primary
          600: '#2558A8',
          700: '#1D4689',
          800: '#15346A',
          900: '#0D224B',
        },
        // Accent purple (CLANKTON)
        accent: {
          DEFAULT: '#7c3aed',
          50: '#f5f3ff',
          100: '#ede9fe',
          200: '#ddd6fe',
          300: '#c4b5fd',
          400: '#a78bfa',
          500: '#8b5cf6',
          600: '#7c3aed', // CLANKTON purple
          700: '#6d28d9',
          800: '#5b21b6',
          900: '#4c1d95',
        },
        // Semantic: Success (green)
        success: {
          DEFAULT: '#22c55e',
          50: '#f0fdf4',
          100: '#dcfce7',
          200: '#bbf7d0',
          300: '#86efac',
          400: '#4ade80',
          500: '#22c55e',
          600: '#16a34a',
          700: '#15803d',
          800: '#166534',
          900: '#14532d',
        },
        // Semantic: Error (red)
        error: {
          DEFAULT: '#ef4444',
          50: '#fef2f2',
          100: '#fee2e2',
          200: '#fecaca',
          300: '#fca5a5',
          400: '#f87171',
          500: '#ef4444',
          600: '#dc2626',
          700: '#b91c1c',
          800: '#991b1b',
          900: '#7f1d1d',
        },
        // Semantic: Warning (amber)
        warning: {
          DEFAULT: '#f59e0b',
          50: '#fffbeb',
          100: '#fef3c7',
          200: '#fde68a',
          300: '#fcd34d',
          400: '#fbbf24',
          500: '#f59e0b',
          600: '#d97706',
          700: '#b45309',
          800: '#92400e',
          900: '#78350f',
        },
      },

      // Typography - Leverage Soehne weight range
      fontFamily: {
        sans: ['Soehne', '-apple-system', 'BlinkMacSystemFont', 'Segoe UI', 'sans-serif'],
      },
      fontWeight: {
        // Soehne weight mapping (German names)
        extralight: '200', // extraleicht
        light: '300',      // leicht
        book: '400',       // buch (normal)
        medium: '500',     // kräftig
        semibold: '600',   // halbfett
        bold: '700',       // dreiviertelfett
        extrabold: '800',  // fett
        black: '900',      // extrafett
      },

      // Animation timing tokens
      transitionDuration: {
        'fast': '150ms',
        'normal': '200ms',
        'slow': '300ms',
        'slower': '400ms',
      },
      transitionTimingFunction: {
        'smooth': 'cubic-bezier(0.4, 0, 0.2, 1)',
        'bounce': 'cubic-bezier(0.34, 1.56, 0.64, 1)',
      },

      // Consistent spacing for buttons
      spacing: {
        'btn-sm': '0.625rem', // 10px - for small buttons
        'btn': '0.75rem',     // 12px - standard button padding
        'btn-lg': '1rem',     // 16px - large button padding
      },

      // Border radius tokens
      borderRadius: {
        'btn': '0.75rem',     // 12px - standard button radius
        'card': '1rem',       // 16px - card/modal radius
        'pill': '9999px',     // full pill shape
      },

      // Box shadow for interactive elements
      boxShadow: {
        'btn': '0 2px 4px rgba(0, 0, 0, 0.1)',
        'btn-active': '0 1px 2px rgba(0, 0, 0, 0.1)',
        'card': '0 4px 12px rgba(0, 0, 0, 0.1)',
        'modal': '0 8px 32px rgba(0, 0, 0, 0.2)',
      },

      // Animation keyframes
      keyframes: {
        shake: {
          '0%, 100%': { transform: 'translateX(0)' },
          '10%, 30%, 50%, 70%, 90%': { transform: 'translateX(-8px)' },
          '20%, 40%, 60%, 80%': { transform: 'translateX(8px)' },
        },
        'pulse-glow': {
          '0%, 100%': {
            boxShadow: '0 0 10px rgba(34, 197, 94, 0.4), 0 0 20px rgba(34, 197, 94, 0.2)',
            transform: 'scale(1)',
          },
          '50%': {
            boxShadow: '0 0 20px rgba(34, 197, 94, 0.6), 0 0 40px rgba(34, 197, 94, 0.4)',
            transform: 'scale(1.02)',
          },
        },
        'fade-in': {
          '0%': { opacity: '0' },
          '100%': { opacity: '1' },
        },
        'slide-up': {
          '0%': { transform: 'translateY(100%)', opacity: '0' },
          '100%': { transform: 'translateY(0)', opacity: '1' },
        },
      },
      animation: {
        shake: 'shake 0.4s ease-in-out',
        'pulse-glow': 'pulse-glow 1.5s ease-in-out infinite',
        'fade-in': 'fade-in 0.2s ease-out',
        'slide-up': 'slide-up 0.3s ease-out',
      },
    },
  },
  plugins: [],
};
