import defaultTheme from 'tailwindcss/defaultTheme';

/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        // Surface hierarchy (tonal architecture)
        'surface': '#10131a',
        'surface-dim': '#10131a',
        'surface-bright': '#363940',
        'surface-container-lowest': '#0b0e14',
        'surface-container-low': '#191c22',
        'surface-container': '#1d2026',
        'surface-container-high': '#272a31',
        'surface-container-highest': '#32353c',
        'surface-variant': '#32353c',
        'surface-tint': '#aec6ff',

        // Primary
        'primary': '#aec6ff',
        'primary-container': '#508eff',
        'primary-fixed': '#d8e2ff',
        'primary-fixed-dim': '#aec6ff',
        'on-primary': '#002e6b',
        'on-primary-container': '#00275e',
        'on-primary-fixed': '#001a43',
        'on-primary-fixed-variant': '#004397',
        'inverse-primary': '#005ac5',

        // Secondary
        'secondary': '#bec7db',
        'secondary-container': '#40495a',
        'secondary-fixed': '#dae3f8',
        'secondary-fixed-dim': '#bec7db',
        'on-secondary': '#283141',
        'on-secondary-container': '#afb9cd',
        'on-secondary-fixed': '#131c2b',
        'on-secondary-fixed-variant': '#3e4758',

        // Tertiary (success/live)
        'tertiary': '#4edea3',
        'tertiary-container': '#00a572',
        'tertiary-fixed': '#6ffbbe',
        'tertiary-fixed-dim': '#4edea3',
        'on-tertiary': '#003824',
        'on-tertiary-container': '#00311f',
        'on-tertiary-fixed': '#002113',
        'on-tertiary-fixed-variant': '#005236',

        // Error
        'error': '#ffb4ab',
        'error-container': '#93000a',
        'on-error': '#690005',
        'on-error-container': '#ffdad6',

        // Neutrals
        'on-surface': '#e1e2eb',
        'on-surface-variant': '#c2c6d6',
        'on-background': '#e1e2eb',
        'background': '#10131a',
        'outline': '#8c909f',
        'outline-variant': '#424754',
        'inverse-surface': '#e1e2eb',
        'inverse-on-surface': '#2e3037',
      },
      fontFamily: {
        sans: ['Inter Variable', 'Inter', ...defaultTheme.fontFamily.sans],
      },
      boxShadow: {
        'ambient-sm': '0 4px 16px rgba(0, 0, 0, 0.12)',
        'ambient-md': '0 8px 32px rgba(0, 0, 0, 0.12)',
        'ambient-lg': '0 16px 64px rgba(0, 0, 0, 0.12)',
        'glow-primary': '0 8px 32px rgba(174, 198, 255, 0.15)',
        'glow-error': '0 8px 32px rgba(255, 180, 171, 0.15)',
        'glow-tertiary': '0 8px 32px rgba(78, 222, 163, 0.15)',
      },
    },
  },
  plugins: [],
}
