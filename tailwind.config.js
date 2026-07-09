/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ["./src/**/*.{html,js,ts}"],
  theme: {
    extend: {
      fontFamily: {
        manrope: ["Manrope", "system-ui", "sans-serif"],
      },
      colors: {
        primary: "#60a5fa",
        "text-primary": "#93c5fd",
        "primary-blue": "#3b82f6",
        "light-blue": "#1e3a5f",
        "gray-light": "#121a2b",
        "gray-border": "#243049",
        "gray-text": "#8b98b8",
        page: "#070a12",
        ink: "#eef3ff",
        muted: "#8b98b8",
      },
    },
  },
  plugins: [],
};
