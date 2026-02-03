/**
 * SRI Document Downloader - Background Service Worker
 * Maneja la descarga de forma persistente (no se detiene al cerrar popup)
 * Guarda historial en chrome.storage.local
 * Verifica descargas reales con chrome.downloads API
 */

importScripts('config.js');

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
  sesionId: null,
  rucUsuario: null,
  timestampInicio: null,
  tiempoEstimado: null,
  error: null
};

// Sistema de deteccion de descargas basado en timing
// Cuando hacemos click en un link del SRI, esperamos que onCreated se dispare
// dentro del timeout. No filtramos por URL para evitar falsos negativos.
let pendingDownload = { resolver: null, timestamp: null };

chrome.downloads.onCreated.addListener((downloadItem) => {
  // Solo aceptar si hay un resolver pendiente y fue dentro de la ventana de tiempo
  if (pendingDownload.resolver && pendingDownload.timestamp) {
    const elapsed = Date.now() - pendingDownload.timestamp;
    // Solo aceptar descargas que ocurran dentro de la ventana activa
    if (elapsed < SRI_CONFIG.TIMEOUT_DESCARGA) {
      pendingDownload.resolver({ success: true, downloadId: downloadItem.id });
      pendingDownload.resolver = null;
      pendingDownload.timestamp = null;
    }
  }
});

// Aceptar automaticamente descargas del SRI marcadas como "peligrosas"
chrome.downloads.onChanged.addListener((delta) => {
  if (delta.danger && delta.danger.current === 'file') {
    chrome.downloads.search({ id: delta.id }, (items) => {
      if (items.length > 0) {
        const url = items[0].url || '';
        if (url.includes(SRI_CONFIG.DOMINIO_SRI) || estadoDescarga.activo) {
          chrome.downloads.acceptDanger(delta.id);
        }
      }
    });
  }
});

// Detectar si la tab del SRI se cierra durante descarga
chrome.tabs.onRemoved.addListener((tabId) => {
  if (estadoDescarga.activo && estadoDescarga.tabId === tabId) {
    estadoDescarga.detenido = true;
    estadoDescarga.error = 'La pestana del SRI fue cerrada';
    actualizarBadge();
    notificarProgreso();
  }
});

/**
 * Genera un ID unico para la sesion de descarga
 */
