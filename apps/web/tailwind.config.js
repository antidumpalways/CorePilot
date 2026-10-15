/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        ink: {
          950: "#07080b",
          900: "#0b0d12",
          800: "#11141b",
          700: "#151923",
          600: "#1a1f2b",
        },
        line: {
          DEFAULT: "#31394a",
          soft: "#222a38",
        },
        accent: {
          DEFAULT: "#688bff",
          soft: "#1b2d59",
          strong: "#8aa6ff",
        },
        long: "#22c55e",
        short: "#ef4444",
        warn: "#f59e0b",
        muted: "#9ba6b9",
        paper: "#f6f8ff",
      },
      fontFamily: {
        sans: [
          "Manrope",
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
        panel: "0 1px 0 rgba(255,255,255,.06) inset, 0 20px 50px -24px rgba(0,0,0,.7), 0 0 55px -45px rgba(104,139,255,.45)",
      },
    },
  },
  plugins: [],
};
