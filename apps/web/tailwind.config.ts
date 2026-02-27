import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./src/pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        // Premium dark command-center palette
        surface: "#0A0A0B",
        panel: "#141417",
        border: "#1F1F23",
        muted: "#6B6B70",
        accent: "#FF5C00",
        positive: "#22C55E",
        negative: "#EF4444",
        caution: "#FF8A4C",
        neutral: "#ADADB0",
      },
      fontFamily: {
        mono: ["'DM Mono'", "ui-monospace", "SFMono-Regular", "monospace"],
        sans: ["'Inter'", "ui-sans-serif", "system-ui", "sans-serif"],
        serif: ["'Instrument Serif'", "ui-serif", "Georgia", "serif"],
        display: ["'Fraunces'", "Georgia", "serif"],
      },
    },
  },
  plugins: [],
};
export default config;
