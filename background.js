/**
 * SRI Document Downloader - Background Service Worker
 * Maneja la descarga de forma persistente (no se detiene al cerrar popup)
 * Guarda historial en chrome.storage.local
 * Verifica descargas reales con chrome.downloads API
 */

// Estado global de descarga
let estadoDescarga = {
  activo: false,
  detenido: false,
  exitosos: 0,
  fallidos: 0,
  omitidos: 0,
  paginaActual: 0,
  totalPaginas: 0,
  documentoActual: 0,
  totalDocumentos: 0,
  tipoDescarga: 'xml',
  tabId: null,
  sesionId: null
};

// Cola de resolvers esperando confirmación de descarga
let resolverDescarga = null;

// Listener para detectar nuevas descargas - resuelve la promesa pendiente
chrome.downloads.onCreated.addListener((downloadItem) => {
  console.log('[SRI Background] Descarga detectada:', downloadItem.filename || downloadItem.url?.substring(0, 50));
  if (resolverDescarga) {
    resolverDescarga(true);
    resolverDescarga = null;
  }
});

/**
 * Genera un ID único para la sesión de descarga
 */
function generarSesionId() {
  return `sesion_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}

// Buffer en memoria para la sesión actual
let bufferSesion = {
  documentos: [],
  rucUsuario: null
};

/**
 * Agrega un documento al buffer en memoria (no escribe a storage)
 */
function agregarAlBuffer(registro) {
  bufferSesion.documentos.push(registro);
}

/**
 * Guarda todo el buffer al storage al finalizar la descarga
 */
async function guardarBufferAlStorage() {
  if (bufferSesion.documentos.length === 0) return;

  try {
    const data = await chrome.storage.local.get(['historialDescargas']);
    const historial = data.historialDescargas || {};

    const ruc = bufferSesion.rucUsuario || 'sin_ruc';
    if (!historial[ruc]) {
      historial[ruc] = {
        sesiones: {},
        ultimaActualizacion: null
      };
    }

    const sesionId = estadoDescarga.sesionId;
    const exitosos = bufferSesion.documentos.filter(d => d.exito).length;
    const fallidos = bufferSesion.documentos.filter(d => !d.exito).length;

    historial[ruc].sesiones[sesionId] = {
      fecha: new Date().toISOString(),
      tipoDescarga: estadoDescarga.tipoDescarga,
      documentos: bufferSesion.documentos,
      resumen: {
        exitosos: exitosos,
        fallidos: fallidos,
        total: bufferSesion.documentos.length
      }
    };

    historial[ruc].ultimaActualizacion = new Date().toISOString();

    await chrome.storage.local.set({ historialDescargas: historial });
    console.log(`[SRI Background] Historial guardado: ${exitosos} exitosos, ${fallidos} fallidos`);

    // Limpiar buffer
    bufferSesion = { documentos: [], rucUsuario: null };

  } catch (e) {
    console.error('[SRI Background] Error guardando historial:', e);
  }
}

/**
 * Obtiene el historial de descargas
 */
async function obtenerHistorial(ruc = null) {
  try {
    const data = await chrome.storage.local.get(['historialDescargas']);
    const historial = data.historialDescargas || {};

    if (ruc) {
      return historial[ruc] || null;
    }
    return historial;
  } catch (e) {
    console.error('[SRI Background] Error obteniendo historial:', e);
    return null;
  }
}

/**
 * Verifica si un documento ya fue descargado exitosamente
 */
async function documentoYaDescargado(claveAcceso, tipoDescarga) {
  try {
    const data = await chrome.storage.local.get(['historialDescargas']);
    const historial = data.historialDescargas || {};

    for (const ruc in historial) {
      for (const sesionId in historial[ruc].sesiones) {
        const sesion = historial[ruc].sesiones[sesionId];
        const doc = sesion.documentos.find(d => d.claveAcceso === claveAcceso);

        if (doc && doc.exito) {
          // Verificar si el tipo de descarga coincide
          if (tipoDescarga === 'xml' && doc.exitoXml) return true;
          if (tipoDescarga === 'pdf' && doc.exitoPdf) return true;
          if (tipoDescarga === 'ambos' && doc.exitoXml && doc.exitoPdf) return true;
        }
      }
    }
    return false;
  } catch (e) {
    console.error('[SRI Background] Error verificando historial:', e);
    return false;
  }
}

/**
 * Limpia historial antiguo (más de 30 días)
 */
async function limpiarHistorialAntiguo() {
  try {
    const data = await chrome.storage.local.get(['historialDescargas']);
    const historial = data.historialDescargas || {};
    const limite = Date.now() - (30 * 24 * 60 * 60 * 1000); // 30 días

    for (const ruc in historial) {
      for (const sesionId in historial[ruc].sesiones) {
        const fecha = new Date(historial[ruc].sesiones[sesionId].fecha).getTime();
        if (fecha < limite) {
          delete historial[ruc].sesiones[sesionId];
        }
      }
      // Eliminar RUC si no tiene sesiones
      if (Object.keys(historial[ruc].sesiones).length === 0) {
        delete historial[ruc];
      }
    }

    await chrome.storage.local.set({ historialDescargas: historial });
  } catch (e) {
    console.error('[SRI Background] Error limpiando historial:', e);
  }
}

/**
 * Ejecuta mojarra.jsfcljs y espera confirmación de descarga (secuencial)
 */
function ejecutarDescargaSRI(tabId, linkId) {
  return new Promise((resolve) => {
    // Timeout de seguridad - si no hay descarga en 5 seg, marcar fallido
    const timeout = setTimeout(() => {
      console.warn('[SRI Background] Timeout esperando descarga:', linkId);
      resolverDescarga = null;
      resolve(false);
    }, 5000);

    // Preparar para recibir confirmación del listener
    resolverDescarga = (exito) => {
      clearTimeout(timeout);
      resolve(exito);
    };

    // Ejecutar el script
    chrome.scripting.executeScript({
      target: { tabId: tabId },
      world: 'MAIN',
      func: (linkId) => {
        try {
          console.log('[SRI Downloader] Ejecutando mojarra para:', linkId);
          mojarra.jsfcljs(
            document.getElementById('frmPrincipal'),
            { [linkId]: linkId },
            ''
          );
          return { success: true };
        } catch (e) {
          console.error('[SRI Downloader] Error:', e);
          return { success: false, error: e.message };
        }
      },
      args: [linkId]
    }).then((resultado) => {
      const ejecutoOk = resultado[0]?.result?.success ?? false;
      if (!ejecutoOk) {
        clearTimeout(timeout);
        resolverDescarga = null;
        resolve(false);
      }
      // Si ejecutó OK, esperamos al listener onCreated o al timeout
    }).catch((e) => {
      console.error('[SRI Background] Error executeScript:', e);
      clearTimeout(timeout);
      resolverDescarga = null;
      resolve(false);
    });
  });
}

/**
 * Obtiene datos de la página actual
 */
async function obtenerDatosPagina(tabId) {
  try {
    const resultado = await chrome.scripting.executeScript({
      target: { tabId: tabId },
      func: () => {
        const SELECTOR_TABLA = '#frmPrincipal\\:tablaCompRecibidos_data';
        const tabla = document.querySelector(SELECTOR_TABLA);
        if (!tabla) return { error: 'No se encontró la tabla' };

        const filas = tabla.querySelectorAll('tr');
        const documentos = [];

        filas.forEach((fila, index) => {
          const celdas = fila.querySelectorAll('td');
          if (celdas.length >= 6) {
            const linkXml = fila.querySelector('[id$=":lnkXml"]');
            const linkPdf = fila.querySelector('[id$=":lnkPdf"]');

            // Extraer información del documento
            const ruc = celdas[1]?.textContent?.trim().split('\n')[0] || '';
            const razonSocial = celdas[1]?.textContent?.trim().split('\n')[1] || '';
            const tipoDoc = celdas[2]?.textContent?.trim().split('\n')[0] || '';
            const serie = celdas[2]?.textContent?.trim().split('\n')[1] || '';
            const claveAcceso = celdas[3]?.textContent?.trim() || '';
            const fechaEmision = celdas[4]?.textContent?.trim() || '';
            const fechaAutorizacion = celdas[5]?.textContent?.trim() || '';

            documentos.push({
              index: index,
              ruc: ruc,
              razonSocial: razonSocial,
              tipoDoc: tipoDoc,
              serie: serie,
              claveAcceso: claveAcceso,
              fechaEmision: fechaEmision,
              fechaAutorizacion: fechaAutorizacion,
              tieneXml: !!linkXml,
              tienePdf: !!linkPdf,
              linkXmlId: linkXml?.id,
              linkPdfId: linkPdf?.id,
            });
          }
        });

        // Paginación
        const paginador = document.querySelector('.ui-paginator-current');
        let paginacion = { actual: 1, total: 1 };
        if (paginador) {
          const match = paginador.textContent.match(/\((\d+) of (\d+)\)/);
          if (match) {
            paginacion = { actual: parseInt(match[1]), total: parseInt(match[2]) };
          }
        }

        // RUC del usuario (de la sesión)
        const rucUsuario = document.querySelector('.ui-menuitem-text')?.textContent?.match(/\d{13}/)?.[0] || 'desconocido';

        return { documentos, paginacion, rucUsuario };
      }
    });
    return resultado[0]?.result;
  } catch (e) {
    console.error('[SRI Background] Error obteniendo datos:', e);
    return { error: e.message };
  }
}

/**
 * Navega a la primera página
 */
async function navegarPrimera(tabId) {
  try {
    await chrome.scripting.executeScript({
      target: { tabId: tabId },
      func: () => {
        const boton = document.querySelector('.ui-paginator-first:not(.ui-state-disabled)');
        if (boton) boton.click();
      }
    });
    return true;
  } catch (e) {
    return false;
  }
}

/**
 * Navega a la siguiente página
 */
async function navegarSiguiente(tabId) {
  try {
    const resultado = await chrome.scripting.executeScript({
      target: { tabId: tabId },
      func: () => {
        const boton = document.querySelector('.ui-paginator-next:not(.ui-state-disabled)');
        if (boton) {
          boton.click();
          return true;
        }
        return false;
      }
    });
    return resultado[0]?.result ?? false;
  } catch (e) {
    return false;
  }
}

/**
 * Espera un tiempo
 */
function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Notifica el progreso al popup (si está abierto)
 */
function notificarProgreso() {
  chrome.runtime.sendMessage({
    action: 'estadoDescarga',
    estado: { ...estadoDescarga }
  }).catch(() => {}); // Ignorar si popup cerrado
}

/**
 * Proceso principal de descarga de todas las páginas
 */
async function descargarTodasLasPaginas(tabId, tipoDescarga) {
  // Limpiar historial antiguo al iniciar (en background, no bloquea)
  limpiarHistorialAntiguo();

  const sesionId = generarSesionId();

  // Reiniciar buffer
  bufferSesion = { documentos: [], rucUsuario: null };

  estadoDescarga = {
    activo: true,
    detenido: false,
    exitosos: 0,
    fallidos: 0,
    paginaActual: 1,
    totalPaginas: 1,
    documentoActual: 0,
    totalDocumentos: 0,
    tipoDescarga: tipoDescarga,
    tabId: tabId,
    sesionId: sesionId,
    rucUsuario: null
  };

  notificarProgreso();

  // Obtener info inicial
  let datos = await obtenerDatosPagina(tabId);
  if (datos.error) {
    estadoDescarga.activo = false;
    estadoDescarga.error = datos.error;
    notificarProgreso();
    return;
  }

  estadoDescarga.totalPaginas = datos.paginacion.total;
  estadoDescarga.rucUsuario = datos.rucUsuario;
  bufferSesion.rucUsuario = datos.rucUsuario;

  // Ir a primera página si no estamos en ella
  if (datos.paginacion.actual > 1) {
    console.log('[SRI Background] Navegando a primera página...');
    await navegarPrimera(tabId);
    await delay(1500);
    datos = await obtenerDatosPagina(tabId);
  }

  // Procesar todas las páginas
  for (let pag = 1; pag <= estadoDescarga.totalPaginas; pag++) {
    if (estadoDescarga.detenido) {
      console.log('[SRI Background] Descarga detenida por usuario');
      break;
    }

    estadoDescarga.paginaActual = pag;
    console.log(`[SRI Background] Procesando página ${pag} de ${estadoDescarga.totalPaginas}`);

    // Obtener documentos de página actual
    datos = await obtenerDatosPagina(tabId);
    if (datos.error) {
      console.error('[SRI Background] Error:', datos.error);
      break;
    }

    // Descargar documentos de esta página
    for (const doc of datos.documentos) {
      if (estadoDescarga.detenido) break;

      estadoDescarga.documentoActual++;

      // Verificar si ya fue descargado exitosamente
      const yaDescargado = await documentoYaDescargado(doc.claveAcceso, tipoDescarga);
      if (yaDescargado) {
        console.log('[SRI Background] Omitiendo (ya descargado):', doc.claveAcceso);
        estadoDescarga.omitidos++;
        notificarProgreso();
        continue;
      }

      let exitoXml = true;
      let exitoPdf = true;
      let errorMsg = null;

      try {
        // Descargar XML
        if ((tipoDescarga === 'xml' || tipoDescarga === 'ambos') && doc.tieneXml) {
          exitoXml = await ejecutarDescargaSRI(tabId, doc.linkXmlId);
          if (!exitoXml) errorMsg = 'Error descargando XML';
          await delay(300);
        }

        // Descargar PDF
        if ((tipoDescarga === 'pdf' || tipoDescarga === 'ambos') && doc.tienePdf) {
          exitoPdf = await ejecutarDescargaSRI(tabId, doc.linkPdfId);
          if (!exitoPdf) errorMsg = errorMsg ? 'Error descargando XML y PDF' : 'Error descargando PDF';
          await delay(300);
        }

      } catch (e) {
        console.error('[SRI Background] Error en documento:', e);
        exitoXml = false;
        exitoPdf = false;
        errorMsg = e.message;
      }

      const exito = exitoXml && exitoPdf;

      if (exito) {
        estadoDescarga.exitosos++;
      } else {
        estadoDescarga.fallidos++;
      }

      // Agregar al buffer en memoria (no escribe a storage aún)
      agregarAlBuffer({
        claveAcceso: doc.claveAcceso,
        ruc: doc.ruc,
        razonSocial: doc.razonSocial,
        tipoDoc: doc.tipoDoc,
        serie: doc.serie,
        fechaEmision: doc.fechaEmision,
        fechaAutorizacion: doc.fechaAutorizacion,
        pagina: pag,
        exito: exito,
        exitoXml: exitoXml,
        exitoPdf: exitoPdf,
        error: errorMsg,
        fechaDescarga: new Date().toISOString()
      });

      notificarProgreso();
    }

    // Ir a siguiente página si hay más
    if (pag < estadoDescarga.totalPaginas && !estadoDescarga.detenido) {
      console.log('[SRI Background] Navegando a siguiente página...');
      await navegarSiguiente(tabId);
      await delay(1500);
    }
  }

  // Al finalizar, guardar todo el buffer al storage
  await guardarBufferAlStorage();

  estadoDescarga.activo = false;
  console.log(`[SRI Background] Descarga finalizada: ${estadoDescarga.exitosos} exitosos, ${estadoDescarga.fallidos} fallidos`);
  notificarProgreso();
}

// Escuchar mensajes
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {

  if (request.action === 'iniciarDescargaTotal') {
    // Iniciar descarga desde el popup
    descargarTodasLasPaginas(request.tabId, request.tipoDescarga);
    sendResponse({ status: 'iniciado' });
    return false;
  }

  if (request.action === 'detenerDescarga') {
    estadoDescarga.detenido = true;
    sendResponse({ status: 'deteniendo' });
    return false;
  }

  if (request.action === 'obtenerEstado') {
    sendResponse({ estado: estadoDescarga });
    return false;
  }

  if (request.action === 'obtenerHistorial') {
    obtenerHistorial(request.ruc)
      .then(historial => sendResponse({ historial }))
      .catch(e => sendResponse({ error: e.message }));
    return true;
  }

  if (request.action === 'obtenerFallidos') {
    // Obtener documentos fallidos de la última sesión
    obtenerHistorial()
      .then(historial => {
        const fallidos = [];
        for (const ruc in historial) {
          for (const sesionId in historial[ruc].sesiones) {
            const sesion = historial[ruc].sesiones[sesionId];
            const docsFallidos = sesion.documentos.filter(d => !d.exito);
            fallidos.push(...docsFallidos.map(d => ({
              ...d,
              rucUsuario: ruc,
              sesionId: sesionId,
              fechaSesion: sesion.fecha
            })));
          }
        }
        // Ordenar por fecha más reciente
        fallidos.sort((a, b) => new Date(b.fechaDescarga) - new Date(a.fechaDescarga));
        sendResponse({ fallidos });
      })
      .catch(e => sendResponse({ error: e.message }));
    return true;
  }

  if (request.action === 'limpiarHistorial') {
    chrome.storage.local.remove(['historialDescargas'])
      .then(() => sendResponse({ success: true }))
      .catch(e => sendResponse({ error: e.message }));
    return true;
  }

  if (request.action === 'ejecutarDescarga') {
    // Descarga individual (para "solo esta página")
    const tabId = sender.tab?.id;
    if (!tabId) {
      sendResponse({ success: false, error: 'No tab ID' });
      return false;
    }

    ejecutarDescargaSRI(tabId, request.linkId)
      .then(success => sendResponse({ success }))
      .catch(e => sendResponse({ success: false, error: e.message }));
    return true;
  }

  return false;
});

// Evento cuando se instala la extensión
chrome.runtime.onInstalled.addListener(() => {
  console.log('SRI Document Downloader instalado correctamente');
});
