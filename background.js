/**
 * Descargador de Comprobantes SRI - Background Service Worker
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
  origen: 'recibidos',
  tabId: null,
  sesionId: null,
  rucUsuario: null,
  timestampInicio: null,
  tiempoEstimado: null,
  error: null
};

// Sistema de deteccion de descargas basado en timing + filtro laxo de origen.
// Cuando hacemos click en un link del SRI, esperamos que onCreated se dispare
// dentro del timeout. El filtro acepta dominio SRI, blob: o URL vacia (JSF
// puede no exponer la URL), pero rechaza descargas de otros sitios para no
// marcar como exito una descarga ajena que el usuario inicie en paralelo.
let pendingDownload = { resolver: null, timestamp: null, docMetadata: null, tipoArchivo: null };

// Map de metadata por downloadId para onDeterminingFilename
let downloadMetadataMap = new Map();

chrome.downloads.onCreated.addListener((downloadItem) => {
  if (!pendingDownload.resolver || !pendingDownload.timestamp) return;

  const elapsed = Date.now() - pendingDownload.timestamp;
  if (elapsed >= SRI_CONFIG.TIMEOUT_DESCARGA) return;

  const url = downloadItem.url || '';
  const finalUrl = downloadItem.finalUrl || '';
  const esDelSri = url === '' || url.startsWith('blob:') ||
    url.includes(SRI_CONFIG.DOMINIO_SRI) || finalUrl.includes(SRI_CONFIG.DOMINIO_SRI);
  if (!esDelSri) return;

  // Guardar metadata para onDeterminingFilename antes de limpiar
  if (pendingDownload.docMetadata) {
    downloadMetadataMap.set(downloadItem.id, {
      docMetadata: { ...pendingDownload.docMetadata, rucUsuario: estadoDescarga.rucUsuario },
      tipoArchivo: pendingDownload.tipoArchivo
    });
  }
  pendingDownload.resolver({ success: true, downloadId: downloadItem.id });
  pendingDownload.resolver = null;
  pendingDownload.timestamp = null;
  pendingDownload.docMetadata = null;
  pendingDownload.tipoArchivo = null;
});

// Interceptar descargas para organizar en carpetas
chrome.downloads.onDeterminingFilename.addListener((downloadItem, suggest) => {
  const meta = downloadMetadataMap.get(downloadItem.id);

  if (!meta || !SRI_CONFIG.ORGANIZACION?.HABILITADO) {
    // Usar filename original - suggest() sin args puede cancelar la descarga
    suggest({ filename: downloadItem.filename });
    return true;
  }

  downloadMetadataMap.delete(downloadItem.id);

  // Obtener extension del archivo original
  const nombreOriginal = downloadItem.filename || '';
  let extension = '';
  if (nombreOriginal.includes('.')) {
    extension = '.' + nombreOriginal.split('.').pop().toLowerCase();
  } else {
    extension = meta.tipoArchivo === 'xml' ? '.xml' : '.pdf';
  }

  const rutaCompleta = construirRutaArchivo(meta.docMetadata, meta.tipoArchivo, extension);

  if (rutaCompleta) {
    suggest({ filename: rutaCompleta, conflictAction: 'overwrite' });
  } else {
    suggest({ filename: downloadItem.filename });
  }
  return true;
});

// Aceptar automaticamente descargas del SRI marcadas como "peligrosas"
chrome.downloads.onChanged.addListener((delta) => {
  if (delta.danger && delta.danger.current === 'file') {
    chrome.downloads.search({ id: delta.id }, (items) => {
      if (items.length > 0) {
        const url = items[0].url || '';
        if (url.includes(SRI_CONFIG.DOMINIO_SRI)) {
          try {
            if (chrome.downloads.acceptDanger) {
              chrome.downloads.acceptDanger(delta.id);
            }
          } catch (e) {
            // acceptDanger puede no estar disponible en versiones recientes de Chrome/Edge
          }
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
 * Genera un ID unico para la sesion de descarga.
 * @returns {string} ID con timestamp + sufijo aleatorio (ej: "sesion_1700000000000_ab12cd34e")
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
 * Construye un Set con claves de acceso ya descargadas exitosamente, usado
 * para deduplicar en O(1) durante la sesion.
 *
 * Semantica de exitoXml/exitoPdf en el historial:
 * - null  = ese formato NO se intento (no fue solicitado o el doc no tenia link)
 * - true  = se descargo correctamente
 * - false = se intento y fallo
 * Solo se cuenta como "cubierto" un formato si ademas la sesion realmente lo
 * solicito (sesion.tipoDescarga), porque registros de versiones viejas
 * guardaban true por defecto sin haberlo intentado.
 *
 * Un documento entra al indice solo si cubre lo que la NUEVA sesion pide:
 * 'xml' requiere xmlOk, 'pdf' requiere pdfOk, 'ambos' requiere los dos.
 * Esto es deliberadamente conservador: ante duda se re-descarga.
 * @param {'xml'|'pdf'|'ambos'} tipoDescarga - Tipo solicitado en la nueva sesion
 * @returns {Promise<Set<string>>} Claves de acceso que se pueden omitir
 */
async function construirIndiceDescargados(tipoDescarga) {
  const data = await chrome.storage.local.get(['historialDescargas']);
  const historial = data.historialDescargas || {};
  const indice = new Set();

  for (const ruc in historial) {
    for (const sid in historial[ruc].sesiones) {
      const sesion = historial[ruc].sesiones[sid];
      // Un flag exitoXml/exitoPdf solo es confiable si esa sesion realmente
      // intento ese formato (registros de versiones viejas guardaban true por defecto)
      const cubreXml = sesion.tipoDescarga === 'xml' || sesion.tipoDescarga === 'ambos';
      const cubrePdf = sesion.tipoDescarga === 'pdf' || sesion.tipoDescarga === 'ambos';
      for (const doc of sesion.documentos) {
        if (!doc.exito) continue;
        const xmlOk = cubreXml && doc.exitoXml === true;
        const pdfOk = cubrePdf && doc.exitoPdf === true;
        if (tipoDescarga === 'xml' && xmlOk) indice.add(doc.claveAcceso);
        else if (tipoDescarga === 'pdf' && pdfOk) indice.add(doc.claveAcceso);
        else if (tipoDescarga === 'ambos' && xmlOk && pdfOk) indice.add(doc.claveAcceso);
      }
    }
  }

  return indice;
}

/**
 * Agrega un documento al buffer en memoria (no escribe a storage).
 * @param {Object} registro - Registro del documento procesado (clave, exito, etc.)
 */
function agregarAlBuffer(registro) {
  bufferSesion.documentos.push(registro);
}

/**
 * Guarda el buffer al storage bajo el sesionId actual (sobreescribe la misma
 * sesion en cada llamada, no duplica). Se llama incrementalmente (al terminar
 * cada pagina) porque Chrome puede terminar el service worker MV3 en cualquier
 * momento de una descarga larga y el buffer en memoria se perderia; y al
 * finalizar con esFinal=true para ademas limpiar el buffer.
 * @param {boolean} [esFinal=true] - true limpia el buffer tras guardar
 * @returns {Promise<void>}
 */
