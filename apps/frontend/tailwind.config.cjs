/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    "./src/**/*.{js,jsx,ts,tsx}"
  ],
  theme: {
    extend: {
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
