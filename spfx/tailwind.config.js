/** @type {import('tailwindcss').Config} */
module.exports = {
  // Escopo fechado rigoroso: todas as classes utilitárias ficam restritas ao container raiz
  important: '.elb-container',
  content: [
    './src/**/*.{ts,tsx,html,js}',
    '../*.{html,js}'
  ],
  corePlugins: {
    // DESATIVADO: Impede o reset de estilos no body, html e menus do SharePoint Online
    preflight: false
  },
  theme: {
    extend: {
      colors: {
        dhlRed: '#D40511',
        dhlYellow: '#FFCC00',
        dhlDark: '#1E293B',
        dhlBlue: '#003DA5'
      }
    }
  },
  plugins: []
};