async function guardarBufferAlStorage(esFinal = true) {
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
      origen: estadoDescarga.origen || 'recibidos',
      documentos: bufferSesion.documentos,
      resumen: {
        exitosos: exitosos,
        fallidos: fallidos,
        total: bufferSesion.documentos.length
      }
    };

    historial[ruc].ultimaActualizacion = new Date().toISOString();

    await chrome.storage.local.set({ historialDescargas: historial });

    if (esFinal) {
      bufferSesion = { documentos: [], rucUsuario: null };
    }

  } catch (e) {
    // Error guardando historial
  }
}

/**
 * Obtiene el historial de descargas desde storage.
 * @param {string|null} [ruc=null] - Si se indica, devuelve solo el historial de ese RUC
 * @returns {Promise<Object|null>} Historial completo, el de un RUC, o null si falla
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
 * Limpia sesiones del historial con mas de N dias de antiguedad
 * (SRI_CONFIG.DIAS_HISTORIAL) y elimina RUCs que quedan sin sesiones.
 * @returns {Promise<void>}
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
 * Carga la configuracion del usuario desde storage y la aplica sobre
 * SRI_CONFIG (solo las claves definidas; el resto conserva los defaults).
 * @returns {Promise<void>}
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
    if (data.sriConfig.ORGANIZACION !== undefined) {
      SRI_CONFIG.ORGANIZACION = { ...SRI_CONFIG.ORGANIZACION, ...data.sriConfig.ORGANIZACION };
    }
  }
}

/**
 * Ejecuta descarga usando mojarra.jsfcljs (metodo directo JSF).
 * Llama la funcion JSF directamente sin pasar por el click del DOM. Requiere
 * world: 'MAIN' porque mojarra solo existe en el contexto de la pagina y el
 * CSP del SRI bloquea scripts inline.
 * La confirmacion de exito NO es el return del script sino que
 * chrome.downloads.onCreated se dispare dentro de TIMEOUT_DESCARGA
 * (via pendingDownload), evitando marcar OK descargas que nunca ocurrieron.
 * @param {number} tabId - Tab del SRI
 * @param {string} linkId - ID del link JSF de descarga (ej: "frmPrincipal:...:lnkXml")
 * @param {Object} docMetadata - Metadata del documento para organizar el archivo
 * @param {'xml'|'pdf'} tipoArchivo - Formato que se esta descargando
 * @returns {Promise<boolean>} true si la descarga fue confirmada por onCreated
 */
function ejecutarDescargaMojarra(tabId, linkId, docMetadata, tipoArchivo) {
  return new Promise((resolve) => {
    const timeout = setTimeout(() => {
      pendingDownload.resolver = null;
      pendingDownload.timestamp = null;
      pendingDownload.docMetadata = null;
      pendingDownload.tipoArchivo = null;
      resolve(false);
    }, SRI_CONFIG.TIMEOUT_DESCARGA);

    pendingDownload.timestamp = Date.now();
    pendingDownload.docMetadata = docMetadata || null;
    pendingDownload.tipoArchivo = tipoArchivo || null;
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
        pendingDownload.docMetadata = null;
        pendingDownload.tipoArchivo = null;
        resolve(false);
      }
    }).catch(() => {
      clearTimeout(timeout);
      pendingDownload.resolver = null;
      pendingDownload.timestamp = null;
      pendingDownload.docMetadata = null;
      pendingDownload.tipoArchivo = null;
      resolve(false);
    });
  });
}

/**
 * Ejecuta descarga usando click emulado en el link de descarga.
 * Alternativa mas compatible (pero mas lenta) al metodo mojarra; misma
 * confirmacion via chrome.downloads.onCreated que ejecutarDescargaMojarra.
 * @param {number} tabId - Tab del SRI
 * @param {string} linkId - ID del elemento link a clickear
 * @param {Object} docMetadata - Metadata del documento para organizar el archivo
 * @param {'xml'|'pdf'} tipoArchivo - Formato que se esta descargando
 * @returns {Promise<boolean>} true si la descarga fue confirmada por onCreated
 */
function ejecutarDescargaClick(tabId, linkId, docMetadata, tipoArchivo) {
  return new Promise((resolve) => {
    const timeout = setTimeout(() => {
      pendingDownload.resolver = null;
      pendingDownload.timestamp = null;
      pendingDownload.docMetadata = null;
      pendingDownload.tipoArchivo = null;
      resolve(false);
    }, SRI_CONFIG.TIMEOUT_DESCARGA);

    pendingDownload.timestamp = Date.now();
    pendingDownload.docMetadata = docMetadata || null;
    pendingDownload.tipoArchivo = tipoArchivo || null;
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
        pendingDownload.docMetadata = null;
        pendingDownload.tipoArchivo = null;
        resolve(false);
      }
    }).catch(() => {
      clearTimeout(timeout);
      pendingDownload.resolver = null;
      pendingDownload.timestamp = null;
      pendingDownload.docMetadata = null;
      pendingDownload.tipoArchivo = null;
      resolve(false);
    });
  });
}

/**
 * Ejecuta la descarga usando el metodo configurado por el usuario
 * ('mojarra' por defecto, 'click' como alternativa compatible).
 * @param {number} tabId - Tab del SRI
 * @param {string} linkId - ID del link de descarga
 * @param {Object} docMetadata - Metadata del documento
 * @param {'xml'|'pdf'} tipoArchivo - Formato que se esta descargando
 * @returns {Promise<boolean>} true si la descarga fue confirmada
 */
function ejecutarDescargaSRI(tabId, linkId, docMetadata, tipoArchivo) {
  if (metodoDescarga === 'click') {
    return ejecutarDescargaClick(tabId, linkId, docMetadata, tipoArchivo);
  }
  return ejecutarDescargaMojarra(tabId, linkId, docMetadata, tipoArchivo);
}

// =====================================================
// Descarga de XML de emitidos via web service del SRI
// =====================================================
// En la pantalla de emitidos no hay link de descarga de XML (solo el PDF/RIDE).
// El XML autorizado se obtiene del WS publico AutorizacionComprobantesOffline
// usando la clave de acceso. Requiere host_permissions para cel/celcer.sri.gob.ec.

/**
 * Des-escapa las entidades XML de una cadena (el WS devuelve el comprobante
 * con &lt; &gt; &amp; etc.). El service worker MV3 no tiene DOMParser, asi que
 * se resuelven manualmente. Se hace en UNA SOLA pasada con una alternancia
 * para que el texto producido nunca se re-escanee (evita dobles
 * decodificaciones como &amp;#38;lt; → &lt; → <).
 * @param {string} s - Cadena con entidades escapadas
 * @returns {string} XML des-escapado
 */
function desescaparXml(s) {
  const nombradas = { lt: '<', gt: '>', quot: '"', apos: "'", amp: '&' };
  return s.replace(/&(#x[0-9a-fA-F]+|#\d+|lt|gt|quot|apos|amp);/g, (m, ent) => {
    if (ent[0] === '#') {
      const codigo = (ent[1] === 'x' || ent[1] === 'X')
        ? parseInt(ent.slice(2), 16)
        : parseInt(ent.slice(1), 10);
      return String.fromCodePoint(codigo);
    }
    return nombradas[ent];
  });
}

