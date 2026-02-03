/**
 * SRI Document Downloader - Content Script
 * Extractor de datos del DOM del SRI. Solo lectura, no ejecuta descargas.
 */

// Evitar reinyeccion del script
if (window.SRI_DOWNLOADER_LOADED) {
  console.log('[SRI Downloader] Script ya cargado, ignorando reinyeccion');
} else {
  window.SRI_DOWNLOADER_LOADED = true;

/**
 * Obtiene las filas de la tabla de documentos
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
        index: index,
        nro: celdas[0]?.textContent?.trim() || '',
        ruc: celdas[1]?.textContent?.trim().split('\n')[0] || '',
        tipoYSerie: celdas[2]?.textContent?.trim() || '',
        fecha: celdas[5]?.textContent?.trim() || '',
        tieneXml: !!linkXml,
        tienePdf: !!linkPdf,
        linkXmlId: linkXml?.id,
        linkPdfId: linkPdf?.id,
      });
    }
  });

  return { documentos, total: documentos.length };
}

/**
 * Obtiene informacion de paginacion
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

// Escuchar mensajes del popup
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

console.log('[SRI Downloader] Content script cargado');

} // Fin del bloque if (!window.SRI_DOWNLOADER_LOADED)
