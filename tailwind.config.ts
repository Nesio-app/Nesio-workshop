import type { Config } from 'tailwindcss';

const config: Config = {
  content: [
    './app/**/*.{js,ts,jsx,tsx,mdx}',
    './components/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      colors: {
        cream: '#F7F5F0',
        beige: '#E8E4DC',
        'beige-dark': '#D4CFC4',
        charcoal: '#2C2C2C',
        'charcoal-light': '#4A4A4A',
        'dusty-pink': '#C9A9A6',
        'dusty-pink-light': '#E5D4D2',
        'dusty-pink-dark': '#A67F7C',
        'fidelity-blue': '#005293',
        // CFA — professional & motivating
        cfa: {
          green: '#2D6A4F',
          'green-light': '#40916C',
          gold: '#B8860B',
          'gold-light': '#D4A84B',
          navy: '#1B4965',
          'navy-light': '#5FA8D3',
        },
        // AI Dictionary — bright & fun
        dict: {
          coral: '#FF6B6B',
          sunny: '#FFE66D',
          mint: '#4ECDC4',
          sky: '#45B7D1',
          lavender: '#A78BFA',
          peach: '#FFAB91',
          ink: '#1A1A2E',
          snow: '#FAFAFA',
        },
      },
      fontFamily: {
        serif: ['var(--font-portal-serif)', 'var(--font-playfair)', 'Georgia', 'serif'],
        sans: ['var(--font-source-sans)', 'system-ui', 'sans-serif'],
        portal: ['var(--font-portal-serif)', 'Georgia', 'serif'],
        'dict-fun': ['var(--font-dict-fun)', 'sans-serif'],
        'dict-sans': ['var(--font-dict-sans)', 'sans-serif'],
      },
      animation: {
        'fade-in': 'fadeIn 0.8s ease-out forwards',
      },
      keyframes: {
        fadeIn: {
          '0%': { opacity: '0', transform: 'translateY(12px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
      },
    },
  },
  plugins: [],
};

export default config;