/**
 * Convierte un string XML a un data URL base64 (UTF-8). En el service worker
 * MV3 no existe URL.createObjectURL, asi que se descarga via data URL.
 * @param {string} xml - Contenido XML
 * @returns {string} data URL descargable
 */
function xmlADataUrl(xml) {
  const bytes = new TextEncoder().encode(xml);
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return 'data:application/xml;base64,' + btoa(bin);
}

/**
 * Consulta el WS de autorizacion del SRI y devuelve el XML del comprobante
 * autorizado (des-escapado), o null si no esta autorizado o falla.
 * @param {string} claveAcceso - Clave de acceso de 49 digitos
 * @param {boolean} [pruebas=false] - Usar ambiente de pruebas (celcer)
 * @returns {Promise<{xml: string, numeroAutorizacion: string, fechaAutorizacion: string}|null>}
 */
async function consultarXmlAutorizado(claveAcceso, pruebas = false) {
  const endpoint = pruebas ? SRI_CONFIG.WS_AUTORIZACION.PRUEBAS : SRI_CONFIG.WS_AUTORIZACION.PRODUCCION;
  const soap = '<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:ec="' +
    SRI_CONFIG.WS_AUTORIZACION.NAMESPACE + '"><soapenv:Header/><soapenv:Body>' +
    '<ec:autorizacionComprobante><claveAccesoComprobante>' + claveAcceso +
    '</claveAccesoComprobante></ec:autorizacionComprobante></soapenv:Body></soapenv:Envelope>';

  const resp = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'text/xml;charset=UTF-8', 'SOAPAction': '' },
    body: soap
  });
  if (!resp.ok) return null;

  const txt = await resp.text();

  // Verificar estado AUTORIZADO
  const estado = (txt.match(/<estado>([^<]*)<\/estado>/) || [])[1];
  if (estado !== 'AUTORIZADO') return null;

  // Extraer el comprobante (viene escapado, puede o no estar en CDATA)
  const m = txt.match(/<comprobante>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/comprobante>/);
  if (!m || !m[1]) return null;

  const xml = desescaparXml(m[1]).trim();
  return {
    xml,
    numeroAutorizacion: (txt.match(/<numeroAutorizacion>([^<]*)<\/numeroAutorizacion>/) || [])[1] || '',
    fechaAutorizacion: (txt.match(/<fechaAutorizacion>([^<]*)<\/fechaAutorizacion>/) || [])[1] || ''
  };
}

/**
 * Descarga el XML autorizado de un comprobante emitido via web service.
 * Intenta produccion y, si no encuentra autorizacion, ambiente de pruebas.
 * @param {string} claveAcceso - Clave de acceso de 49 digitos
 * @param {Object} docMetadata - Metadata para organizar/nombrar el archivo
 * @returns {Promise<boolean>} true si se disparo la descarga
 */
async function descargarXmlEmitido(claveAcceso, docMetadata) {
  try {
    let resultado = await consultarXmlAutorizado(claveAcceso, false);
    if (!resultado) resultado = await consultarXmlAutorizado(claveAcceso, true);
    if (!resultado) return false;

    const url = xmlADataUrl(resultado.xml);
    const meta = { ...docMetadata, rucUsuario: estadoDescarga.rucUsuario };
    const ruta = construirRutaArchivo(meta, 'xml', '.xml');
    const filename = ruta || `${claveAcceso}.xml`;

    await chrome.downloads.download({
      url,
      filename,
      conflictAction: ruta ? 'overwrite' : 'uniquify'
    });
    return true;
  } catch (e) {
    return false;
  }
}

/**
 * Descarga el XML de un emitido via web service, con reintentos automaticos
 * (SRI_CONFIG.MAX_REINTENTOS, con DELAY_REINTENTO entre intentos).
 * @param {string} claveAcceso - Clave de acceso de 49 digitos
 * @param {Object} docMetadata - Metadata para organizar/nombrar el archivo
 * @returns {Promise<boolean>} true si se disparo la descarga
 */
async function descargarXmlEmitidoConReintento(claveAcceso, docMetadata) {
  for (let intento = 0; intento <= SRI_CONFIG.MAX_REINTENTOS; intento++) {
    const exito = await descargarXmlEmitido(claveAcceso, docMetadata);
    if (exito) return true;
    if (intento < SRI_CONFIG.MAX_REINTENTOS) {
      await delay(SRI_CONFIG.DELAY_REINTENTO);
    }
  }
  return false;
}

/**
 * Ejecuta una descarga por link de la pagina con reintentos automaticos
 * (SRI_CONFIG.MAX_REINTENTOS, con DELAY_REINTENTO entre intentos).
 * @param {number} tabId - Tab del SRI
 * @param {string} linkId - ID del link de descarga
 * @param {Object} docMetadata - Metadata del documento
 * @param {'xml'|'pdf'} tipoArchivo - Formato que se esta descargando
 * @returns {Promise<boolean>} true si alguna de las ejecuciones tuvo exito
 */
async function ejecutarConReintento(tabId, linkId, docMetadata, tipoArchivo) {
  for (let intento = 0; intento <= SRI_CONFIG.MAX_REINTENTOS; intento++) {
    const exito = await ejecutarDescargaSRI(tabId, linkId, docMetadata, tipoArchivo);
    if (exito) return true;
    if (intento < SRI_CONFIG.MAX_REINTENTOS) {
      await delay(SRI_CONFIG.DELAY_REINTENTO);
    }
  }
  return false;
}

/**
 * Obtiene datos de la pagina actual via executeScript: filas de la tabla
 * (segun origen), paginacion y RUC del usuario logueado.
 * En emitidos la tabla no trae link XML (el XML se obtiene despues del web
 * service con la clave de acceso) y el emisor es el propio usuario.
 * @param {number} tabId - Tab del SRI
 * @param {'recibidos'|'emitidos'} [origen='recibidos'] - Tabla a extraer
 * @returns {Promise<{documentos: Array<Object>, paginacion: {actual: number, total: number}, rucUsuario: string, origen: string}|{error: string}>}
 */