function generarSesionId() {
  return `sesion_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}

// Buffer en memoria para la sesion actual
let bufferSesion = {
  documentos: [],
  rucUsuario: null
};

// Indice de documentos ya descargados (Set para O(1) lookup)
let indiceDescargados = new Set();

/**
 * Construye un Set con claves de acceso ya descargadas exitosamente
 */
async function construirIndiceDescargados(tipoDescarga) {
  const data = await chrome.storage.local.get(['historialDescargas']);
  const historial = data.historialDescargas || {};
  const indice = new Set();

  for (const ruc in historial) {
    for (const sid in historial[ruc].sesiones) {
      for (const doc of historial[ruc].sesiones[sid].documentos) {
        if (!doc.exito) continue;
        if (tipoDescarga === 'xml' && doc.exitoXml) indice.add(doc.claveAcceso);
        else if (tipoDescarga === 'pdf' && doc.exitoPdf) indice.add(doc.claveAcceso);
        else if (tipoDescarga === 'ambos' && doc.exitoXml && doc.exitoPdf) indice.add(doc.claveAcceso);
      }
    }
  }

  return indice;
}

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

    // Limpiar buffer
    bufferSesion = { documentos: [], rucUsuario: null };

  } catch (e) {
    // Error guardando historial
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
    return null;
  }
}

/**
 * Limpia historial antiguo (mas de N dias segun config)
 */
async function limpiarHistorialAntiguo() {
  try {
    const data = await chrome.storage.local.get(['historialDescargas']);
    const historial = data.historialDescargas || {};
    const limite = Date.now() - (SRI_CONFIG.DIAS_HISTORIAL * 24 * 60 * 60 * 1000);

    for (const ruc in historial) {
      for (const sesionId in historial[ruc].sesiones) {
        const fecha = new Date(historial[ruc].sesiones[sesionId].fecha).getTime();
        if (fecha < limite) {
          delete historial[ruc].sesiones[sesionId];
        }
      }
      if (Object.keys(historial[ruc].sesiones).length === 0) {
        delete historial[ruc];
      }
    }

    await chrome.storage.local.set({ historialDescargas: historial });
  } catch (e) {
    // Error limpiando historial
  }
}

// Metodo de descarga activo: 'mojarra' o 'click'
let metodoDescarga = 'mojarra';

/**
 * Carga la configuracion del usuario desde storage
 */
async function cargarConfigUsuario() {
  const data = await chrome.storage.local.get(['sriConfig']);
  if (data.sriConfig) {
    if (data.sriConfig.DELAY_DESCARGA !== undefined) SRI_CONFIG.DELAY_DESCARGA = data.sriConfig.DELAY_DESCARGA;
    if (data.sriConfig.TIMEOUT_DESCARGA !== undefined) SRI_CONFIG.TIMEOUT_DESCARGA = data.sriConfig.TIMEOUT_DESCARGA;
    if (data.sriConfig.DELAY_PAGINA !== undefined) SRI_CONFIG.DELAY_PAGINA = data.sriConfig.DELAY_PAGINA;
    if (data.sriConfig.TIMEOUT_PAGINA !== undefined) SRI_CONFIG.TIMEOUT_PAGINA = data.sriConfig.TIMEOUT_PAGINA;
    if (data.sriConfig.MAX_REINTENTOS !== undefined) SRI_CONFIG.MAX_REINTENTOS = data.sriConfig.MAX_REINTENTOS;
    if (data.sriConfig.DELAY_REINTENTO !== undefined) SRI_CONFIG.DELAY_REINTENTO = data.sriConfig.DELAY_REINTENTO;
    if (data.sriConfig.DIAS_HISTORIAL !== undefined) SRI_CONFIG.DIAS_HISTORIAL = data.sriConfig.DIAS_HISTORIAL;
    if (data.sriConfig.METODO_DESCARGA) metodoDescarga = data.sriConfig.METODO_DESCARGA;
  }
}

/**
 * Ejecuta descarga usando mojarra.jsfcljs (metodo directo JSF)
 * Llama la funcion JSF directamente sin pasar por el click del DOM
 */
function ejecutarDescargaMojarra(tabId, linkId) {
  return new Promise((resolve) => {
    const timeout = setTimeout(() => {
      pendingDownload.resolver = null;
      pendingDownload.timestamp = null;
      resolve(false);
    }, SRI_CONFIG.TIMEOUT_DESCARGA);

    pendingDownload.timestamp = Date.now();
    pendingDownload.resolver = (resultado) => {
      clearTimeout(timeout);
      resolve(resultado?.success ?? false);
    };

    chrome.scripting.executeScript({
      target: { tabId: tabId },
      world: 'MAIN',
      func: (linkId) => {
        try {
          mojarra.jsfcljs(
            document.getElementById('frmPrincipal'),
            { [linkId]: linkId },
            ''
          );
          return { success: true };
        } catch (e) {
          return { success: false, error: e.message };
        }
      },
      args: [linkId]
    }).then((resultado) => {
      const res = resultado[0]?.result;
      if (!res?.success) {
        clearTimeout(timeout);
        pendingDownload.resolver = null;
        pendingDownload.timestamp = null;
        resolve(false);
      }
    }).catch(() => {
      clearTimeout(timeout);
      pendingDownload.resolver = null;
      pendingDownload.timestamp = null;
      resolve(false);
    });
  });
}

/**
 * Ejecuta descarga usando click emulado en el elemento
 * Simula un click de usuario en el link de descarga
 */
function ejecutarDescargaClick(tabId, linkId) {
  return new Promise((resolve) => {
    const timeout = setTimeout(() => {
      pendingDownload.resolver = null;
      pendingDownload.timestamp = null;
      resolve(false);
    }, SRI_CONFIG.TIMEOUT_DESCARGA);

    pendingDownload.timestamp = Date.now();
    pendingDownload.resolver = (resultado) => {
      clearTimeout(timeout);
      resolve(resultado?.success ?? false);
    };

    chrome.scripting.executeScript({
      target: { tabId: tabId },
      world: 'MAIN',
      func: (linkId) => {
        const el = document.getElementById(linkId);
        if (!el) return { success: false, error: 'no-element' };
        el.click();
        return { success: true };
      },
      args: [linkId]
    }).then((resultado) => {
      const res = resultado[0]?.result;
      if (!res?.success) {
        clearTimeout(timeout);
        pendingDownload.resolver = null;
        pendingDownload.timestamp = null;
        resolve(false);
      }
    }).catch(() => {
      clearTimeout(timeout);
      pendingDownload.resolver = null;
      pendingDownload.timestamp = null;
      resolve(false);
    });
  });
}

/**
 * Ejecuta la descarga usando el metodo configurado
 */
function ejecutarDescargaSRI(tabId, linkId) {
  if (metodoDescarga === 'click') {
    return ejecutarDescargaClick(tabId, linkId);
  }
  return ejecutarDescargaMojarra(tabId, linkId);
}

/**
 * Ejecuta descarga con reintentos automaticos
 */
async function ejecutarConReintento(tabId, linkId) {
  for (let intento = 0; intento <= SRI_CONFIG.MAX_REINTENTOS; intento++) {
    const exito = await ejecutarDescargaSRI(tabId, linkId);
    if (exito) return true;
    if (intento < SRI_CONFIG.MAX_REINTENTOS) {
      await delay(SRI_CONFIG.DELAY_REINTENTO);
    }
  }
  return false;
}

/**
 * Obtiene datos de la pagina actual via executeScript
 */
async function obtenerDatosPagina(tabId) {
  try {
    const resultado = await chrome.scripting.executeScript({
      target: { tabId: tabId },
      func: (selectores) => {
        const tabla = document.querySelector(selectores.TABLA_RECIBIDOS);
        if (!tabla) return { error: 'No se encontro la tabla' };

        const filas = tabla.querySelectorAll('tr');
        const documentos = [];

        filas.forEach((fila, index) => {
          const celdas = fila.querySelectorAll('td');
          if (celdas.length >= 6) {
            const linkXml = fila.querySelector(selectores.LINK_XML);
            const linkPdf = fila.querySelector(selectores.LINK_PDF);

            const ruc = celdas[1]?.textContent?.trim().split('\n')[0] || '';
            const razonSocial = celdas[1]?.textContent?.trim().split('\n')[1] || '';
            const tipoDoc = celdas[2]?.textContent?.trim().split('\n')[0] || '';
            const serie = celdas[2]?.textContent?.trim().split('\n')[1] || '';
            const claveAcceso = celdas[3]?.textContent?.trim() || '';
            const fechaEmision = celdas[4]?.textContent?.trim() || '';
            const fechaAutorizacion = celdas[5]?.textContent?.trim() || '';

            documentos.push({
              index, ruc, razonSocial, tipoDoc, serie, claveAcceso,
              fechaEmision, fechaAutorizacion,
              tieneXml: !!linkXml,
              tienePdf: !!linkPdf,
              linkXmlId: linkXml?.id,
              linkPdfId: linkPdf?.id,
            });
          }
        });

        // Paginacion
        const paginador = document.querySelector(selectores.PAGINADOR);
        let paginacion = { actual: 1, total: 1 };
        if (paginador) {
          const match = paginador.textContent.match(/\((\d+) of (\d+)\)/);
          if (match) {
            paginacion = { actual: parseInt(match[1]), total: parseInt(match[2]) };
          }
        }

        // RUC del usuario
        const rucUsuario = document.querySelector(selectores.RUC_USUARIO)?.textContent?.match(/\d{13}/)?.[0] || 'desconocido';

        return { documentos, paginacion, rucUsuario };
      },
      args: [SRI_CONFIG.SELECTORES]
    });
    return resultado[0]?.result;
  } catch (e) {
    return { error: e.message };
  }
}

/**
 * Navega a la primera pagina
 */
async function navegarPrimera(tabId) {
  try {
    await chrome.scripting.executeScript({
      target: { tabId: tabId },
      func: (selector) => {
        const boton = document.querySelector(selector);
        if (boton) boton.click();
      },
      args: [SRI_CONFIG.SELECTORES.BOTON_PRIMERA]
    });
    return true;
  } catch (e) {
    return false;
  }
}

/**
 * Navega a la siguiente pagina
 */
async function navegarSiguiente(tabId) {
  try {
    const resultado = await chrome.scripting.executeScript({
      target: { tabId: tabId },
      func: (selector) => {
        const boton = document.querySelector(selector);
        if (boton) {
          boton.click();
          return true;
        }
        return false;
      },
      args: [SRI_CONFIG.SELECTORES.BOTON_SIGUIENTE]
    });
    return resultado[0]?.result ?? false;
  } catch (e) {
    return false;
  }
}

/**
 * Espera inteligente: verifica que el paginador muestre la pagina esperada
 */
async function esperarCambioPagina(tabId, paginaEsperada) {
  const inicio = Date.now();
  while (Date.now() - inicio < SRI_CONFIG.TIMEOUT_PAGINA) {
    const datos = await obtenerDatosPagina(tabId);
    if (datos.paginacion?.actual === paginaEsperada) return true;
    await delay(500);
  }
  return false;
}

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Actualiza el badge del icono de la extension
 */
function actualizarBadge() {
  if (estadoDescarga.activo) {
    const texto = `${estadoDescarga.exitosos}`;
    chrome.action.setBadgeText({ text: texto });
    chrome.action.setBadgeBackgroundColor({
      color: estadoDescarga.fallidos > 0 ? '#ff9800' : '#4caf50'
    });
  } else {
    setTimeout(() => {
      if (!estadoDescarga.activo) {
        chrome.action.setBadgeText({ text: '' });
      }
    }, 5000);
  }
}

/**
 * Notifica el progreso al popup (si esta abierto)
 */
function notificarProgreso() {
  chrome.runtime.sendMessage({
    action: 'estadoDescarga',
    estado: { ...estadoDescarga }
  }).catch(() => {});
}

/**
 * Calcula tiempo estimado restante
 */
function calcularTiempoEstimado() {
  if (!estadoDescarga.timestampInicio || estadoDescarga.documentoActual === 0) {
    return null;
  }
  const transcurrido = Date.now() - estadoDescarga.timestampInicio;
  const promedioPorDoc = transcurrido / estadoDescarga.documentoActual;
  const restantes = estadoDescarga.totalDocumentos - estadoDescarga.documentoActual;
  return Math.round(promedioPorDoc * restantes);
}

/**
 * Envia notificacion nativa de Chrome al finalizar
 */
function notificarFinalizacion() {
  const mensaje = estadoDescarga.detenido
    ? `Detenido: ${estadoDescarga.exitosos} OK, ${estadoDescarga.fallidos} fallidos`
    : `Completado: ${estadoDescarga.exitosos} OK, ${estadoDescarga.fallidos} fallidos`;

  chrome.notifications.create({
    type: 'basic',
    iconUrl: 'icons/icon128.png',
    title: 'SRI Document Downloader',
    message: mensaje
  });
}

/**
 * Proceso principal de descarga de todas las paginas
 */
async function descargarTodasLasPaginas(tabId, tipoDescarga, ignorarHistorial = false) {
  // Cargar configuracion del usuario
  await cargarConfigUsuario();

  // Limpiar historial antiguo al iniciar
  limpiarHistorialAntiguo();

  const sesionId = generarSesionId();

  // Reiniciar buffer
  bufferSesion = { documentos: [], rucUsuario: null };

  // Construir indice de descargados para O(1) lookup (vacio si se ignora historial)
  if (ignorarHistorial) {
    indiceDescargados = new Set();
  } else {
    indiceDescargados = await construirIndiceDescargados(tipoDescarga);
  }

  estadoDescarga = {
    activo: true,
    detenido: false,
    exitosos: 0,
    fallidos: 0,
    omitidos: 0,
    paginaActual: 1,
    totalPaginas: 1,
    documentoActual: 0,
    totalDocumentos: 0,
    tipoDescarga: tipoDescarga,
    tabId: tabId,
    sesionId: sesionId,
    rucUsuario: null,
    timestampInicio: Date.now(),
    tiempoEstimado: null,
    error: null
  };

  actualizarBadge();
  notificarProgreso();

  // Obtener info inicial
  let datos = await obtenerDatosPagina(tabId);
  if (datos.error) {
    estadoDescarga.activo = false;
    estadoDescarga.error = datos.error;
    actualizarBadge();
    notificarProgreso();
    return;
  }

  estadoDescarga.totalPaginas = datos.paginacion.total;
  estadoDescarga.rucUsuario = datos.rucUsuario;
  bufferSesion.rucUsuario = datos.rucUsuario;

  // Estimar total de documentos (docs en pagina actual * total paginas)
  const docsPorPagina = datos.documentos.length;
  estadoDescarga.totalDocumentos = docsPorPagina * datos.paginacion.total;

  // Ir a primera pagina si no estamos en ella
  if (datos.paginacion.actual > 1) {
    await navegarPrimera(tabId);
    await esperarCambioPagina(tabId, 1);
    datos = await obtenerDatosPagina(tabId);
  }

  // Procesar todas las paginas
  for (let pag = 1; pag <= estadoDescarga.totalPaginas; pag++) {
    if (estadoDescarga.detenido) break;

    estadoDescarga.paginaActual = pag;

    // Obtener documentos de pagina actual
    datos = await obtenerDatosPagina(tabId);
    if (datos.error) break;

    // Descargar documentos de esta pagina
    for (const doc of datos.documentos) {
      if (estadoDescarga.detenido) break;

      estadoDescarga.documentoActual++;

      // Verificar si ya fue descargado (O(1) con Set)
      if (indiceDescargados.has(doc.claveAcceso)) {
        estadoDescarga.omitidos++;
        estadoDescarga.tiempoEstimado = calcularTiempoEstimado();
        actualizarBadge();
        notificarProgreso();
        continue;
      }

      let exitoXml = true;
      let exitoPdf = true;
      let errorMsg = null;

      try {
        // Descargar XML con reintentos
        if ((tipoDescarga === 'xml' || tipoDescarga === 'ambos') && doc.tieneXml) {
          exitoXml = await ejecutarConReintento(tabId, doc.linkXmlId);
          if (!exitoXml) errorMsg = 'Error descargando XML';
          await delay(SRI_CONFIG.DELAY_DESCARGA);
        }

        // Descargar PDF con reintentos
        if ((tipoDescarga === 'pdf' || tipoDescarga === 'ambos') && doc.tienePdf) {
          exitoPdf = await ejecutarConReintento(tabId, doc.linkPdfId);
          if (!exitoPdf) errorMsg = errorMsg ? 'Error descargando XML y PDF' : 'Error descargando PDF';
          await delay(SRI_CONFIG.DELAY_DESCARGA);
        }

      } catch (e) {
        exitoXml = false;
        exitoPdf = false;
        errorMsg = e.message;
      }

      const exito = exitoXml && exitoPdf;

      if (exito) {
        estadoDescarga.exitosos++;
        indiceDescargados.add(doc.claveAcceso);
      } else {
        estadoDescarga.fallidos++;
      }

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

      estadoDescarga.tiempoEstimado = calcularTiempoEstimado();
      actualizarBadge();
      notificarProgreso();
    }

    // Ir a siguiente pagina si hay mas
    if (pag < estadoDescarga.totalPaginas && !estadoDescarga.detenido) {
      await navegarSiguiente(tabId);
      const cambioOk = await esperarCambioPagina(tabId, pag + 1);
      if (!cambioOk) {
        await delay(SRI_CONFIG.DELAY_PAGINA);
      }
    }
  }

  // Guardar buffer al storage
  await guardarBufferAlStorage();

  estadoDescarga.activo = false;
  estadoDescarga.tiempoEstimado = null;

  actualizarBadge();
  notificarProgreso();
  notificarFinalizacion();
}

// Escuchar mensajes
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {

  if (request.action === 'iniciarDescargaTotal') {
    descargarTodasLasPaginas(request.tabId, request.tipoDescarga, request.ignorarHistorial || false);
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

  if (request.action === 'obtenerConfig') {
    chrome.storage.local.get(['sriConfig']).then(data => {
      sendResponse({ config: data.sriConfig || null });
    });
    return true;
  }

  if (request.action === 'guardarConfig') {
    chrome.storage.local.set({ sriConfig: request.config }).then(() => {
      // Aplicar inmediatamente
      cargarConfigUsuario().then(() => {
        sendResponse({ success: true });
      });
    }).catch(e => sendResponse({ error: e.message }));
    return true;
  }

  if (request.action === 'ejecutarDescarga') {
    const tabId = sender.tab?.id;
    if (!tabId) {
      sendResponse({ success: false, error: 'No tab ID' });
      return false;
    }

    ejecutarConReintento(tabId, request.linkId)
      .then(success => sendResponse({ success }))
      .catch(e => sendResponse({ success: false, error: e.message }));
    return true;
  }

  return false;
});

// Evento cuando se instala la extension
chrome.runtime.onInstalled.addListener(() => {
  // Cargar config del usuario al instalar/actualizar
  cargarConfigUsuario();
});
