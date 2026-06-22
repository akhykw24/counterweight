import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
    "./lib/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        // Calm, instrument-like palette. Warm accent for effort, cool for scrutiny.
        ink: "#1c1c1e",
        paper: "#fafaf8",
      },
    },
  },
  plugins: [],
};

export default config;
