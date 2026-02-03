/**
 * SRI Document Downloader - Configuracion centralizada
 * Compartido entre background.js y content.js
 */

if (typeof SRI_CONFIG !== 'undefined') {
  // Ya cargado, no redeclarar
} else {

var SRI_CONFIG = {
  // Delays
  DELAY_DESCARGA: 300,       // ms entre descargas individuales
  DELAY_PAGINA: 1500,        // ms minimo al cambiar de pagina (fallback)
  DELAY_REINTENTO: 1000,     // ms entre reintentos de descarga fallida
  TIMEOUT_DESCARGA: 5000,    // ms maximo esperando confirmacion de descarga
  TIMEOUT_PAGINA: 10000,     // ms maximo esperando cambio de pagina

  // Reintentos
  MAX_REINTENTOS: 2,         // reintentos por descarga fallida

  // Historial
  DIAS_HISTORIAL: 30,        // dias antes de limpiar historial automaticamente

  // Selectores del SRI
  SELECTORES: {
    TABLA_RECIBIDOS: '#frmPrincipal\\:tablaCompRecibidos_data',
    PAGINADOR: '.ui-paginator-current',
    BOTON_SIGUIENTE: '.ui-paginator-next:not(.ui-state-disabled)',
    BOTON_PRIMERA: '.ui-paginator-first:not(.ui-state-disabled)',
    LINK_XML: '[id$=":lnkXml"]',
    LINK_PDF: '[id$=":lnkPdf"]',
    RUC_USUARIO: '.ui-menuitem-text',
  },

  // Dominio para filtrar descargas
  DOMINIO_SRI: 'sri.gob.ec',
};

} // Fin guard SRI_CONFIG
