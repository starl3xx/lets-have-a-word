/** @type {import('tailwindcss').Config} */
module.exports = {
    darkMode: ['class'],
    content: [
    './pages/**/*.{js,ts,jsx,tsx,mdx}',
    './components/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
  	extend: {
  		colors: {
  			brand: {
  				'50': '#EBF1FA',
  				'100': '#D7E3F5',
  				'200': '#AFCAEB',
  				'300': '#87AFE0',
  				'400': '#5F94D6',
  				'500': '#2D68C7',
  				'600': '#2558A8',
  				'700': '#1D4689',
  				'800': '#15346A',
  				'900': '#0D224B',
  				DEFAULT: '#2D68C7'
  			},
  			accent: {
  				DEFAULT: '#7c3aed',
  				50: '#f5f3ff',
  				100: '#ede9fe',
  				200: '#ddd6fe',
  				300: '#c4b5fd',
  				400: '#a78bfa',
  				500: '#8b5cf6',
  				600: '#7c3aed', // $WORD purple
  				700: '#6d28d9',
  				800: '#5b21b6',
  				900: '#4c1d95',
  			},
  			success: {
  				'50': '#f0fdf4',
  				'100': '#dcfce7',
  				'200': '#bbf7d0',
  				'300': '#86efac',
  				'400': '#4ade80',
  				'500': '#22c55e',
  				'600': '#16a34a',
  				'700': '#15803d',
  				'800': '#166534',
  				'900': '#14532d',
  				DEFAULT: '#22c55e'
  			},
  			error: {
  				'50': '#fef2f2',
  				'100': '#fee2e2',
  				'200': '#fecaca',
  				'300': '#fca5a5',
  				'400': '#f87171',
  				'500': '#ef4444',
  				'600': '#dc2626',
  				'700': '#b91c1c',
  				'800': '#991b1b',
  				'900': '#7f1d1d',
  				DEFAULT: '#ef4444'
  			},
  			warning: {
  				'50': '#fffbeb',
  				'100': '#fef3c7',
  				'200': '#fde68a',
  				'300': '#fcd34d',
  				'400': '#fbbf24',
  				'500': '#f59e0b',
  				'600': '#d97706',
  				'700': '#b45309',
  				'800': '#92400e',
  				'900': '#78350f',
  				DEFAULT: '#f59e0b'
  			},
  			background: 'hsl(var(--background))',
  			foreground: 'hsl(var(--foreground))',
  			card: {
  				DEFAULT: 'hsl(var(--card))',
  				foreground: 'hsl(var(--card-foreground))'
  			},
  			popover: {
  				DEFAULT: 'hsl(var(--popover))',
  				foreground: 'hsl(var(--popover-foreground))'
  			},
  			primary: {
  				DEFAULT: 'hsl(var(--primary))',
  				foreground: 'hsl(var(--primary-foreground))'
  			},
  			secondary: {
  				DEFAULT: 'hsl(var(--secondary))',
  				foreground: 'hsl(var(--secondary-foreground))'
  			},
  			muted: {
  				DEFAULT: 'hsl(var(--muted))',
  				foreground: 'hsl(var(--muted-foreground))'
  			},
  			destructive: {
  				DEFAULT: 'hsl(var(--destructive))',
  				foreground: 'hsl(var(--destructive-foreground))'
  			},
  			border: 'hsl(var(--border))',
  			input: 'hsl(var(--input))',
  			ring: 'hsl(var(--ring))',
  			chart: {
  				'1': 'hsl(var(--chart-1))',
  				'2': 'hsl(var(--chart-2))',
  				'3': 'hsl(var(--chart-3))',
  				'4': 'hsl(var(--chart-4))',
  				'5': 'hsl(var(--chart-5))'
  			},
  			sidebar: {
  				DEFAULT: 'hsl(var(--sidebar))',
  				foreground: 'hsl(var(--sidebar-foreground))',
  				primary: 'hsl(var(--sidebar-primary))',
  				'primary-foreground': 'hsl(var(--sidebar-primary-foreground))',
  				accent: 'hsl(var(--sidebar-accent))',
  				'accent-foreground': 'hsl(var(--sidebar-accent-foreground))',
  				border: 'hsl(var(--sidebar-border))',
  				ring: 'hsl(var(--sidebar-ring))'
  			}
  		},
  		fontFamily: {
  			sans: [
  				'Soehne',
  				'-apple-system',
  				'BlinkMacSystemFont',
  				'Segoe UI',
  				'sans-serif'
  			]
  		},
  		fontWeight: {
  			extralight: '200',
  			light: '300',
  			book: '400',
  			medium: '500',
  			semibold: '600',
  			bold: '700',
  			extrabold: '800',
  			black: '900'
  		},
  		transitionDuration: {
  			fast: '150ms',
  			normal: '200ms',
  			slow: '300ms',
  			slower: '400ms'
  		},
  		transitionTimingFunction: {
  			smooth: 'cubic-bezier(0.4, 0, 0.2, 1)',
  			bounce: 'cubic-bezier(0.34, 1.56, 0.64, 1)'
  		},
  		spacing: {
  			'btn-sm': '0.625rem',
  			btn: '0.75rem',
  			'btn-lg': '1rem'
  		},
  		borderRadius: {
  			btn: '0.75rem',
  			card: '1rem',
  			pill: '9999px',
  			lg: 'var(--radius)',
  			md: 'calc(var(--radius) - 2px)',
  			sm: 'calc(var(--radius) - 4px)'
  		},
  		boxShadow: {
  			btn: '0 2px 4px rgba(0, 0, 0, 0.1)',
  			'btn-active': '0 1px 2px rgba(0, 0, 0, 0.1)',
  			card: '0 4px 12px rgba(0, 0, 0, 0.1)',
  			modal: '0 8px 32px rgba(0, 0, 0, 0.2)'
  		},
  		keyframes: {
  			shake: {
  				'0%, 100%': {
  					transform: 'translateX(0)'
  				},
  				'10%, 30%, 50%, 70%, 90%': {
  					transform: 'translateX(-8px)'
  				},
  				'20%, 40%, 60%, 80%': {
  					transform: 'translateX(8px)'
  				}
  			},
  			'pulse-glow': {
  				'0%, 100%': {
  					boxShadow: '0 0 10px rgba(34, 197, 94, 0.4), 0 0 20px rgba(34, 197, 94, 0.2)',
  					transform: 'scale(1)'
  				},
  				'50%': {
  					boxShadow: '0 0 20px rgba(34, 197, 94, 0.6), 0 0 40px rgba(34, 197, 94, 0.4)',
  					transform: 'scale(1.02)'
  				}
  			},
  			'fade-in': {
  				'0%': {
  					opacity: '0'
  				},
  				'100%': {
  					opacity: '1'
  				}
  			},
  			'slide-up': {
  				'0%': {
  					transform: 'translateY(100%)',
  					opacity: '0'
  				},
  				'100%': {
  					transform: 'translateY(0)',
  					opacity: '1'
  				}
  			}
  		},
  		animation: {
  			shake: 'shake 0.4s ease-in-out',
  			'pulse-glow': 'pulse-glow 1.5s ease-in-out infinite',
  			'fade-in': 'fade-in 0.2s ease-out',
  			'slide-up': 'slide-up 0.3s ease-out'
  		}
  	}
  },
  plugins: [require("tailwindcss-animate")],
};
