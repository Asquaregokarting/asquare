/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        // Asquare customer app colors
        primary: {
          50: '#e6f0ff',
          100: '#b3d1ff',
          200: '#80b3ff',
          300: '#4d94ff',
          400: '#1a75ff',
          500: '#0066FF',
          600: '#0052cc',
          700: '#003d99',
          800: '#002966',
          900: '#001433',
          DEFAULT: '#0066FF',
        },
        secondary: {
          50: '#fff5eb',
          100: '#ffe0c2',
          200: '#ffcc99',
          300: '#ffb870',
          400: '#ffa347',
          500: '#FF6B00',
          600: '#cc5600',
          700: '#994000',
          800: '#662b00',
          900: '#331500',
          DEFAULT: '#FF6B00',
        },
        dark: {
          50: '#f5f5f5',
          100: '#e0e0e0',
          200: '#b3b3b3',
          300: '#808080',
          400: '#4d4d4d',
          500: '#2a2a2a',
          600: '#1f1f1f',
          700: '#171717',
          800: '#0f0f0f',
          900: '#0a0a0a',
          950: '#050505',
        },
        // Status / accent colors (shared customer + pipeline)
        gold: {
          400: '#eab308',
          500: '#ca8a04',
        },
        success: {
          400: '#4ade80',
          500: '#22c55e',
          DEFAULT: '#22c55e',
        },
        // Scoped brand tints (Instagram red on influencer banner)
        instagram: {
          DEFAULT: '#E10600',
          700: '#c70500',
        },
        // Hero slideshow art palette (Activities page). Intentional design choice outside the brand palette.
        hero: {
          navy: '#001636',
          'purple-950': '#0F172A',
          'purple-900': '#1E1B4B',
          'purple-800': '#312E81',
        },
        // Portal module (Pipeline invite portal — red-themed, distinct from main pipeline teal)
        portal: {
          panel: '#15151E',
          surface: '#1E1E2A',
          muted: '#8A8A9A',
        },
        // Track/Karts module surfaces (kart deep clean, details)
        track: {
          panel: '#0F0F1A',
          surface: '#1A1A2E',
          'surface-alt': '#11162A',
          accent: '#FF6B35',
          'accent-soft': '#FF8F66',
          'accent-warm': '#FF8F35',
        },
        // Scanner / status signal palette (vivid scan feedback)
        signal: {
          'green-bright': '#00C853',
          'green-glow': '#7CFFB2',
          amber: '#FFB300',
          'red-hot': '#FF1744',
          'navy-deep': '#0a1628',
        },
        // Pipeline admin app colors (CSS custom properties)
        base: 'rgb(var(--color-base) / <alpha-value>)',
        panel: 'rgb(var(--color-panel) / <alpha-value>)',
        surface: 'rgb(var(--color-surface) / <alpha-value>)',
        text: 'rgb(var(--color-text) / <alpha-value>)',
        muted: 'rgb(var(--color-muted) / <alpha-value>)',
        border: 'rgb(var(--color-border) / <alpha-value>)',
        accent: 'rgb(var(--color-accent) / <alpha-value>)',
        success: 'rgb(var(--color-success) / <alpha-value>)',
        warning: 'rgb(var(--color-warning) / <alpha-value>)',
        critical: 'rgb(var(--color-critical) / <alpha-value>)',
        info: 'rgb(var(--color-info) / <alpha-value>)',
      },
      fontFamily: {
        sans: ['Inter', 'Space Grotesk', 'system-ui', 'sans-serif'],
        display: ['Outfit', 'Sora', 'system-ui', 'sans-serif'],
        mono: ['JetBrains Mono', 'ui-monospace', 'SFMono-Regular', 'monospace'],
      },
      boxShadow: {
        'glow-primary': '0 0 20px rgba(0, 102, 255, 0.5)',
        'glow-secondary': '0 0 20px rgba(255, 107, 0, 0.5)',
        glass: '0 8px 32px 0 rgba(0, 0, 0, 0.37)',
        card: '0 4px 20px rgba(0, 0, 0, 0.25)',
        panel: '0 18px 36px -26px rgba(15, 23, 42, 0.45)',
      },
      backgroundImage: {
        'gradient-radial': 'radial-gradient(var(--tw-gradient-stops))',
        'hero-glow':
          'conic-gradient(from 180deg at 50% 50%, #0066FF 0deg, #FF6B00 180deg, #0066FF 360deg)',
      },
      borderRadius: {
        '2xl-soft': '1.25rem',
      },
      animation: {
        'pulse-slow': 'pulse 4s cubic-bezier(0.4, 0, 0.6, 1) infinite',
        float: 'float 6s ease-in-out infinite',
        glow: 'glow 2s ease-in-out infinite alternate',
      },
      keyframes: {
        float: {
          '0%, 100%': { transform: 'translateY(0)' },
          '50%': { transform: 'translateY(-10px)' },
        },
        glow: {
          '0%': { boxShadow: '0 0 10px rgba(0, 102, 255, 0.2)' },
          '100%': { boxShadow: '0 0 20px rgba(0, 102, 255, 0.6), 0 0 10px rgba(0, 102, 255, 0.4)' },
        },
      },
      backdropBlur: {
        xs: '2px',
      },
    },
  },
  plugins: [],
}
