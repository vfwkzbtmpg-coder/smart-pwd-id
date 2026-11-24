/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        brand: {
          50:  '#eef6ff',
          100: '#d9eaff',
          200: '#bdd6ff',
          300: '#8fb8ff',
          400: '#5a91ff',
          500: '#336cff',
          600: '#1d4df0',
          700: '#183dc8',
          800: '#1734a0',
          900: '#18317e',
        },
      },
      boxShadow: {
        card: '0 4px 20px -6px rgba(22, 43, 116, 0.15)',
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', '-apple-system', 'Segoe UI', 'Roboto', 'sans-serif'],
      },
    },
  },
  plugins: [],
};
