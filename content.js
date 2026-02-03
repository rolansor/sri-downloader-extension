/**
 * SRI Document Downloader - Content Script
 * Se ejecuta en las páginas del SRI para extraer y descargar documentos
 */

// Evitar reinyección del script
if (window.SRI_DOWNLOADER_LOADED) {
  console.log('[SRI Downloader] Script ya cargado, ignorando reinyección');
} else {
  window.SRI_DOWNLOADER_LOADED = true;

// Configuración
const CONFIG = {
  DELAY_DESCARGA: 300,  // ms entre descargas
  DELAY_PAGINA: 1500,   // ms esperar después de cambiar página
  MAX_DOCUMENTOS: 500,  // máximo por sesión
};

// Variable global para detener descargas
let detenerDescarga = false;

// Selectores para la tabla de comprobantes recibidos
const SELECTORES = {
  TABLA_RECIBIDOS: '#frmPrincipal\\:tablaCompRecibidos_data',
  PAGINADOR: '.ui-paginator-current',
  BOTON_SIGUIENTE: '.ui-paginator-next:not(.ui-state-disabled)',
};

/**
 * Ejecuta la descarga a través del background service
 * Usa world: 'MAIN' para ejecutar mojarra.jsfcljs directamente
 * Incluye timeout para evitar bloqueos
 */
async function ejecutarDescargaViaBg(linkId) {
  return new Promise((resolve) => {
    // Timeout de seguridad - 5 segundos
    const timeout = setTimeout(() => {
      console.warn('[SRI Downloader] Timeout en descarga:', linkId);
      resolve(false);
    }, 5000);

    chrome.runtime.sendMessage({
      action: 'ejecutarDescarga',
      linkId: linkId
    }, (response) => {
      clearTimeout(timeout);
      if (chrome.runtime.lastError) {
        console.warn('[SRI Downloader] Error comunicación:', chrome.runtime.lastError.message);
        // Intentar de nuevo con un pequeño delay
        resolve(false);
      } else {
        resolve(response?.success ?? true);
      }
    });
  });
}

/**
 * Obtiene las filas de la tabla de documentos
 */
function obtenerFilasTabla() {
  const tabla = document.querySelector(SELECTORES.TABLA_RECIBIDOS);
  if (!tabla) {
    return { error: 'No se encontró la tabla de comprobantes. Asegúrate de estar en la página correcta.' };
  }

  const filas = tabla.querySelectorAll('tr');
  const documentos = [];

  filas.forEach((fila, index) => {
    const celdas = fila.querySelectorAll('td');
    if (celdas.length >= 6) {
      const nro = celdas[0]?.textContent?.trim();
      const ruc = celdas[1]?.textContent?.trim().split('\n')[0];
      const tipoYSerie = celdas[2]?.textContent?.trim();
      const fecha = celdas[5]?.textContent?.trim();

      // Verificar si tiene links de descarga
      const linkXml = fila.querySelector('[id$=":lnkXml"]');
      const linkPdf = fila.querySelector('[id$=":lnkPdf"]');

      documentos.push({
        index: index,
        nro: nro,
        ruc: ruc,
        tipoYSerie: tipoYSerie,
        fecha: fecha,
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
 * Descarga un archivo individual ejecutando mojarra.jsfcljs
 * Espera confirmación de que la descarga se inició antes de continuar
 */
async function descargarArchivo(linkId) {
  console.log('[SRI Downloader] Descargando:', linkId);
  const exito = await ejecutarDescargaViaBg(linkId);

  if (exito) {
    console.log('[SRI Downloader] Descarga confirmada:', linkId);
  } else {
    console.warn('[SRI Downloader] Descarga posiblemente fallida:', linkId);
  }

  // Pequeño delay adicional para evitar saturar
  await new Promise(r => setTimeout(r, CONFIG.DELAY_DESCARGA));
  return exito;
}

/**
 * Descarga múltiples documentos
 */
async function descargarDocumentos(indices, tipoDescarga) {
  const resultado = {
    exitosos: 0,
    fallidos: 0,
    detalles: []
  };

  const datos = obtenerFilasTabla();
  if (datos.error) {
    return { error: datos.error };
  }

  for (const idx of indices) {
    const doc = datos.documentos.find(d => d.index === idx);
    if (!doc) continue;

    let exitoXml = true;
    let exitoPdf = true;

    // Descargar XML
    if ((tipoDescarga === 'xml' || tipoDescarga === 'ambos') && doc.tieneXml) {
      exitoXml = await descargarArchivo(doc.linkXmlId);
    }

    // Descargar PDF
    if ((tipoDescarga === 'pdf' || tipoDescarga === 'ambos') && doc.tienePdf) {
      exitoPdf = await descargarArchivo(doc.linkPdfId);
    }

    const exito = exitoXml && exitoPdf;
    if (exito) {
      resultado.exitosos++;
    } else {
      resultado.fallidos++;
    }

    resultado.detalles.push({
      nro: doc.nro,
      tipoYSerie: doc.tipoYSerie,
      exito: exito
    });

    // Enviar progreso
    chrome.runtime.sendMessage({
      action: 'progreso',
      actual: resultado.exitosos + resultado.fallidos,
      total: indices.length
    }).catch(() => {});
  }

  return resultado;
}

/**
 * Obtiene información de paginación
 */
function obtenerPaginacion() {
  const paginador = document.querySelector(SELECTORES.PAGINADOR);
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
 * Navega a la siguiente página
 */
function navegarSiguiente() {
  const boton = document.querySelector(SELECTORES.BOTON_SIGUIENTE);
  if (boton) {
    boton.click();
    return true;
  }
  return false;
}

/**
 * Navega a la primera página
 */
function navegarPrimera() {
  const boton = document.querySelector('.ui-paginator-first:not(.ui-state-disabled)');
  if (boton) {
    boton.click();
    return true;
  }
  return false;
}

/**
 * Espera a que la tabla se actualice después de cambiar de página
 */
function esperarCargaTabla() {
  return new Promise((resolve) => {
    setTimeout(resolve, CONFIG.DELAY_PAGINA);
  });
}

/**
 * Descarga TODOS los documentos de TODAS las páginas automáticamente
 */
async function descargarTodasLasPaginas(tipoDescarga) {
  const resultado = {
    exitosos: 0,
    fallidos: 0,
    paginasProcesadas: 0,
    detalles: []
  };

  // Ir a la primera página
  const paginacionInicial = obtenerPaginacion();
  if (paginacionInicial.actual > 1) {
    console.log('[SRI Downloader] Navegando a primera página...');
    navegarPrimera();
    await esperarCargaTabla();
  }

  let continuar = true;

  while (continuar) {
    const paginacion = obtenerPaginacion();
    console.log(`[SRI Downloader] Procesando página ${paginacion.actual} de ${paginacion.total}`);

    // Obtener documentos de la página actual
    const datos = obtenerFilasTabla();
    if (datos.error) {
      console.error('[SRI Downloader] Error:', datos.error);
      break;
    }

    // Descargar todos los documentos de esta página
    for (const doc of datos.documentos) {
      // Verificar si se solicitó detener
      if (detenerDescarga) {
        console.log('[SRI Downloader] Descarga detenida por el usuario');
        resultado.detenido = true;
        return resultado;
      }

      try {
        let exitoXml = true;
        let exitoPdf = true;

        // Descargar XML
        if ((tipoDescarga === 'xml' || tipoDescarga === 'ambos') && doc.tieneXml) {
          exitoXml = await descargarArchivo(doc.linkXmlId);
        }

        // Descargar PDF
        if ((tipoDescarga === 'pdf' || tipoDescarga === 'ambos') && doc.tienePdf) {
          exitoPdf = await descargarArchivo(doc.linkPdfId);
        }

        const exito = exitoXml && exitoPdf;
        if (exito) {
          resultado.exitosos++;
        } else {
          resultado.fallidos++;
        }

        resultado.detalles.push({
          pagina: paginacion.actual,
          nro: doc.nro,
          tipoYSerie: doc.tipoYSerie,
          exito: exito
        });

      } catch (err) {
        console.error('[SRI Downloader] Error en documento:', doc.nro, err);
        resultado.fallidos++;
        resultado.detalles.push({
          pagina: paginacion.actual,
          nro: doc.nro,
          tipoYSerie: doc.tipoYSerie,
          exito: false,
          error: err.message
        });
      }

      // Enviar progreso (fuera del try para que siempre se envíe)
      chrome.runtime.sendMessage({
        action: 'progreso',
        actual: resultado.exitosos + resultado.fallidos,
        pagina: paginacion.actual,
        totalPaginas: paginacion.total
      }).catch(() => {});
    }

    resultado.paginasProcesadas++;

    // ¿Hay más páginas?
    const paginacionActual = obtenerPaginacion();
    if (paginacionActual.actual < paginacionActual.total) {
      console.log('[SRI Downloader] Navegando a siguiente página...');
      navegarSiguiente();
      await esperarCargaTabla();
    } else {
      console.log('[SRI Downloader] ¡Todas las páginas procesadas!');
      continuar = false;
    }
  }

  return resultado;
}

// Escuchar mensajes del popup
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  console.log('Content script recibió mensaje:', request);

  switch (request.action) {
    case 'obtenerDocumentos':
      const datos = obtenerFilasTabla();
      const paginacion = obtenerPaginacion();
      sendResponse({ ...datos, paginacion });
      break;

    case 'descargarSeleccionados':
      descargarDocumentos(request.indices, request.tipoDescarga)
        .then(resultado => {
          chrome.runtime.sendMessage({
            action: 'descargaCompleta',
            resultado: resultado
          });
        });
      sendResponse({ status: 'iniciado' });
      break;

    case 'descargarTodos':
      const todosLosDatos = obtenerFilasTabla();
      if (todosLosDatos.error) {
        sendResponse({ error: todosLosDatos.error });
      } else {
        const todosLosIndices = todosLosDatos.documentos.map(d => d.index);
        descargarDocumentos(todosLosIndices, request.tipoDescarga)
          .then(resultado => {
            chrome.runtime.sendMessage({
              action: 'descargaCompleta',
              resultado: resultado
            });
          });
        sendResponse({ status: 'iniciado', total: todosLosIndices.length });
      }
      break;

    case 'navegarSiguiente':
      const exito = navegarSiguiente();
      sendResponse({ exito });
      break;

    case 'descargarTodasLasPaginas':
      detenerDescarga = false;
      descargarTodasLasPaginas(request.tipoDescarga)
        .then(resultado => {
          chrome.runtime.sendMessage({
            action: 'descargaCompleta',
            resultado: resultado
          });
        });
      sendResponse({ status: 'iniciado' });
      break;

    case 'detenerDescarga':
      detenerDescarga = true;
      console.log('[SRI Downloader] Deteniendo descarga...');
      sendResponse({ status: 'detenido' });
      break;

    default:
      sendResponse({ error: 'Acción no reconocida' });
  }

  return true; // Mantener el canal abierto para respuestas asíncronas
});

// Indicar que el content script está listo
console.log('SRI Document Downloader: Content script cargado');

} // Fin del bloque if (!window.SRI_DOWNLOADER_LOADED)
