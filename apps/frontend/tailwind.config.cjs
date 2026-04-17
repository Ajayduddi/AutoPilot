/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    "./src/**/*.{js,jsx,ts,tsx}"
  ],
  theme: {
    extend: {
      fontFamily: {
        sans: ['"Inter"', 'ui-sans-serif', '-apple-system', 'BlinkMacSystemFont', 'system-ui', '"Segoe UI"', 'Roboto', '"Helvetica Neue"', 'Arial', 'sans-serif'],
      },
      colors: {
        neutral: {
          850: '#1f1f1f',
          900: '#171717'
        }
      }
    },
  },
  plugins: [],
}
