/**
 * Descargador de Comprobantes SRI - Configuracion centralizada
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

  // Selectores CSS del DOM del portal SRI
  SELECTORES: {
    TABLA_RECIBIDOS: '#frmPrincipal\\:tablaCompRecibidos_data', // tbody de la tabla de comprobantes
    PAGINADOR: '.ui-paginator-current',                         // texto "(X of Y)" del paginador
    BOTON_SIGUIENTE: '.ui-paginator-next:not(.ui-state-disabled)', // boton siguiente pagina
    BOTON_PRIMERA: '.ui-paginator-first:not(.ui-state-disabled)',  // boton primera pagina
    LINK_XML: '[id$=":lnkXml"]',                                // links de descarga XML por fila
    LINK_PDF: '[id$=":lnkPdf"]',                                // links de descarga PDF por fila
    RUC_USUARIO: '.area-usuario-blue span',                     // RUC del usuario logueado en topbar
  },

  // Dominio para filtrar descargas
  DOMINIO_SRI: 'sri.gob.ec',

  // Organizacion de archivos descargados
  // Ruta fija: carpetaRaiz / [orden] / recibidos / tipoDoc / archivo.ext
  // Donde [orden] es 'ruc_fecha' (ruc/anio/mes) o 'fecha_ruc' (anio/mes/ruc)
  ORGANIZACION: {
    HABILITADO: false,
    CARPETA_RAIZ: 'descargas_sri',
    ORDEN: 'ruc_fecha',            // 'ruc_fecha' | 'fecha_ruc'
    FORMATO_NOMBRE: 'claveAcceso', // 'claveAcceso' | 'ruc_serie' | 'razon_serie'
  },
};

} // Fin guard SRI_CONFIG
