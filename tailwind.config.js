// Guía visual aprobada: formal, blanco y negro, sin azul. El color solo aparece en los semáforos.
/** @type {import('tailwindcss').Config} */
export default {
  content: ['./src/web/index.html', './src/web/**/*.{ts,tsx}'],
  theme: {
    extend: {
      fontFamily: { sans: ['Inter', 'system-ui', 'Segoe UI', 'Roboto', 'sans-serif'] },
      colors: {
        fondo: '#F4F4F1',
        tinta: { DEFAULT: '#0B0B0B', 2: '#3D3D3A', 3: '#5F5E5A' },
        linea: { DEFAULT: '#E1E0D9', fuerte: '#C3C2B7' },
        menu: { DEFAULT: '#0E0E0E', 2: '#1C1C1B', texto: '#B9B8B1' },
        // Semáforo (suaves; siempre acompañados de texto y símbolo)
        bueno: { fondo: '#E7F4E7', texto: '#0B5A0B', marca: '#0CA30C' },
        regular: { fondo: '#FFF3D6', texto: '#6B4A00', marca: '#FAB219' },
        malo: { fondo: '#FBE8E8', texto: '#9E2626', marca: '#D03B3B' },
      },
      borderRadius: { tarjeta: '12px' },
    },
  },
  plugins: [],
};