async function obtenerDatosPagina(tabId, origen = 'recibidos') {
  try {
    const resultado = await chrome.scripting.executeScript({
      target: { tabId: tabId },
      func: (selectores, origen) => {
        const tabla = document.querySelector(
          origen === 'emitidos' ? selectores.TABLA_EMITIDOS : selectores.TABLA_RECIBIDOS
        );
        if (!tabla) return { error: `No se encontro la tabla de comprobantes ${origen}` };

        // RUC del usuario logueado
        const rucUsuario = document.querySelector(selectores.RUC_USUARIO)?.textContent?.match(/\d{13}/)?.[0] || 'desconocido';

        const filas = tabla.querySelectorAll('tr');
        const documentos = [];

        filas.forEach((fila, index) => {
          const celdas = fila.querySelectorAll('td');
          const linkXml = fila.querySelector(selectores.LINK_XML);
          const linkPdf = fila.querySelector(selectores.LINK_PDF);

          if (origen === 'recibidos' && celdas.length >= 6) {
            const ruc = celdas[1]?.textContent?.trim().split('\n')[0] || '';
            const razonSocial = celdas[1]?.textContent?.trim().split('\n')[1] || '';
            const celda2Texto = celdas[2]?.textContent?.trim() || '';
            const tipoDoc = celda2Texto;
            // Extraer serie del texto (ej: "Factura  001-006-055715817" -> "001-006-055715817")
            const serieMatch = celda2Texto.match(/(\d{3}-\d{3}-\d+)/);
            const serie = serieMatch ? serieMatch[1] : '';
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
          } else if (origen === 'emitidos' && celdas.length >= 9) {
            // Emitidos: Nro | Tipo y serie | Clave acceso | Fecha/hora aut |
            // Fecha emision | Valor | IVA | Total | RIDE(pdf) | Docs relacionados.
            // No hay link XML: el XML se obtiene del WS con la clave de acceso.
            const celda1Texto = celdas[1]?.textContent?.trim() || '';
            const serieMatch = celda1Texto.match(/(\d{3}-\d{3}-\d+)/);
            const claveAcceso = celdas[2]?.textContent?.trim() || '';

            documentos.push({
              index,
              ruc: rucUsuario, // el emisor es el propio usuario
              razonSocial: '',
              tipoDoc: celda1Texto,
              serie: serieMatch ? serieMatch[1] : '',
              claveAcceso,
              fechaEmision: celdas[4]?.textContent?.trim() || '',
              fechaAutorizacion: celdas[3]?.textContent?.trim() || '',
              tieneXml: !!claveAcceso, // via web service
              tienePdf: !!linkPdf,
              linkXmlId: null,
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

        return { documentos, paginacion, rucUsuario, origen };
      },
      args: [SRI_CONFIG.SELECTORES, origen]
    });
    return resultado[0]?.result;
  } catch (e) {
    return { error: e.message };
  }
}

/**
 * Navega a la primera pagina del paginador PrimeFaces.
 * @param {number} tabId - Tab del SRI
 * @returns {Promise<boolean>} false solo si executeScript fallo
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
 * Navega a la siguiente pagina del paginador PrimeFaces.
 * @param {number} tabId - Tab del SRI
 * @returns {Promise<boolean>} true si el boton existia y se clickeo
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
 * Espera inteligente de paginacion: hace polling cada 500ms hasta que el
 * paginador muestre la pagina esperada, en vez de un delay fijo (el servidor
 * del SRI tiene latencia variable). Con timeout TIMEOUT_PAGINA como tope.
 * @param {number} tabId - Tab del SRI
 * @param {number} paginaEsperada - Numero de pagina que debe aparecer
 * @param {'recibidos'|'emitidos'} [origen='recibidos'] - Tabla consultada
 * @returns {Promise<boolean>} true si la pagina cambio; false por timeout o detencion
 */
async function esperarCambioPagina(tabId, paginaEsperada, origen = 'recibidos') {
  const inicio = Date.now();
  while (Date.now() - inicio < SRI_CONFIG.TIMEOUT_PAGINA) {
    // Responder de inmediato al boton Detener
    if (estadoDescarga.detenido) return false;
    const datos = await obtenerDatosPagina(tabId, origen);
    if (datos.paginacion?.actual === paginaEsperada) return true;
    await delay(500);
  }
  return false;
}

/**
 * Espera asincrona simple.
 * @param {number} ms - Milisegundos a esperar
 * @returns {Promise<void>}
 */
function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// --- Funciones de organizacion de archivos ---

/**
 * Sanitiza un nombre para usarlo como carpeta/archivo en Windows y Unix:
 * reemplaza caracteres invalidos, colapsa espacios y limita a 100 caracteres.
 * @param {string} nombre - Nombre original
 * @returns {string} Nombre seguro para el filesystem
 */
function sanitizarNombreCarpeta(nombre) {
  return nombre
    .replace(/[/\\:*?"<>|]/g, '_')
    .replace(/\s+/g, ' ')
    .trim()
    .substring(0, 100) || 'sin_nombre';
}

/**
 * Parsea una fecha del SRI en formato dd/mm/aaaa (o dd/mm/aaaa hh:mm:ss).
 * @param {string} fechaStr - Fecha como la muestra el SRI
 * @returns {{dia: string, mes: string, anio: string}|null} Partes de la fecha o null
 */
function parsearFechaSRI(fechaStr) {
  if (!fechaStr) return null;
  const partes = fechaStr.split('/');
  if (partes.length >= 3) {
    return { dia: partes[0], mes: partes[1], anio: partes[2].substring(0, 4) };
  }
  return null;
}

/**
 * Extrae solo el tipo de documento sin la serie
 * Ej: "Factura  001-001-034700490" -> "factura"
 * @param {string} tipoDoc - Tipo y serie del documento desde el DOM
 * @returns {string} Tipo de documento limpio en minusculas
 */
function limpiarTipoDoc(tipoDoc) {
  const tipoLimpio = (tipoDoc || 'sin_tipo').replace(/\s+\d{3}-\d{3}-\d+.*$/, '').trim();
  return sanitizarNombreCarpeta(tipoLimpio || 'sin_tipo').toLowerCase().replace(/\s+/g, '_');
}

/**
 * Construye el nombre del archivo segun el formato configurado.
 * @param {'claveAcceso'|'ruc_serie'|'razon_serie'} formato - Formato elegido
 * @param {Object} metadata - Metadata del documento (ruc, serie, razonSocial, claveAcceso)
 * @param {string} extension - Extension con punto (.xml, .pdf)
 * @returns {string} Nombre del archivo con extension
 */
function construirNombreArchivo(formato, metadata, extension) {
  switch (formato) {
    case 'ruc_serie': {
      const ruc = metadata.ruc || 'sin_ruc';
      const serie = (metadata.serie || 'sin_serie').replace(/[-\s]+/g, '');
      return `${ruc}_${serie}${extension}`;
    }
    case 'razon_serie': {
      const razon = sanitizarNombreCarpeta(metadata.razonSocial || 'sin_razon').replace(/\s+/g, '_');
      const serie = (metadata.serie || 'sin_serie').replace(/[-\s]+/g, '');
      return `${razon}_${serie}${extension}`;
    }
    case 'claveAcceso':
    default:
      return `${metadata.claveAcceso || 'sin_clave'}${extension}`;
  }
}

/**
 * Construye la ruta completa del archivo organizado.
 * Estructura: carpetaRaiz / [ruc+fecha o fecha+ruc] / [recibidos|emitidos] / tipoDoc / [xml|pdf] / nombre.ext
 * El nivel recibidos/emitidos sale de metadata.origen.
 * @param {Object} metadata - Metadata del documento (incluye origen y rucUsuario)
 * @param {'xml'|'pdf'} tipoArchivo - Formato del archivo
 * @param {string} extension - Extension del archivo con punto (.xml, .pdf)
 * @returns {string|null} Ruta relativa completa o null si organizacion deshabilitada
 */
function construirRutaArchivo(metadata, tipoArchivo, extension) {
  if (!SRI_CONFIG.ORGANIZACION?.HABILITADO) return null;

  const org = SRI_CONFIG.ORGANIZACION;
  const fechaParsed = parsearFechaSRI(metadata.fechaEmision);
  const ruc = metadata.rucUsuario || 'sin_ruc';
  const anio = fechaParsed?.anio || 'sin_anio';
  const mes = fechaParsed?.mes || 'sin_mes';

  const segmentos = [org.CARPETA_RAIZ || 'descargas_sri'];

  // Niveles configurables: orden del RUC y fecha
  if (org.ORDEN === 'fecha_ruc') {
    segmentos.push(anio, mes, ruc);
  } else {
    segmentos.push(ruc, anio, mes);
  }

  // Niveles fijos: tipo movimiento / tipo documento / tipo archivo
  segmentos.push(metadata.origen === 'emitidos' ? 'emitidos' : 'recibidos');
  segmentos.push(limpiarTipoDoc(metadata.tipoDoc));
  segmentos.push(tipoArchivo === 'xml' ? 'xml' : 'pdf');

  // Nombre del archivo
  segmentos.push(construirNombreArchivo(org.FORMATO_NOMBRE, metadata, extension));

  return segmentos.join('/');
}

/**
 * Actualiza el badge del icono de la extension con el conteo de exitosos
 * (verde sin fallos, naranja con fallos). Al terminar la descarga limpia el
 * badge tras 5s, salvo que otra descarga haya empezado en ese lapso.
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
 * Notifica el progreso al popup via mensaje 'estadoDescarga'. El catch vacio
 * es intencional: si el popup esta cerrado no hay receptor y sendMessage
 * rechaza, lo cual es normal (la descarga sigue en el background).
 */
function notificarProgreso() {
  chrome.runtime.sendMessage({
    action: 'estadoDescarga',
    estado: { ...estadoDescarga }
  }).catch(() => {});
}

/**
 * Calcula el tiempo estimado restante segun el promedio por documento
 * de lo transcurrido en la sesion actual.
 * @returns {number|null} Milisegundos estimados o null si aun no hay datos
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
 * Envia una notificacion nativa de Chrome al finalizar la descarga
 * (funciona aunque el popup este cerrado).
 */
function notificarFinalizacion() {
  // Priorizar el motivo del error si la descarga termino de forma anomala
  const mensaje = estadoDescarga.error
    ? `Error: ${estadoDescarga.error}`
    : estadoDescarga.detenido
      ? `Detenido: ${estadoDescarga.exitosos} OK, ${estadoDescarga.fallidos} fallidos`
      : `Completado: ${estadoDescarga.exitosos} OK, ${estadoDescarga.fallidos} fallidos`;

  chrome.notifications.create({
    type: 'basic',
    iconUrl: 'icons/icon128.png',
    title: 'Descargador de Comprobantes SRI',
    message: mensaje
  });
}

/**
 * Procesa un documento: dedup, descarga XML/PDF segun tipo, registra en buffer.
 *
 * exitoXml/exitoPdf usan null = no se intento ese formato (no solicitado o sin
 * link), true/false = resultado real. Asi la deduplicacion no confunde
 * "no intentado" con "descargado" ni "fallido" (ver construirIndiceDescargados).
 *
 * En emitidos el XML no se descarga desde la pagina (no existe link) sino
 * consultando el web service de autorizacion con la clave de acceso.
 * @param {number} tabId - Tab del SRI
 * @param {Object} doc - Documento extraido de la tabla
 * @param {'xml'|'pdf'|'ambos'} tipoDescarga - Formatos solicitados
 * @param {number} pagina - Numero de pagina de donde salio el documento
 * @param {'recibidos'|'emitidos'} [origen='recibidos'] - Pantalla de origen
 * @returns {Promise<void>}
 */
async function procesarDocumento(tabId, doc, tipoDescarga, pagina, origen = 'recibidos') {
  estadoDescarga.documentoActual++;

  // Verificar si ya fue descargado (O(1) con Set)
  if (indiceDescargados.has(doc.claveAcceso)) {
    estadoDescarga.omitidos++;
    estadoDescarga.tiempoEstimado = calcularTiempoEstimado();
    actualizarBadge();
    notificarProgreso();
    return;
  }

  const esEmitidos = origen === 'emitidos';
  const intentaXml = (tipoDescarga === 'xml' || tipoDescarga === 'ambos') && doc.tieneXml;
  const intentaPdf = (tipoDescarga === 'pdf' || tipoDescarga === 'ambos') && doc.tienePdf;

  let exitoXml = null;
  let exitoPdf = null;
  let errorMsg = null;

  try {
    // Metadata del documento para organizar archivos
    const docMeta = {
      claveAcceso: doc.claveAcceso,
      ruc: doc.ruc,
      razonSocial: doc.razonSocial,
      tipoDoc: doc.tipoDoc,
      serie: doc.serie,
      fechaEmision: doc.fechaEmision,
      rucUsuario: estadoDescarga.rucUsuario,
      origen: origen
    };

    // Descargar XML con reintentos. En emitidos no hay link en la pagina:
    // se obtiene el XML autorizado del web service con la clave de acceso.
    if (intentaXml) {
      exitoXml = esEmitidos
        ? await descargarXmlEmitidoConReintento(doc.claveAcceso, docMeta)
        : await ejecutarConReintento(tabId, doc.linkXmlId, docMeta, 'xml');
      if (!exitoXml) errorMsg = 'Error descargando XML';
      await delay(SRI_CONFIG.DELAY_DESCARGA);
    }

    // Descargar PDF con reintentos
    if (intentaPdf) {
      exitoPdf = await ejecutarConReintento(tabId, doc.linkPdfId, docMeta, 'pdf');
      if (!exitoPdf) errorMsg = errorMsg ? 'Error descargando XML y PDF' : 'Error descargando PDF';
      await delay(SRI_CONFIG.DELAY_DESCARGA);
    }

  } catch (e) {
    if (intentaXml && exitoXml !== true) exitoXml = false;
    if (intentaPdf && exitoPdf !== true) exitoPdf = false;
    errorMsg = e.message;
  }

  // Exito si nada de lo intentado fallo
  const exito = exitoXml !== false && exitoPdf !== false;

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
    pagina: pagina,
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

/**
 * Procesa todas las paginas de la tabla actualmente consultada en el SRI.
 * Asume que estadoDescarga ya esta inicializado. Acumula sobre
 * estadoDescarga.totalDocumentos para soportar varias consultas en una
 * misma sesion (modo mes de emitidos, que llama esta funcion una vez por dia).
 * Guarda el buffer a storage al terminar cada pagina para no perder registro
 * si Chrome termina el service worker MV3 durante una descarga larga.
 * @param {number} tabId - Tab del SRI
 * @param {'xml'|'pdf'|'ambos'} tipoDescarga - Formatos solicitados
 * @param {'recibidos'|'emitidos'} origen - Pantalla/tabla a procesar
 * @returns {Promise<string|null>} Mensaje de error o null si todo fue bien
 */
async function procesarPaginasActuales(tabId, tipoDescarga, origen) {
  let datos = await obtenerDatosPagina(tabId, origen);
  if (datos.error) return datos.error;

  if (!estadoDescarga.rucUsuario || estadoDescarga.rucUsuario === 'desconocido') {
    estadoDescarga.rucUsuario = datos.rucUsuario;
    bufferSesion.rucUsuario = datos.rucUsuario;
  }

  const totalPaginas = datos.paginacion.total;
  estadoDescarga.totalPaginas = totalPaginas;

  // Estimar total de documentos (docs en pagina actual * total paginas),
  // acumulando sobre lo contado en consultas anteriores de esta sesion
  const docsPorPagina = datos.documentos.length;
  const base = estadoDescarga.totalDocumentos;
  estadoDescarga.totalDocumentos = base + docsPorPagina * totalPaginas;

  // Ir a primera pagina si no estamos en ella
  if (datos.paginacion.actual > 1) {
    await navegarPrimera(tabId);
    await esperarCambioPagina(tabId, 1, origen);
  }

  // Procesar todas las paginas
  for (let pag = 1; pag <= totalPaginas; pag++) {
    if (estadoDescarga.detenido) break;

    estadoDescarga.paginaActual = pag;

    // Obtener documentos de pagina actual
    datos = await obtenerDatosPagina(tabId, origen);
    if (datos.error) return datos.error;

    // Ajustar el total real al llegar a la ultima pagina (puede estar incompleta)
    if (pag === totalPaginas) {
      estadoDescarga.totalDocumentos = base + (pag - 1) * docsPorPagina + datos.documentos.length;
    }

    // Descargar documentos de esta pagina
    for (const doc of datos.documentos) {
      if (estadoDescarga.detenido) break;
      await procesarDocumento(tabId, doc, tipoDescarga, pag, origen);
    }

    // Guardar progreso parcial (protege contra terminacion del service worker)
    await guardarBufferAlStorage(false);

    // Ir a siguiente pagina si hay mas
    if (pag < totalPaginas && !estadoDescarga.detenido) {
      await navegarSiguiente(tabId);
      const cambioOk = await esperarCambioPagina(tabId, pag + 1, origen);
      if (!cambioOk) {
        await delay(SRI_CONFIG.DELAY_PAGINA);
      }
    }
  }

  return null;
}

/**
 * Proceso principal de descarga: todas las paginas de la consulta en pantalla.
 * Corre en el background para sobrevivir al cierre del popup.
 * @param {number} tabId - Tab del SRI con la consulta ejecutada
 * @param {'xml'|'pdf'|'ambos'} tipoDescarga - Formatos solicitados
 * @param {boolean} [ignorarHistorial=false] - true re-descarga todo (indice de dedup vacio)
 * @param {'recibidos'|'emitidos'} [origen='recibidos'] - Pantalla de origen
 * @returns {Promise<void>}
 */
async function descargarTodasLasPaginas(tabId, tipoDescarga, ignorarHistorial = false, origen = 'recibidos') {
  // Cargar configuracion del usuario
  await cargarConfigUsuario();

  // Limpiar historial antiguo al iniciar (await para evitar carrera de
  // escritura con el guardado incremental del buffer)
  await limpiarHistorialAntiguo();

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
    origen: origen,
    tabId: tabId,
    sesionId: sesionId,
    rucUsuario: null,
    timestampInicio: Date.now(),
    tiempoEstimado: null,
    error: null
  };

  actualizarBadge();
  notificarProgreso();

  const error = await procesarPaginasActuales(tabId, tipoDescarga, origen);
  if (error) {
    estadoDescarga.error = error;
  }

  // Guardar buffer al storage
  await guardarBufferAlStorage(true);

  // Limpiar metadata map
  downloadMetadataMap.clear();

  estadoDescarga.activo = false;
  estadoDescarga.tiempoEstimado = null;

  actualizarBadge();
  notificarProgreso();
  notificarFinalizacion();
}

/**
 * Descarga solo los documentos seleccionados (por clave de acceso) de la
 * pagina actual. La seleccion es explicita del usuario, asi que no se
 * aplica deduplicacion contra el historial.
 * @param {number} tabId - Tab del SRI
 * @param {'xml'|'pdf'|'ambos'} tipoDescarga - Formatos solicitados
 * @param {string[]} claves - Claves de acceso marcadas en el popup
 * @param {'recibidos'|'emitidos'} [origen='recibidos'] - Pantalla de origen
 * @returns {Promise<void>}
 */
async function descargarSeleccionados(tabId, tipoDescarga, claves, origen = 'recibidos') {
  await cargarConfigUsuario();
  await limpiarHistorialAntiguo();

  const sesionId = generarSesionId();
  bufferSesion = { documentos: [], rucUsuario: null };
  indiceDescargados = new Set();

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
    origen: origen,
    tabId: tabId,
    sesionId: sesionId,
    rucUsuario: null,
    timestampInicio: Date.now(),
    tiempoEstimado: null,
    error: null
  };

  actualizarBadge();
  notificarProgreso();

  const datos = await obtenerDatosPagina(tabId, origen);
  if (datos.error) {
    estadoDescarga.activo = false;
    estadoDescarga.error = datos.error;
    actualizarBadge();
    notificarProgreso();
    return;
  }

  estadoDescarga.rucUsuario = datos.rucUsuario;
  bufferSesion.rucUsuario = datos.rucUsuario;
  estadoDescarga.paginaActual = datos.paginacion?.actual || 1;
  estadoDescarga.totalPaginas = estadoDescarga.paginaActual;

  const setClaves = new Set(claves);
  const docs = datos.documentos.filter(d => setClaves.has(d.claveAcceso));
  estadoDescarga.totalDocumentos = docs.length;

  for (const doc of docs) {
    if (estadoDescarga.detenido) break;
    await procesarDocumento(tabId, doc, tipoDescarga, estadoDescarga.paginaActual, origen);
  }

  await guardarBufferAlStorage(true);
  downloadMetadataMap.clear();

  estadoDescarga.activo = false;
  estadoDescarga.tiempoEstimado = null;

  actualizarBadge();
  notificarProgreso();
  notificarFinalizacion();
}

/**
 * Setea la fecha en el formulario de emitidos y pulsa Consultar (MAIN world,
 * porque el CSP del SRI bloquea scripts inline y el evento change debe llegar
 * al JSF de la pagina).
 *
 * Antes de consultar marca la tabla y el contenedor .ui-messages con el
 * atributo data-sri-esperando: el AJAX de PrimeFaces reemplaza esos nodos al
 * responder, asi que la DESAPARICION del atributo es la senal de que llego la
 * respuesta nueva. Sin el marcador no se podria distinguir la tabla/mensaje
 * viejos de los nuevos (dias consecutivos pueden verse identicos). Los
 * atributos DOM son visibles entre el world MAIN y el ISOLATED, por eso se
 * usa un atributo y no una variable JS.
 * @param {number} tabId - Tab del SRI
 * @param {string} fechaStr - Fecha en formato dd/mm/aaaa
 * @returns {Promise<boolean>} true si se pudo disparar la consulta
 */
function setearFechaYConsultar(tabId, fechaStr) {
  return chrome.scripting.executeScript({
    target: { tabId: tabId },
    world: 'MAIN',
    func: (fecha, selectores) => {
      const inp = document.querySelector(selectores.EMITIDOS_FECHA_INPUT);
      const btn = document.querySelector(selectores.EMITIDOS_BTN_CONSULTAR);
      if (!inp || !btn) return false;

      inp.value = fecha;
      inp.dispatchEvent(new Event('change', { bubbles: true }));

      // Marcar tabla y contenedor de mensajes: cuando el AJAX los reemplace,
      // el atributo desaparece (permite detectar dias con y sin datos)
      const tabla = document.querySelector(selectores.TABLA_EMITIDOS);
      if (tabla) tabla.setAttribute('data-sri-esperando', '1');
      const msgs = document.querySelector('.ui-messages');
      if (msgs) msgs.setAttribute('data-sri-esperando', '1');

      btn.click();
      return true;
    },
    args: [fechaStr, SRI_CONFIG.SELECTORES]
  }).then(r => r[0]?.result === true).catch(() => false);
}

/**
 * Espera (polling cada 500ms) a que el AJAX de la consulta de emitidos
 * termine, detectado por la desaparicion del atributo marcador
 * data-sri-esperando en la tabla o en el contenedor de mensajes
 * (ver setearFechaYConsultar).
 * @param {number} tabId - Tab del SRI
 * @returns {Promise<'datos'|'vacio'|'timeout'>} 'datos' si hay tabla nueva,
 *   'vacio' si el SRI respondio "No existen datos", 'timeout' si no se supo
 *   (tambien al detener manualmente, para salir del bucle de inmediato)
 */
async function esperarResultadosEmitidos(tabId) {
  const inicio = Date.now();
  while (Date.now() - inicio < SRI_CONFIG.TIMEOUT_PAGINA) {
    // Responder de inmediato al boton Detener
    if (estadoDescarga.detenido) return 'timeout';
    try {
      const r = await chrome.scripting.executeScript({
        target: { tabId: tabId },
        func: (selectores) => {
          const tabla = document.querySelector(selectores.TABLA_EMITIDOS);
          if (tabla && !tabla.hasAttribute('data-sri-esperando')) return 'datos';
          // Dia sin comprobantes: mensaje nuevo (sin marcador) "No existen datos"
          const msgs = document.querySelector('.ui-messages');
          if (msgs && !msgs.hasAttribute('data-sri-esperando') && /No existen datos/i.test(msgs.textContent)) return 'vacio';
          return null;
        },
        args: [SRI_CONFIG.SELECTORES]
      });
      if (r[0]?.result === 'datos' || r[0]?.result === 'vacio') return r[0].result;
    } catch (e) {
      // Tab ocupada o navegando; reintentar
    }
    await delay(500);
  }
  return 'timeout';
}

/**
 * Verifica si la pantalla de emitidos muestra "No existen datos para los
 * parametros ingresados" (dia sin comprobantes). Se usa como confirmacion
 * cuando el marcador no alcanzo a detectar la respuesta (timeout) o cuando
 * procesarPaginasActuales no encontro tabla.
 * @param {number} tabId - Tab del SRI
 * @returns {Promise<boolean>} true si el mensaje esta visible en la pagina
 */
async function verificarSinDatosEmitidos(tabId) {
  try {
    const r = await chrome.scripting.executeScript({
      target: { tabId: tabId },
      func: () => /No existen datos/i.test(document.body.innerText)
    });
    return r[0]?.result === true;
  } catch (e) {
    return false;
  }
}

/**
 * Descarga los comprobantes emitidos de un mes completo. El formulario del
 * SRI solo acepta UNA fecha por consulta (no un rango), asi que se consulta
 * y descarga dia por dia. La iteracion llega solo hasta AYER: el SRI rechaza
 * consultar el dia en curso ("la fecha debe ser menor a la fecha actual").
 *
 * Manejo por dia:
 * - 'vacio' (mensaje "No existen datos"): se salta al siguiente dia.
 * - 'timeout': margen extra y re-verificacion; si el SRI muestra "No existen
 *   datos", se salta el dia.
 * - Error de procesarPaginasActuales: solo se continua si en realidad fue un
 *   dia sin datos; cualquier otro fallo (sesion caida, cambio de pantalla)
 *   aborta el mes para no enmascarar errores reales.
 * La deduplicacion omite lo ya descargado salvo que ignorarHistorial sea true.
 * @param {number} tabId - Tab del SRI (debe estar en la pantalla de emitidos)
 * @param {'xml'|'pdf'|'ambos'} tipoDescarga - Formatos solicitados
 * @param {boolean} ignorarHistorial - Re-descargar aunque ya exista
 * @param {number} anio - Anio del mes a descargar
 * @param {number} mes - Mes 1-12
 * @returns {Promise<void>}
 */
async function descargarEmitidosMes(tabId, tipoDescarga, ignorarHistorial, anio, mes) {
  await cargarConfigUsuario();
  await limpiarHistorialAntiguo();

  const sesionId = generarSesionId();
  bufferSesion = { documentos: [], rucUsuario: null };
  indiceDescargados = ignorarHistorial ? new Set() : await construirIndiceDescargados(tipoDescarga);

  const totalDias = new Date(anio, mes, 0).getDate();

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
    diaActual: 0,
    totalDias: totalDias,
    tipoDescarga: tipoDescarga,
    origen: 'emitidos',
    tabId: tabId,
    sesionId: sesionId,
    rucUsuario: null,
    timestampInicio: Date.now(),
    tiempoEstimado: null,
    error: null
  };

  actualizarBadge();
  notificarProgreso();

  // Iterar desde el dia 1 hasta UN DIA ANTES del actual: consultar el dia
  // en curso da error en el SRI
  const hoy = new Date();
  const inicioHoy = new Date(hoy.getFullYear(), hoy.getMonth(), hoy.getDate());
  let diasProcesados = 0;

  for (let dia = 1; dia <= totalDias; dia++) {
    if (estadoDescarga.detenido) break;
    if (new Date(anio, mes - 1, dia) >= inicioHoy) break;

    diasProcesados++;
    estadoDescarga.diaActual = dia;
    estadoDescarga.paginaActual = 1;
    notificarProgreso();

    const fechaStr = `${String(dia).padStart(2, '0')}/${String(mes).padStart(2, '0')}/${anio}`;

    const consultado = await setearFechaYConsultar(tabId, fechaStr);
    if (!consultado) {
      estadoDescarga.error = `No se pudo consultar el dia ${fechaStr}. Verifica estar en la pantalla de emitidos.`;
      break;
    }

    const resultado = await esperarResultadosEmitidos(tabId);
    if (estadoDescarga.detenido) break;

    // Dia sin comprobantes (mensaje "No existen datos" detectado): siguiente dia
    if (resultado === 'vacio') continue;

    // Timeout: dar margen extra; si el SRI muestra "No existen datos", saltar
    if (resultado === 'timeout') {
      await delay(SRI_CONFIG.DELAY_PAGINA);
      if (estadoDescarga.detenido) break;
      if (await verificarSinDatosEmitidos(tabId)) continue;
    }

    const error = await procesarPaginasActuales(tabId, tipoDescarga, 'emitidos');
    if (error) {
      // Continuar SOLO si el SRI realmente respondio "No existen datos"
      // (dia sin comprobantes); cualquier otro fallo aborta para no
      // enmascarar errores reales (sesion caida, cambio de pantalla, etc.)
      if (await verificarSinDatosEmitidos(tabId)) continue;
      estadoDescarga.error = error;
      break;
    }
  }

  // Caso borde: mes actual y hoy es dia 1 → no hay dias anteriores a hoy
  // que consultar; avisar en vez de terminar en silencio con 0 documentos
  if (diasProcesados === 0 && !estadoDescarga.detenido && !estadoDescarga.error) {
    estadoDescarga.error = 'El mes seleccionado no tiene dias anteriores a hoy para consultar.';
  }

  await guardarBufferAlStorage(true);
  downloadMetadataMap.clear();

  estadoDescarga.activo = false;
  estadoDescarga.tiempoEstimado = null;

  actualizarBadge();
  notificarProgreso();
  notificarFinalizacion();
}

// Escuchar mensajes del popup. Los handlers sincronos responden y retornan
// false; los que consultan storage retornan true para mantener el canal de
// sendResponse abierto hasta que la promesa resuelva.
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {

  if (request.action === 'iniciarDescargaTotal') {
    if (estadoDescarga.activo) {
      sendResponse({ status: 'ocupado' });
      return false;
    }
    descargarTodasLasPaginas(request.tabId, request.tipoDescarga, request.ignorarHistorial || false, request.origen || 'recibidos');
    sendResponse({ status: 'iniciado' });
    return false;
  }

  if (request.action === 'iniciarDescargaSeleccionados') {
    if (estadoDescarga.activo) {
      sendResponse({ status: 'ocupado' });
      return false;
    }
    descargarSeleccionados(request.tabId, request.tipoDescarga, request.claves || [], request.origen || 'recibidos');
    sendResponse({ status: 'iniciado' });
    return false;
  }

  if (request.action === 'iniciarDescargaEmitidosMes') {
    if (estadoDescarga.activo) {
      sendResponse({ status: 'ocupado' });
      return false;
    }
    descargarEmitidosMes(request.tabId, request.tipoDescarga, request.ignorarHistorial || false, request.anio, request.mes);
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

  // Nota: el popup actual ya no envia 'obtenerFallidos' (reintentar fallidos
  // ahora relanza una descarga total y la deduplicacion omite los exitosos);
  // se mantiene el handler por compatibilidad
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

  // Navegar a la pantalla de comprobantes emitidos. Se navega a
  // accederAplicacion.jspa (redireccion=60) y NO a la URL directa del .jsf:
  // accederAplicacion hace el handshake SSO que inicializa la sesion de la
  // aplicacion de comprobantes; la URL directa rebota al login si esa sesion
  // no existe. El destino es menu.jsf con un menu de seleccion; al cargar se
  // hace click en la opcion "Comprobantes electronicos emitidos", se
  // preselecciona el tipo de comprobante y se consulta automaticamente
  if (request.action === 'navegarAEmitidos') {
    const tabId = request.tabId;
    const tipoComprobante = request.tipoComprobante || null;
    chrome.tabs.update(tabId, { url: request.url });

    const listener = (updatedTabId, changeInfo) => {
      if (updatedTabId === tabId && changeInfo.status === 'complete') {
        chrome.tabs.onUpdated.removeListener(listener);
        // Reintentar cada 1s (max 10) porque la pagina SRI carga contenido
        // con AJAX y el click en el menu intermedio tarda en surtir efecto
        let intentos = 0;
        const intervalo = setInterval(() => {
          intentos++;
          chrome.scripting.executeScript({
            target: { tabId },
            world: 'MAIN',
            func: (tipoComprobante) => {
              // Ya estamos en la pantalla de emitidos: consultar de una vez
              // (no hay captcha). El form trae la fecha de HOY por defecto y
              // el SRI la rechaza ("debe ser menor a la fecha actual"), asi
              // que se consulta el primer dia del mes (o ayer si hoy es dia 1)
              const inp = document.getElementById('frmPrincipal:calendarFechaDesde_input');
              if (inp) {
                const hoy = new Date();
                let fecha = new Date(hoy.getFullYear(), hoy.getMonth(), 1);
                if (hoy.getDate() === 1) {
                  fecha = new Date(hoy.getFullYear(), hoy.getMonth(), 0); // ultimo dia del mes anterior
                }
                const dd = String(fecha.getDate()).padStart(2, '0');
                const mm = String(fecha.getMonth() + 1).padStart(2, '0');
                inp.value = `${dd}/${mm}/${fecha.getFullYear()}`;
                inp.dispatchEvent(new Event('change', { bubbles: true }));

                // Preseleccionar el tipo de comprobante elegido en el menu
                if (tipoComprobante) {
                  const sel = document.getElementById('frmPrincipal:cmbTipoComprobante');
                  if (sel) {
                    sel.value = tipoComprobante;
                    sel.dispatchEvent(new Event('change', { bubbles: true }));
                  }
                }

                // Margen breve por si el cambio de tipo dispara AJAX propio
                setTimeout(() => {
                  document.getElementById('frmPrincipal:btnConsultar')?.click();
                }, 800);
                return true;
              }
              // Menu intermedio: click en la opcion de emitidos (la siguiente
              // iteracion del intervalo hara la consulta automatica)
              const link = Array.from(document.querySelectorAll('#consultaDocumentoForm a'))
                .find(a => /emitidos/i.test(a.textContent));
              if (link) link.click();
              return false;
            },
            args: [tipoComprobante]
          }).then(result => {
            if (result?.[0]?.result || intentos >= 10) {
              clearInterval(intervalo);
            }
          }).catch(() => clearInterval(intervalo));
        }, 1000);
      }
    };
    chrome.tabs.onUpdated.addListener(listener);

    sendResponse({ status: 'navegando' });
    return false;
  }

  // Navegar a comprobantes recibidos y setear dia = "Todos" + tipo de comprobante
  if (request.action === 'navegarYSetearDia') {
    const tabId = request.tabId;
    const tipoComprobante = request.tipoComprobante || null;
    chrome.tabs.update(tabId, { url: request.url });

    // Esperar a que la pagina cargue y setear los selects del formulario
    const listener = (updatedTabId, changeInfo) => {
      if (updatedTabId === tabId && changeInfo.status === 'complete') {
        chrome.tabs.onUpdated.removeListener(listener);
        // Reintentar varias veces porque la pagina SRI carga contenido con AJAX
        let intentos = 0;
        const intervalo = setInterval(() => {
          intentos++;
          chrome.scripting.executeScript({
            target: { tabId },
            world: 'MAIN',
            func: (tipo) => {
              const selDia = document.getElementById('frmPrincipal:dia');
              if (!selDia) return false;
              // Setear dia = "Todos"
              selDia.value = '0';
              selDia.dispatchEvent(new Event('change', { bubbles: true }));
              // Setear tipo de comprobante si se especifico
              if (tipo) {
                const selTipo = document.getElementById('frmPrincipal:cmbTipoComprobante');
                if (selTipo) {
                  selTipo.value = tipo;
                  selTipo.dispatchEvent(new Event('change', { bubbles: true }));
                }
              }
              return true;
            },
            args: [tipoComprobante]
          }).then(result => {
            if (result?.[0]?.result || intentos >= 10) {
              clearInterval(intervalo);
            }
          }).catch(() => clearInterval(intervalo));
        }, 1000);
      }
    };
    chrome.tabs.onUpdated.addListener(listener);

    sendResponse({ status: 'navegando' });
    return false;
  }

  return false;
});

// Evento cuando se instala la extension
chrome.runtime.onInstalled.addListener(() => {
  // Cargar config del usuario al instalar/actualizar
  cargarConfigUsuario();
});
