/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  theme: {
    extend: {
      fontFamily: {
        mono: ["'JetBrains Mono'", "Consolas", "Monaco", "monospace"],
      },
      colors: {
        surface:  "#080b0f",
        panel:    "#0d1117",
        panel2:   "#111820",
        border:   "#1c2128",
        border2:  "#30363d",
        accent:   "#58a6ff",
        bull:     "#3fb950",
        bear:     "#f85149",
        gold:     "#d29922",
        extreme:  "#ff6b35",
        muted:    "#484f58",
        dim:      "#8b949e",
        bright:   "#e6edf3",
      },
      animation: {
        "pulse-dot": "pulse-dot 2s ease-in-out infinite",
        "flash-green": "flash-green 0.6s ease-out forwards",
        "flash-red": "flash-red 0.6s ease-out forwards",
        "slide-in": "slide-in 0.15s ease-out forwards",
      },
      keyframes: {
        "pulse-dot": {
          "0%, 100%": { opacity: "1" },
          "50%": { opacity: "0.2" },
        },
        "flash-green": {
          "0%": { backgroundColor: "rgba(63,185,80,0.25)" },
          "100%": { backgroundColor: "transparent" },
        },
        "flash-red": {
          "0%": { backgroundColor: "rgba(248,81,73,0.25)" },
          "100%": { backgroundColor: "transparent" },
        },
        "slide-in": {
          "0%": { transform: "translateY(-6px)", opacity: "0" },
          "100%": { transform: "translateY(0)", opacity: "1" },
        },
      },
    },
  },
  plugins: [],
};
