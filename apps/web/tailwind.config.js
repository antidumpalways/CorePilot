/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        ink: {
          950: "#08090c",
          900: "#0b0d12",
          800: "#11141b",
          700: "#171b24",
          600: "#1f2530",
        },
        line: {
          DEFAULT: "#232a36",
          soft: "#1a202a",
        },
        accent: {
          DEFAULT: "#4c8dff",
          soft: "#1b2b4d",
          strong: "#2f6fe0",
        },
        long: "#22c55e",
        short: "#ef4444",
        warn: "#f59e0b",
        muted: "#8a93a6",
        paper: "#e6e9ef",
      },
      fontFamily: {
        sans: [
          "Inter",
          "ui-sans-serif",
          "system-ui",
          "-apple-system",
          "Segoe UI",
          "Roboto",
          "Helvetica Neue",
          "Arial",
          "sans-serif",
        ],
        mono: [
          "ui-monospace",
          "SFMono-Regular",
          "Menlo",
          "Consolas",
          "Liberation Mono",
          "monospace",
        ],
      },
      boxShadow: {
        panel: "0 1px 0 0 rgba(255,255,255,0.03) inset, 0 8px 24px -20px rgba(0,0,0,0.9)",
      },
    },
  },
  plugins: [],
};
