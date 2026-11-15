/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      colors: {
        void: {
          900: '#090B10',
          800: '#0C0F17',
          700: '#121622',
          600: '#181D2C',
        },
        saul: {
          gold: '#F5C518',
          amber: '#FFDB4D',
          crimson: '#C8102E',
          ember: '#FF3B57',
        },
      },
      fontFamily: {
        vazir: ['Vazirmatn', 'system-ui', 'sans-serif'],
      },
      boxShadow: {
        gold: '0 0 0 1px rgba(245,197,24,0.35), 0 18px 60px -22px rgba(245,197,24,0.55)',
        glass: '0 24px 80px -36px rgba(0,0,0,0.9), inset 0 1px 0 0 rgba(255,255,255,0.06)',
        crimson: '0 0 0 1px rgba(200,16,46,0.4), 0 18px 50px -24px rgba(200,16,46,0.7)',
      },
      keyframes: {
        drift: {
          '0%,100%': { transform: 'translate3d(0,0,0) scale(1)' },
          '50%': { transform: 'translate3d(-2%,3%,0) scale(1.06)' },
        },
        pulseGlow: {
          '0%,100%': { opacity: '0.55' },
          '50%': { opacity: '1' },
        },
        shimmer: {
          '0%': { backgroundPosition: '200% 0' },
          '100%': { backgroundPosition: '-200% 0' },
        },
        riseIn: {
          from: { opacity: '0', transform: 'translateY(14px)' },
          to: { opacity: '1', transform: 'translateY(0)' },
        },
      },
      animation: {
        drift: 'drift 26s ease-in-out infinite',
        'drift-slow': 'drift 40s ease-in-out infinite reverse',
        pulseGlow: 'pulseGlow 4s ease-in-out infinite',
        shimmer: 'shimmer 2.6s linear infinite',
        riseIn: 'riseIn 0.6s cubic-bezier(0.22,1,0.36,1) both',
      },
    },
  },
  plugins: [],
};
