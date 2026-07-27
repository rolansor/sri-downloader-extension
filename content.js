/**
 * Descargador de Comprobantes SRI - Content Script
 * Extractor de datos del DOM del SRI. Solo lectura, no ejecuta descargas.
 * Se inyecta en paginas de srienlinea.sri.gob.ec via manifest content_scripts.
 */

// Evitar reinyeccion del script (puede ocurrir al recargar o navegar)
if (window.SRI_DOWNLOADER_LOADED) {
  // Ya cargado, ignorar reinyeccion
} else {
  window.SRI_DOWNLOADER_LOADED = true;

/**
 * Obtiene las filas de la tabla de comprobantes recibidos y extrae
 * los datos relevantes de cada documento.
 * @returns {Object} Objeto con array de documentos y total, o error si no hay tabla
 * @returns {Array<Object>} [].documentos - Lista de documentos encontrados
 * @returns {number} [].total - Cantidad total de documentos
 * @returns {string} [].error - Mensaje de error si no se encontro la tabla
 */
function obtenerFilasTabla() {
  const tabla = document.querySelector(SRI_CONFIG.SELECTORES.TABLA_RECIBIDOS);
  if (!tabla) {
    return { error: 'No se encontro la tabla de comprobantes. Asegurate de estar en la pagina correcta.' };
  }

  const filas = tabla.querySelectorAll('tr');
  const documentos = [];

  filas.forEach((fila, index) => {
    const celdas = fila.querySelectorAll('td');
    if (celdas.length >= 6) {
      const linkXml = fila.querySelector(SRI_CONFIG.SELECTORES.LINK_XML);
      const linkPdf = fila.querySelector(SRI_CONFIG.SELECTORES.LINK_PDF);

      documentos.push({
        index: index,            // Indice de la fila en la tabla
        nro: celdas[0]?.textContent?.trim() || '',        // Numero de fila
        ruc: celdas[1]?.textContent?.trim().split('\n')[0] || '',  // RUC del emisor
        tipoYSerie: celdas[2]?.textContent?.trim() || '', // Tipo + serie (ej: "Factura 001-001-000123")
        claveAcceso: celdas[3]?.textContent?.trim() || '', // Clave de acceso (identificador unico)
        fecha: celdas[5]?.textContent?.trim() || '',       // Fecha de emision
        tieneXml: !!linkXml,     // Si tiene link de descarga XML
        tienePdf: !!linkPdf,     // Si tiene link de descarga PDF
        linkXmlId: linkXml?.id,  // ID del elemento HTML del link XML
        linkPdfId: linkPdf?.id,  // ID del elemento HTML del link PDF
      });
    }
  });

  return { documentos, total: documentos.length };
}

/**
 * Obtiene la informacion de paginacion del componente PrimeFaces.
 * Busca el texto "(X of Y)" en el paginador para extraer pagina actual y total.
 * @returns {Object} Objeto con pagina actual y total de paginas
 * @returns {number} [].actual - Numero de pagina actual
 * @returns {number} [].total - Total de paginas
 */
function obtenerPaginacion() {
  const paginador = document.querySelector(SRI_CONFIG.SELECTORES.PAGINADOR);
  if (!paginador) {
    return { actual: 1, total: 1 };
  }

  const match = paginador.textContent.match(/\((\d+) of (\d+)\)/);
  if (match) {
    return {
      actual: parseInt(match[1]),
      total: parseInt(match[2])
    };
  }

  return { actual: 1, total: 1 };
}

/**
 * Listener de mensajes del popup.
 * Responde a la accion 'obtenerDocumentos' extrayendo datos de la tabla y paginacion.
 */
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'obtenerDocumentos') {
    const datos = obtenerFilasTabla();
    const paginacion = obtenerPaginacion();
    sendResponse({ ...datos, paginacion });
  } else {
    sendResponse({ error: 'Accion no reconocida' });
  }
  return false;
});

} // Fin del bloque if (!window.SRI_DOWNLOADER_LOADED)
