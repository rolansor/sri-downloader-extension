/**
 * Descargador de Comprobantes SRI - Popup Script
 * Maneja la interfaz de usuario del popup de la extension.
 * Se comunica con el background service worker para iniciar/detener descargas
 * y con el content script para obtener datos de la pagina actual del SRI.
 */

/** @type {Array<Object>} Lista de documentos extraidos de la tabla del SRI en la pagina actual */
let documentos = [];

/** @type {{actual: number, total: number}} Informacion de paginacion de la tabla del SRI */
let paginacion = { actual: 1, total: 1 };

/** @type {'recibidos'|'emitidos'} Pantalla del SRI detectada en la tab activa */
let origenDetectado = 'recibidos';

// =====================================================
// Referencias a elementos del DOM del popup
// =====================================================

/** Contenedor del mensaje de estado (info, error, success) */
const statusBox = document.getElementById('statusBox');
/** Texto del mensaje de estado */
const statusMessage = document.getElementById('statusMessage');
/** Area principal que muestra la lista de documentos y controles de descarga */
const contentArea = document.getElementById('contentArea');
/** Muestra el total de documentos encontrados en la pagina actual */
const totalDocs = document.getElementById('totalDocs');
/** Muestra la pagina actual y total de la paginacion del SRI */
const paginaInfo = document.getElementById('paginaInfo');
/** Contenedor de la lista de documentos con checkboxes */
const docList = document.getElementById('docList');
/** Checkbox para seleccionar/deseleccionar todos los documentos */
const selectAll = document.getElementById('selectAll');
/** Boton para iniciar descarga total del origen detectado (respeta historial) */
const btnDescargarTodo = document.getElementById('btnDescargarTodo');
/** Contenedor de opciones dia/mes (solo visible en emitidos) */
const opcionesEmitidos = document.getElementById('opcionesEmitidos');
/** Input de mes para la descarga mensual de emitidos */
const mesEmitidos = document.getElementById('mesEmitidos');
/** Boton para iniciar descarga ignorando el historial (re-descarga todo) */
const btnDescargarSinHistorial = document.getElementById('btnDescargarSinHistorial');
/** Boton para descargar solo los documentos seleccionados de la pagina actual */
const btnDescargarSeleccionados = document.getElementById('btnDescargarSeleccionados');
/** Boton para detener la descarga en progreso */
const btnDetener = document.getElementById('btnDetener');
/** Contenedor de la barra de progreso */
const progressContainer = document.getElementById('progressContainer');
/** Elemento visual de relleno de la barra de progreso */
const progressFill = document.getElementById('progressFill');
/** Texto informativo dentro de la barra de progreso */
const progressText = document.getElementById('progressText');
/** Contenedor de los botones de descarga (se oculta durante descarga activa) */
const controlesDescarga = document.getElementById('controlesDescarga');
/** Area/tab del historial de descargas */
const historialArea = document.getElementById('historialArea');
/** Contenedor donde se renderizan los items del historial */
const listaHistorial = document.getElementById('listaHistorial');
/** Boton para limpiar todo el historial de descargas */
const btnLimpiarHistorial = document.getElementById('btnLimpiarHistorial');
/** Boton para exportar el historial a archivo CSV */
const btnExportarHistorial = document.getElementById('btnExportarHistorial');
/** Boton para reintentar la descarga de documentos fallidos */
const btnReintentarFallidos = document.getElementById('btnReintentarFallidos');
/** Contenedor del resumen del historial (conteo de exitosos/fallidos) */
const resumenHistorial = document.getElementById('resumenHistorial');
/** Texto del resumen del historial */
const resumenTexto = document.getElementById('resumenTexto');
/** Area/tab de configuracion de tiempos y reintentos */
const configArea = document.getElementById('configArea');
/** Area/tab de organizacion de archivos descargados */
const organizacionArea = document.getElementById('organizacionArea');
/** Area de accesos directos a paginas del SRI */
const sriLinksArea = document.getElementById('sriLinksArea');
/** Boton para guardar la configuracion */
const btnGuardarConfig = document.getElementById('btnGuardarConfig');
/** Boton para restaurar la configuracion a valores por defecto */
const btnResetConfig = document.getElementById('btnResetConfig');
/** Elemento para mostrar mensajes de estado de la configuracion */
const configStatus = document.getElementById('configStatus');

// =====================================================
// Funciones de utilidad y UI
// =====================================================

/**
 * Muestra el panel de accesos directos SRI y oculta todo lo demas.
 * Se invoca cuando no hay tabla de comprobantes disponible.
 */
function mostrarSriLinks() {
  contentArea.style.display = 'none';
  historialArea.style.display = 'none';
  configArea.style.display = 'none';
  organizacionArea.style.display = 'none';
  sriLinksArea.style.display = 'block';
  // Ocultar tabs cuando no hay tabla
  document.querySelector('.tabs').style.display = 'none';
  renderSriMenu();
}

/**
 * Muestra un mensaje de estado en el popup con un estilo visual segun el tipo.
 * @param {string} mensaje - Texto del mensaje a mostrar
 * @param {'info'|'error'|'success'} [tipo='info'] - Tipo de mensaje que define el estilo CSS
 */
function mostrarEstado(mensaje, tipo = 'info') {
  statusBox.className = `status-box ${tipo}`;
  statusMessage.textContent = mensaje;
  statusBox.style.display = 'block';
}

/**
 * Obtiene el tipo de descarga seleccionado por el usuario en los radio buttons.
 * @returns {'xml'|'pdf'|'ambos'} Tipo de descarga seleccionado
 */
function getTipoDescarga() {
  return document.querySelector('input[name="tipoDescarga"]:checked').value;
}

/**
 * Obtiene los indices de los documentos seleccionados mediante checkboxes.
 * @returns {number[]} Array con los indices de documentos marcados
 */
function getIndicesSeleccionados() {
  const checkboxes = docList.querySelectorAll('input[type="checkbox"]:checked');
  return Array.from(checkboxes).map(cb => parseInt(cb.dataset.index));
}

/**
 * Renderiza la lista de documentos en el popup.
 * Construye el DOM de forma segura (sin innerHTML) para evitar XSS.
 * Cada documento se muestra con un checkbox, tipo/serie, RUC y fecha.
 */
function renderizarDocumentos() {
  docList.innerHTML = '';

  documentos.forEach(doc => {
    // Crear contenedor del item
    const item = document.createElement('div');
    item.className = 'doc-item';

    // Checkbox de seleccion individual
    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.dataset.index = doc.index;
    checkbox.checked = true;

    // Contenedor de informacion del documento
    const info = document.createElement('div');
    info.className = 'doc-info';

    // Tipo de documento y serie
    const tipo = document.createElement('div');
    tipo.className = 'doc-tipo';
    tipo.textContent = doc.tipoYSerie || 'Sin informacion';

    // RUC del emisor y fecha de emision
    const ruc = document.createElement('div');
    ruc.className = 'doc-ruc';
    ruc.textContent = `RUC: ${doc.ruc || 'N/A'} | Fecha: ${doc.fecha || 'N/A'}`;

    info.appendChild(tipo);
    info.appendChild(ruc);
    item.appendChild(checkbox);
    item.appendChild(info);
    docList.appendChild(item);
  });

  // Marcar "seleccionar todo" como activo por defecto
  selectAll.checked = true;
}

/**
 * Formatea milisegundos a un texto legible de tiempo restante.
 * @param {number} ms - Milisegundos a formatear
 * @returns {string|null} Texto formateado (ej: "~2:30 restantes") o null si no hay tiempo valido
 */
function formatearTiempo(ms) {
  if (!ms || ms <= 0) return null;
  const totalSeg = Math.ceil(ms / 1000);
  const min = Math.floor(totalSeg / 60);
  const seg = totalSeg % 60;
  if (min > 0) {
    return `~${min}:${seg.toString().padStart(2, '0')} restantes`;
  }
  return `~${seg}s restantes`;
}

// =====================================================
// Gestion del estado de descarga y progreso
// =====================================================

/**
 * Actualiza toda la interfaz del popup segun el estado actual de descarga
 * recibido desde el background service worker.
 * Maneja dos estados principales: descarga activa y descarga finalizada/inactiva.
 * @param {Object} estado - Estado de descarga del background
 * @param {boolean} estado.activo - Si hay una descarga en progreso
 * @param {number} estado.totalDocumentos - Total de documentos a descargar
 * @param {number} estado.documentoActual - Indice del documento actual
 * @param {number} estado.paginaActual - Pagina actual siendo procesada
 * @param {number} estado.totalPaginas - Total de paginas a procesar
 * @param {number} estado.exitosos - Documentos descargados exitosamente
 * @param {number} estado.fallidos - Documentos que fallaron
 * @param {number} estado.omitidos - Documentos omitidos (ya descargados)
 * @param {number} estado.tiempoEstimado - Tiempo estimado restante en ms
 * @param {boolean} estado.detenido - Si la descarga fue detenida manualmente
 */
function actualizarUIEstado(estado) {
  if (estado.activo) {
    // --- Estado: descarga en progreso ---
    progressContainer.classList.add('active');
    controlesDescarga.style.display = 'none';
    btnDetener.disabled = false;

    // Calcular porcentaje de progreso granular por documento (tope en 98% hasta completar)
    const porcentaje = estado.totalDocumentos > 0
      ? Math.round((estado.documentoActual / estado.totalDocumentos) * 100)
      : 0;
    progressFill.style.width = `${Math.min(porcentaje, 98)}%`;

    // Construir texto de progreso con dia (modo mes), pagina, exitosos, fallidos y omitidos
    let textoProgreso = '';
    if (estado.totalDias) textoProgreso += `Dia ${estado.diaActual}/${estado.totalDias} - `;
    textoProgreso += `Pag ${estado.paginaActual}/${estado.totalPaginas} - `;
    textoProgreso += `${estado.exitosos} OK`;
    if (estado.fallidos > 0) textoProgreso += `, ${estado.fallidos} fallidos`;
    if (estado.omitidos > 0) textoProgreso += `, ${estado.omitidos} omitidos`;

    // Agregar estimacion de tiempo restante si esta disponible
    const tiempoTexto = formatearTiempo(estado.tiempoEstimado);
    if (tiempoTexto) textoProgreso += ` (${tiempoTexto})`;

    progressText.textContent = textoProgreso;

  } else {
    // --- Estado: descarga finalizada o inactiva ---
    controlesDescarga.style.display = 'block';

    // Solo mostrar resultado si hubo actividad previa
    if (estado.exitosos > 0 || estado.fallidos > 0 || estado.omitidos > 0) {
      progressFill.style.width = '100%';

      // Construir mensaje de resultado final
      let mensaje = estado.detenido ? 'Detenido: ' : 'Completado: ';
      mensaje += `${estado.exitosos} OK`;
      if (estado.fallidos > 0) mensaje += `, ${estado.fallidos} fallidos`;
      if (estado.omitidos > 0) mensaje += `, ${estado.omitidos} omitidos`;

      progressText.textContent = mensaje;

      // Caso especial: todos los documentos ya estaban descargados
      if (estado.exitosos === 0 && estado.fallidos === 0 && estado.omitidos > 0) {
        mostrarEstado(`Los ${estado.omitidos} documentos ya fueron descargados previamente. Usa "Descargar ignorando historial" para forzar la re-descarga.`, 'info');
      } else if (estado.fallidos === 0 && estado.exitosos > 0) {
        mostrarEstado(mensaje, 'success');
      } else if (estado.exitosos > 0 || estado.fallidos > 0) {
        mostrarEstado(mensaje, 'info');
      }

      // Reproducir sonido de notificacion si se descargo al menos un documento
      if (estado.exitosos > 0) reproducirSonido();

      // Ocultar barra de progreso despues de 3 segundos
      setTimeout(() => {
        progressContainer.classList.remove('active');
      }, 3000);

      // Mantener el mensaje de omitidos visible mas tiempo para que el usuario lo lea
      if (estado.exitosos === 0 && estado.fallidos === 0 && estado.omitidos > 0) {
        setTimeout(() => { statusBox.style.display = 'none'; }, 8000);
      } else {
        setTimeout(() => { statusBox.style.display = 'none'; }, 3000);
      }
    } else {
      // No hubo actividad previa, simplemente ocultar barra
      progressContainer.classList.remove('active');
    }

    // Restaurar estado de botones
    btnDetener.disabled = true;
    btnDescargarTodo.disabled = false;
    btnDescargarSinHistorial.disabled = false;
    btnDescargarSeleccionados.disabled = false;
  }
}

/**
 * Reproduce un beep corto de dos tonos usando Web Audio API para
 * notificar al usuario que la descarga ha finalizado.
 * Silenciosamente ignora errores si AudioContext no esta disponible.
 */
function reproducirSonido() {
  try {
    const ctx = new AudioContext();

    // Primer tono: 800Hz, volumen bajo, duracion 150ms
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.frequency.value = 800;
    gain.gain.value = 0.1;
    osc.start();
    osc.stop(ctx.currentTime + 0.15);

    // Segundo tono: 1000Hz, inicia 200ms despues, duracion 150ms
    const osc2 = ctx.createOscillator();
    const gain2 = ctx.createGain();
    osc2.connect(gain2);
    gain2.connect(ctx.destination);
    osc2.frequency.value = 1000;
    gain2.gain.value = 0.1;
    osc2.start(ctx.currentTime + 0.2);
    osc2.stop(ctx.currentTime + 0.35);
  } catch (e) {
    // AudioContext no disponible, ignorar
  }
}

// =====================================================
// Comunicacion con el background service worker
// =====================================================

/**
 * Consulta al background service worker el estado actual de descarga.
 * Se invoca al abrir el popup para sincronizar la UI con descargas en progreso.
 * @returns {Promise<Object|undefined>} Estado actual de descarga o undefined si no hay estado
 */
async function verificarEstadoDescarga() {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage({ action: 'obtenerEstado' }, (response) => {
      if (response?.estado) {
        actualizarUIEstado(response.estado);
      }
      resolve(response?.estado);
    });
  });
}

/**
 * Carga los documentos de la pagina actual del SRI.
 * Flujo:
 * 1. Verifica si hay una descarga en progreso
 * 2. Comprueba que la tab activa sea del dominio SRI
 * 3. Inyecta config.js y content.js si no estan cargados
 * 4. Solicita al content script los documentos de la tabla
 * 5. Renderiza la lista de documentos o muestra mensaje informativo
 */
async function cargarDocumentos() {
  try {
    const estado = await verificarEstadoDescarga();

    // Obtener la tab activa del navegador
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

    // Verificar que estamos en el dominio del SRI (tab.url puede ser
    // undefined en paginas restringidas del navegador)
    if (!tab?.url || !tab.url.includes('srienlinea.sri.gob.ec')) {
      mostrarEstado('Navega a srienlinea.sri.gob.ec para comenzar', 'info');
      mostrarSriLinks();
      return;
    }

    // Inyectar config.js y content.js si no estan cargados (puede fallar si ya estan inyectados)
    try {
      await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        files: ['config.js', 'content.js']
      });
    } catch (e) {
      // Los scripts pueden ya estar inyectados, ignorar error
    }

    // Breve espera para asegurar que los scripts inyectados esten listos
    await new Promise(r => setTimeout(r, 100));

    // Solicitar documentos al content script
    chrome.tabs.sendMessage(tab.id, { action: 'obtenerDocumentos' }, (response) => {
      // Error de comunicacion con content script
      if (chrome.runtime.lastError) {
        mostrarEstado('Navega y genera la consulta de los comprobantes para descargar.', 'info');
        mostrarSriLinks();
        return;
      }

      // Error reportado por el content script
      if (response?.error) {
        mostrarEstado('Navega y genera la consulta de los comprobantes para descargar.', 'info');
        mostrarSriLinks();
        return;
      }

      // Almacenar documentos, paginacion y pantalla detectada (recibidos/emitidos)
      documentos = response?.documentos || [];
      paginacion = response?.paginacion || { actual: 1, total: 1 };
      origenDetectado = response?.origen || 'recibidos';

      // Mostrar opciones dia/mes solo cuando estamos en emitidos
      opcionesEmitidos.style.display = origenDetectado === 'emitidos' ? 'block' : 'none';
      if (origenDetectado === 'emitidos') {
        if (!mesEmitidos.value) {
          const hoy = new Date();
          mesEmitidos.value = `${hoy.getFullYear()}-${String(hoy.getMonth() + 1).padStart(2, '0')}`;
        }
        // Aplicar el rango por defecto configurado (mes salvo que se cambie en Config)
        chrome.runtime.sendMessage({ action: 'obtenerConfig' }, (respCfg) => {
          const rango = respCfg?.config?.EMITIDOS_RANGO || CONFIG_DEFAULTS.EMITIDOS_RANGO;
          const radio = document.querySelector(`input[name="rangoEmitidos"][value="${rango}"]`);
          if (radio) radio.checked = true;
          mesEmitidos.style.display = getRangoEmitidos() === 'mes' ? 'block' : 'none';
        });
        // Sin consulta en pantalla: avisar que el modo mes consulta solo
        if (documentos.length === 0) {
          mostrarEstado('No hay consulta en pantalla. Con "Mes completo" la extension consultara dia por dia automaticamente.', 'info');
        }
      }

      // No hay documentos en la tabla actual. En emitidos se permite seguir:
      // el modo mes consulta dia por dia automaticamente (sin captcha)
      if (documentos.length === 0 && origenDetectado !== 'emitidos') {
        mostrarEstado('Navega y genera la consulta de los comprobantes para descargar.', 'info');
        mostrarSriLinks();
        return;
      }

      // Mostrar area de contenido con la lista de documentos
      statusBox.style.display = 'none';
      contentArea.style.display = 'block';
      document.querySelector('.tabs').style.display = '';

      totalDocs.textContent = documentos.length;
      paginaInfo.textContent = `${paginacion.actual} de ${paginacion.total}`;

      renderizarDocumentos();

      // Si hay una descarga activa, actualizar la UI con su estado
      if (estado?.activo) {
        actualizarUIEstado(estado);
      }
    });

  } catch (error) {
    mostrarEstado(`Error: ${error.message}`, 'error');
  }
}

// =====================================================
// Funciones de descarga
// =====================================================

/**
 * Pone la UI en modo "descargando" (botones deshabilitados, barra visible)
 */
function prepararUIDescarga() {
  btnDescargarTodo.disabled = true;
  btnDescargarSinHistorial.disabled = true;
  btnDescargarSeleccionados.disabled = true;
  btnDetener.disabled = false;
  progressContainer.classList.add('active');
  controlesDescarga.style.display = 'none';
  progressFill.style.width = '0%';
  progressText.textContent = 'Iniciando descarga...';
}

/**
 * Restaura la UI al estado inicial (descarga no iniciada)
 */
function restaurarUIDescarga() {
  btnDescargarTodo.disabled = false;
  btnDescargarSinHistorial.disabled = false;
  btnDescargarSeleccionados.disabled = false;
  btnDetener.disabled = true;
  progressContainer.classList.remove('active');
  controlesDescarga.style.display = 'block';
}

/**
 * Lee el rango elegido para emitidos: 'dia' (lo consultado en pantalla)
 * o 'mes' (iterar dia por dia todo el mes elegido)
 * @returns {'dia'|'mes'}
 */
function getRangoEmitidos() {
  return document.querySelector('input[name="rangoEmitidos"]:checked')?.value || 'dia';
}

/**
 * Inicia la descarga segun la pantalla detectada (recibidos/emitidos).
 * - Recibidos: flujo clasico de todas las paginas.
 * - Emitidos por dia: igual, sobre lo consultado en pantalla.
 * - Emitidos por mes: el background itera dia por dia del mes elegido,
 *   consultando y descargando; la deduplicacion omite lo ya descargado
 *   (salvo ignorarHistorial, que re-descarga todo).
 * @param {boolean} [ignorarHistorial=false] - Re-descargar aunque ya existan
 */
async function iniciarDescarga(ignorarHistorial = false) {
  const tipoDescarga = getTipoDescarga();
  const tipoTexto = tipoDescarga === 'ambos' ? 'XML + PDF' : tipoDescarga.toUpperCase();
  const esMes = origenDetectado === 'emitidos' && getRangoEmitidos() === 'mes';

  let mensaje;
  let payload;

  if (esMes) {
    const mesValor = mesEmitidos.value; // formato "aaaa-mm"
    if (!mesValor) {
      mostrarEstado('Selecciona el mes a descargar', 'info');
      return;
    }
    const [anio, mes] = mesValor.split('-').map(Number);
    mensaje = `Se descargaran los comprobantes emitidos (${tipoTexto}) de TODO el mes ${mesValor}, consultando dia por dia.` +
      (ignorarHistorial
        ? '\n\nIGNORANDO el historial: se re-descargara todo aunque ya exista.'
        : '\n\nDocumentos ya descargados se omitiran automaticamente.') +
      '\n\n¿Continuar?';
    payload = { action: 'iniciarDescargaEmitidosMes', tipoDescarga, ignorarHistorial, anio, mes };
  } else {
    if (documentos.length === 0) {
      mostrarEstado('No hay documentos consultados en pantalla. Usa "Mes completo" o ejecuta la consulta primero.', 'info');
      return;
    }
    const estimado = documentos.length * paginacion.total;
    mensaje = ignorarHistorial
      ? `Se descargaran aprox. ${estimado} comprobantes ${origenDetectado} (${tipoTexto}) de ${paginacion.total} pagina(s) IGNORANDO el historial.\n\nTodos los documentos se descargaran aunque ya existan.\n\n¿Continuar?`
      : `Se descargaran aprox. ${estimado} comprobantes ${origenDetectado} (${tipoTexto}) de ${paginacion.total} pagina(s).\n\nDocumentos ya descargados se omitiran automaticamente.\n\n¿Continuar?`;
    payload = { action: 'iniciarDescargaTotal', tipoDescarga, ignorarHistorial, origen: origenDetectado };
  }

  const aceptado = await mostrarModal(mensaje);
  if (!aceptado) return;

  prepararUIDescarga();

  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

    chrome.runtime.sendMessage({ ...payload, tabId: tab.id }, (response) => {
      if (response?.status === 'ocupado') {
        mostrarEstado('Ya hay una descarga en progreso', 'info');
      }
    });

  } catch (error) {
    mostrarEstado(`Error: ${error.message}`, 'error');
    restaurarUIDescarga();
  }
}

/** Boton "Descargar TODO": descarga respetando historial */
function iniciarDescargaTotal() {
  return iniciarDescarga(false);
}

/** Boton "Descargar ignorando historial": re-descarga todo */
function iniciarDescargaSinHistorial() {
  return iniciarDescarga(true);
}

/**
 * Descarga solo los documentos marcados con checkbox en la pagina actual.
 * No aplica deduplicacion: la seleccion es explicita del usuario.
 */
async function iniciarDescargaSeleccionados() {
  const indices = getIndicesSeleccionados();
  if (indices.length === 0) {
    mostrarEstado('No hay documentos seleccionados', 'info');
    return;
  }

  // Mapear indices de fila a claves de acceso
  const claves = indices
    .map(i => documentos.find(d => d.index === i)?.claveAcceso)
    .filter(Boolean);

  if (claves.length === 0) {
    mostrarEstado('No se pudieron identificar los documentos seleccionados', 'error');
    return;
  }

  prepararUIDescarga();

  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

    chrome.runtime.sendMessage({
      action: 'iniciarDescargaSeleccionados',
      tabId: tab.id,
      tipoDescarga: getTipoDescarga(),
      claves: claves,
      origen: origenDetectado
    }, (response) => {
      if (response?.status === 'ocupado') {
        mostrarEstado('Ya hay una descarga en progreso', 'info');
      }
    });

  } catch (error) {
    mostrarEstado(`Error: ${error.message}`, 'error');
    restaurarUIDescarga();
  }
}

/**
 * Envia solicitud al background para detener la descarga en progreso.
 * Deshabilita el boton de detener para evitar multiples clicks.
 */
async function detenerDescarga() {
  progressText.textContent = 'Deteniendo...';
  btnDetener.disabled = true;
  chrome.runtime.sendMessage({ action: 'detenerDescarga' });
}

// =====================================================
// Listener de mensajes entrantes desde el background
// =====================================================

/**
 * Escucha actualizaciones de estado de descarga enviadas por el background
 * service worker en tiempo real (progreso, finalizacion, errores).
 */
chrome.runtime.onMessage.addListener((request) => {
  if (request.action === 'estadoDescarga') {
    actualizarUIEstado(request.estado);
  }

});

// =====================================================
// Event Listeners de controles del popup
// =====================================================

/** Checkbox "Seleccionar todo": marca o desmarca todos los documentos de la lista */
selectAll.addEventListener('change', () => {
  const checkboxes = docList.querySelectorAll('input[type="checkbox"]');
  checkboxes.forEach(cb => cb.checked = selectAll.checked);
});

/** Boton "Descargar TODO": inicia descarga respetando historial */
btnDescargarTodo.addEventListener('click', iniciarDescargaTotal);

/** Radios dia/mes de emitidos: mostrar el selector de mes solo en modo mes */
document.querySelectorAll('input[name="rangoEmitidos"]').forEach(radio => {
  radio.addEventListener('change', () => {
    mesEmitidos.style.display = getRangoEmitidos() === 'mes' ? 'block' : 'none';
  });
});
/** Boton "Descargar ignorando historial": inicia descarga forzada */
btnDescargarSinHistorial.addEventListener('click', iniciarDescargaSinHistorial);

btnDescargarSeleccionados.addEventListener('click', iniciarDescargaSeleccionados);
/** Boton "Detener": detiene la descarga en progreso */
btnDetener.addEventListener('click', detenerDescarga);
/** Boton "Limpiar historial": elimina todo el historial de descargas */
btnLimpiarHistorial.addEventListener('click', limpiarHistorial);
/** Boton "Exportar": genera y descarga un archivo CSV del historial */
btnExportarHistorial.addEventListener('click', exportarHistorial);
/** Boton "Reintentar fallidos": reintenta descargar documentos que fallaron */
btnReintentarFallidos.addEventListener('click', reintentarFallidos);

/** Guarda en storage el ultimo tipo de descarga seleccionado (XML/PDF/Ambos) para recordarlo */
document.querySelectorAll('input[name="tipoDescarga"]').forEach(radio => {
  radio.addEventListener('change', () => {
    chrome.storage.local.set({ ultimoTipoDescarga: radio.value });
  });
});

/** Filtros del historial: al cambiar el filtro (todos/exitosos/fallidos) recarga la vista */
document.querySelectorAll('input[name="filtroHistorial"]').forEach(radio => {
  radio.addEventListener('change', cargarHistorial);
});

/**
 * Sistema de tabs/pestanas del popup.
 * Gestiona la navegacion entre: Descarga, Historial, Config y Organizacion.
 * Al cambiar de tab, oculta todas las areas y muestra solo la seleccionada.
 */
document.querySelectorAll('.tab-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    // Desactivar todos los botones de tab y activar el seleccionado
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');

    const tab = btn.dataset.tab;

    // Ocultar todas las areas de contenido
    contentArea.style.display = 'none';
    historialArea.style.display = 'none';
    configArea.style.display = 'none';
    organizacionArea.style.display = 'none';
    sriLinksArea.style.display = 'none';

    // Mostrar el area correspondiente al tab seleccionado
    if (tab === 'descarga') {
      if (documentos.length > 0) {
        contentArea.style.display = 'block';
      } else {
        mostrarSriLinks();
      }
    } else if (tab === 'historial') {
      historialArea.style.display = 'block';
      cargarHistorial();
    } else if (tab === 'config') {
      configArea.style.display = 'block';
      cargarConfigUI();
    } else if (tab === 'organizacion') {
      organizacionArea.style.display = 'block';
      cargarOrganizacionUI();
    }
  });
});

// =====================================================
// Historial de descargas
// =====================================================

/**
 * Carga y renderiza el historial de descargas desde el storage.
 * Construye el DOM de forma segura (sin innerHTML para datos de usuario) para evitar XSS.
 * Soporta filtros: todos, exitosos, fallidos.
 * Muestra un resumen con conteos y habilita/oculta el boton de reintentar.
 */
async function cargarHistorial() {
  // Obtener el filtro seleccionado actualmente
  const filtro = document.querySelector('input[name="filtroHistorial"]:checked')?.value || 'todos';

  // Mostrar mensaje de carga mientras se obtienen datos
  listaHistorial.innerHTML = '';
  const loadingMsg = document.createElement('p');
  loadingMsg.className = 'empty-msg';
  loadingMsg.textContent = 'Cargando...';
  listaHistorial.appendChild(loadingMsg);

  // Solicitar historial completo al background
  chrome.runtime.sendMessage({ action: 'obtenerHistorial' }, (response) => {
    if (response?.error) {
      listaHistorial.innerHTML = '';
      const errMsg = document.createElement('p');
      errMsg.className = 'empty-msg';
      errMsg.textContent = 'Error al cargar historial';
      listaHistorial.appendChild(errMsg);
      return;
    }

    // Aplanar estructura del historial: {ruc -> sesiones -> documentos} a lista plana
    const historial = response?.historial || {};
    let docs = [];

    for (const ruc in historial) {
      for (const sesionId in historial[ruc].sesiones) {
        const sesion = historial[ruc].sesiones[sesionId];
        docs.push(...sesion.documentos.map(d => ({
          ...d,
          rucUsuario: ruc,
          sesionId: sesionId
        })));
      }
    }

    // Aplicar filtro segun seleccion del usuario
    if (filtro === 'fallidos') {
      docs = docs.filter(d => !d.exito);
    } else if (filtro === 'exitosos') {
      docs = docs.filter(d => d.exito);
    }

    // Ordenar por fecha de descarga, mas recientes primero
    docs.sort((a, b) => new Date(b.fechaDescarga) - new Date(a.fechaDescarga));

    // Mostrar boton de reintentar solo si hay documentos fallidos
    const hayFallidos = docs.some(d => !d.exito) || (filtro === 'fallidos' && docs.length > 0);
    btnReintentarFallidos.style.display = hayFallidos ? 'block' : 'none';

    // Mostrar mensaje vacio si no hay documentos para el filtro actual
    if (docs.length === 0) {
      listaHistorial.innerHTML = '';
      const emptyMsg = document.createElement('p');
      emptyMsg.className = 'empty-msg';
      emptyMsg.textContent = filtro === 'fallidos' ? 'No hay documentos fallidos' :
                             filtro === 'exitosos' ? 'No hay documentos exitosos' :
                             'No hay documentos en el historial';
      listaHistorial.appendChild(emptyMsg);
      resumenHistorial.style.display = 'none';
      return;
    }

    // Renderizar cada documento del historial
    listaHistorial.innerHTML = '';

    docs.forEach(doc => {
      const item = document.createElement('div');
      item.className = `fallido-item historial-item ${doc.exito ? 'exitoso' : 'fallido'}`;

      // Formatear fecha al formato ecuatoriano (dd/mm/yy HH:mm)
      const fecha = new Date(doc.fechaDescarga).toLocaleString('es-EC', {
        day: '2-digit', month: '2-digit', year: '2-digit',
        hour: '2-digit', minute: '2-digit'
      });

      const infoDiv = document.createElement('div');
      infoDiv.className = 'fallido-info';

      const detalleDiv = document.createElement('div');
      detalleDiv.className = 'fallido-detalle';

      // Indicador de exito/fallo con tipo y serie del documento
      const tipoDiv = document.createElement('div');
      tipoDiv.className = 'fallido-tipo';
      tipoDiv.textContent = `${doc.exito ? '\u2713' : '\u2717'} ${doc.tipoDoc || ''} ${doc.serie || ''}`;

      // RUC y razon social del emisor
      const rucDiv = document.createElement('div');
      rucDiv.className = 'fallido-ruc';
      rucDiv.textContent = `RUC: ${doc.ruc || ''} - ${doc.razonSocial || ''}`;

      detalleDiv.appendChild(tipoDiv);
      detalleDiv.appendChild(rucDiv);

      // Mostrar mensaje de error si el documento fallo
      if (doc.error) {
        const errorDiv = document.createElement('div');
        errorDiv.className = 'fallido-error';
        errorDiv.textContent = doc.error;
        detalleDiv.appendChild(errorDiv);
      }

      // Fecha de descarga
      const fechaDiv = document.createElement('div');
      fechaDiv.className = 'fallido-fecha';
      fechaDiv.textContent = fecha;

      infoDiv.appendChild(detalleDiv);
      infoDiv.appendChild(fechaDiv);
      item.appendChild(infoDiv);
      listaHistorial.appendChild(item);
    });

    // Mostrar resumen con conteo de exitosos y fallidos
    const exitosos = docs.filter(d => d.exito).length;
    const fallidos = docs.filter(d => !d.exito).length;
    resumenHistorial.style.display = 'block';
    resumenTexto.textContent = `Mostrando ${docs.length} documentos (${exitosos} exitosos, ${fallidos} fallidos)`;
  });
}

/**
 * Limpia todo el historial de descargas despues de confirmacion del usuario.
 * Esto permite volver a descargar todos los documentos ya que la deduplicacion
 * se basa en el historial almacenado.
 */
async function limpiarHistorial() {
  const aceptado = await mostrarModal('¿Limpiar todo el historial de descargas?\n\nEsto permitira volver a descargar todos los documentos.');
  if (!aceptado) return;

  chrome.runtime.sendMessage({ action: 'limpiarHistorial' }, (response) => {
    if (response?.success) {
      // Limpiar la vista y ocultar resumen
      listaHistorial.innerHTML = '';
      const msg = document.createElement('p');
      msg.className = 'empty-msg';
      msg.textContent = 'Historial limpiado';
      listaHistorial.appendChild(msg);
      resumenHistorial.style.display = 'none';
      btnReintentarFallidos.style.display = 'none';
    }
  });
}

/**
 * Exporta el historial completo a un archivo CSV con codificacion UTF-8 (BOM).
 * Incluye: RUC emisor, razon social, tipo, serie, clave de acceso, fechas, estado y errores.
 * Usa chrome.downloads.download para que el usuario elija donde guardar el archivo.
 */
async function exportarHistorial() {
  chrome.runtime.sendMessage({ action: 'obtenerHistorial' }, (response) => {
    if (response?.error || !response?.historial) {
      mostrarEstado('Error al exportar historial', 'error');
      return;
    }

    const historial = response.historial;
    const filas = [];

    // Neutraliza inyeccion de formulas en Excel/Sheets (celdas que inician con = + - @)
    const celdaSegura = (v) => {
      let texto = String(v || '');
      if (/^[=+\-@]/.test(texto)) texto = `'${texto}`;
      return `"${texto.replace(/"/g, '""')}"`;
    };

    // Cabecera del CSV
    filas.push(['RUC Emisor', 'Razon Social', 'Tipo Doc', 'Serie', 'Clave Acceso', 'Fecha Emision', 'Fecha Autorizacion', 'Estado', 'Error', 'Fecha Descarga'].join(','));

    // Recorrer toda la estructura del historial y generar filas CSV
    for (const ruc in historial) {
      for (const sesionId in historial[ruc].sesiones) {
        const sesion = historial[ruc].sesiones[sesionId];
        for (const doc of sesion.documentos) {
          const fila = [
            doc.ruc || '',
            celdaSegura(doc.razonSocial),
            celdaSegura(doc.tipoDoc),
            celdaSegura(doc.serie),
            doc.claveAcceso || '',
            doc.fechaEmision || '',
            doc.fechaAutorizacion || '',
            doc.exito ? 'OK' : 'FALLIDO',
            celdaSegura(doc.error),
            doc.fechaDescarga || ''
          ];
          filas.push(fila.join(','));
        }
      }
    }

    // Verificar que haya datos para exportar (mas que solo la cabecera)
    if (filas.length <= 1) {
      mostrarEstado('No hay datos para exportar', 'info');
      return;
    }

    // Crear blob CSV con BOM para compatibilidad con Excel en espanol
    const csv = filas.join('\n');
    const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);

    // Descargar archivo con nombre basado en la fecha actual
    chrome.downloads.download({
      url: url,
      filename: `historial_sri_${new Date().toISOString().slice(0, 10)}.csv`,
      saveAs: true
    });
  });
}

/**
 * Reintenta la descarga de documentos fallidos.
 * Cambia al tab de descarga e inicia una descarga total.
 * La deduplicacion del background se encarga de omitir los que ya fueron exitosos,
 * descargando solo los que fallaron previamente.
 */
async function reintentarFallidos() {
  // Cambiar a tab de descarga visualmente
  document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
  document.querySelector('[data-tab="descarga"]').classList.add('active');
  contentArea.style.display = 'block';
  historialArea.style.display = 'none';

  // Iniciar descarga total del origen detectado (la deduplicacion omite exitosos)
  iniciarDescargaTotal();
}

// =====================================================
// Modal de confirmacion
// =====================================================

/**
 * Muestra un modal de confirmacion centrado en el popup.
 * Reemplaza el uso de confirm() nativo que puede causar problemas en popups de extension.
 * @param {string} texto - Mensaje a mostrar en el modal
 * @returns {Promise<boolean>} true si el usuario acepta, false si cancela
 */
function mostrarModal(texto) {
  return new Promise((resolve) => {
    const overlay = document.getElementById('modalOverlay');
    const textoEl = document.getElementById('modalTexto');
    const btnAceptar = document.getElementById('modalAceptar');
    const btnCancelar = document.getElementById('modalCancelar');

    textoEl.textContent = texto;
    overlay.style.display = 'flex';

    /**
     * Limpia los event listeners y cierra el modal con el resultado.
     * @param {boolean} resultado - Resultado de la accion del usuario
     */
    function limpiar(resultado) {
      overlay.style.display = 'none';
      btnAceptar.removeEventListener('click', onAceptar);
      btnCancelar.removeEventListener('click', onCancelar);
      resolve(resultado);
    }

    function onAceptar() { limpiar(true); }
    function onCancelar() { limpiar(false); }

    btnAceptar.addEventListener('click', onAceptar);
    btnCancelar.addEventListener('click', onCancelar);
  });
}

// =====================================================
// Configuracion de la extension
// =====================================================

/**
 * Valores por defecto de configuracion de la extension.
 * Se usan como fallback cuando no hay configuracion guardada en storage
 * y como referencia al restaurar valores por defecto.
 * @type {Object}
 */
const CONFIG_DEFAULTS = {
  /** Rango por defecto al descargar emitidos: 'mes' (dia por dia) o 'dia' */
  EMITIDOS_RANGO: 'mes',
  /** Milisegundos de espera entre cada descarga individual */
  DELAY_DESCARGA: 300,
  /** Milisegundos maximo de espera por cada descarga antes de timeout */
  TIMEOUT_DESCARGA: 5000,
  /** Milisegundos de espera fallback al cambiar de pagina */
  DELAY_PAGINA: 1500,
  /** Milisegundos maximo de espera al cambiar de pagina */
  TIMEOUT_PAGINA: 10000,
  /** Milisegundos de espera entre reintentos de descarga fallida */
  DELAY_REINTENTO: 1000,
  /** Numero maximo de reintentos por descarga fallida */
  MAX_REINTENTOS: 2,
  /** Dias que se mantiene el historial antes de auto-limpieza */
  DIAS_HISTORIAL: 30,
  /** Configuracion por defecto de organizacion de archivos descargados */
  ORGANIZACION: {
    /** Si la organizacion en carpetas esta habilitada */
    HABILITADO: false,
    /** Nombre de la carpeta raiz donde se guardan las descargas */
    CARPETA_RAIZ: 'descargas_sri',
    /** Estructura de subcarpetas usando tokens reemplazables */
    ORDEN: 'ruc_fecha',
    /** Formato del nombre de archivo: 'claveAcceso', 'ruc_serie', o 'razon_serie' */
    FORMATO_NOMBRE: 'claveAcceso'
  }
};

// =====================================================
// Funciones de organizacion de archivos
// =====================================================

/**
 * Lee la configuracion de organizacion desde los inputs del DOM.
 * @returns {Object} Config con HABILITADO, CARPETA_RAIZ, ORDEN, FORMATO_NOMBRE
 */
function obtenerOrganizacionUI() {
  return {
    HABILITADO: document.getElementById('cfgOrgHabilitado').checked,
    CARPETA_RAIZ: document.getElementById('cfgCarpetaRaiz').value.trim() || 'descargas_sri',
    ORDEN: document.getElementById('cfgOrden').value || 'ruc_fecha',
    FORMATO_NOMBRE: document.querySelector('input[name="formatoNombre"]:checked')?.value || 'claveAcceso'
  };
}

/**
 * Actualiza la vista previa de la ruta con datos de ejemplo.
 * Estructura fija: carpetaRaiz / [ruc+fecha o fecha+ruc] / recibidos / tipoDoc / nombre.ext
 */
function actualizarPreview() {
  const previewEl = document.getElementById('cfgPreviewRuta');
  const org = obtenerOrganizacionUI();

  if (!org.HABILITADO) {
    previewEl.textContent = '(organizacion deshabilitada - descarga a carpeta por defecto)';
    return;
  }

  const ruc = '0930808662001';
  const segmentos = [org.CARPETA_RAIZ];

  if (org.ORDEN === 'fecha_ruc') {
    segmentos.push('2026', '03', ruc);
  } else {
    segmentos.push(ruc, '2026', '03');
  }

  segmentos.push('recibidos', 'factura', 'xml');

  switch (org.FORMATO_NOMBRE) {
    case 'ruc_serie':
      segmentos.push('1791847652001_001001034700490.xml');
      break;
    case 'razon_serie':
      segmentos.push('SETEL_S.A._001001034700490.xml');
      break;
    default:
      segmentos.push('0103202601179184765200120010...013.xml');
  }

  previewEl.textContent = segmentos.join('/');
}

/**
 * Muestra u oculta los detalles de organizacion (carpeta raiz, estructura, formato)
 * segun si la organizacion esta habilitada o no.
 * @param {boolean} habilitado - Si la organizacion esta activada
 */
function toggleOrgDetalles(habilitado) {
  const detalles = document.getElementById('orgDetalles');
  detalles.style.display = habilitado ? 'block' : 'none';
}

/**
 * Carga la configuracion actual desde el storage y la muestra en los inputs del tab Config.
 * Usa los valores por defecto como fallback para campos no definidos.
 */
function cargarConfigUI() {
  chrome.runtime.sendMessage({ action: 'obtenerConfig' }, (response) => {
    const cfg = response?.config || {};
    document.getElementById('cfgDelayDescarga').value = cfg.DELAY_DESCARGA ?? CONFIG_DEFAULTS.DELAY_DESCARGA;
    document.getElementById('cfgTimeoutDescarga').value = cfg.TIMEOUT_DESCARGA ?? CONFIG_DEFAULTS.TIMEOUT_DESCARGA;
    document.getElementById('cfgDelayPagina').value = cfg.DELAY_PAGINA ?? CONFIG_DEFAULTS.DELAY_PAGINA;
    document.getElementById('cfgTimeoutPagina').value = cfg.TIMEOUT_PAGINA ?? CONFIG_DEFAULTS.TIMEOUT_PAGINA;
    document.getElementById('cfgDelayReintento').value = cfg.DELAY_REINTENTO ?? CONFIG_DEFAULTS.DELAY_REINTENTO;
    document.getElementById('cfgMaxReintentos').value = cfg.MAX_REINTENTOS ?? CONFIG_DEFAULTS.MAX_REINTENTOS;
    document.getElementById('cfgDiasHistorial').value = cfg.DIAS_HISTORIAL ?? CONFIG_DEFAULTS.DIAS_HISTORIAL;
    // Seleccionar el metodo de descarga guardado (mojarra por defecto)
    const metodo = cfg.METODO_DESCARGA || 'mojarra';
    const metodoRadio = document.querySelector(`input[name="metodoDescarga"][value="${metodo}"]`);
    if (metodoRadio) metodoRadio.checked = true;
    // Rango por defecto de emitidos (mes por defecto)
    const rangoEmit = cfg.EMITIDOS_RANGO || CONFIG_DEFAULTS.EMITIDOS_RANGO;
    const rangoRadio = document.querySelector(`input[name="cfgRangoEmitidos"][value="${rangoEmit}"]`);
    if (rangoRadio) rangoRadio.checked = true;
    configStatus.textContent = '';
  });
}

/**
 * Lee un input numerico de configuracion. Si esta vacio o no es un numero
 * usa el valor por defecto (parseInt('') es NaN y guardarlo rompia los
 * reintentos), y aplica los limites min/max declarados en el propio input.
 * @param {string} id - ID del input
 * @param {number} defecto - Valor por defecto si el input no es valido
 * @returns {number} Valor validado y acotado
 */
function leerConfigNum(id, defecto) {
  const input = document.getElementById(id);
  const valor = parseInt(input.value, 10);
  if (Number.isNaN(valor)) return defecto;
  const min = parseInt(input.min, 10);
  const max = parseInt(input.max, 10);
  return Math.min(max, Math.max(min, valor));
}

/**
 * Lee los valores de configuracion desde los inputs del UI y los guarda
 * en el storage a traves del background service worker.
 * Muestra mensaje de exito o error al finalizar.
 */
function guardarConfig() {
  const config = {
    DELAY_DESCARGA: leerConfigNum('cfgDelayDescarga', CONFIG_DEFAULTS.DELAY_DESCARGA),
    TIMEOUT_DESCARGA: leerConfigNum('cfgTimeoutDescarga', CONFIG_DEFAULTS.TIMEOUT_DESCARGA),
    DELAY_PAGINA: leerConfigNum('cfgDelayPagina', CONFIG_DEFAULTS.DELAY_PAGINA),
    TIMEOUT_PAGINA: leerConfigNum('cfgTimeoutPagina', CONFIG_DEFAULTS.TIMEOUT_PAGINA),
    DELAY_REINTENTO: leerConfigNum('cfgDelayReintento', CONFIG_DEFAULTS.DELAY_REINTENTO),
    MAX_REINTENTOS: leerConfigNum('cfgMaxReintentos', CONFIG_DEFAULTS.MAX_REINTENTOS),
    DIAS_HISTORIAL: leerConfigNum('cfgDiasHistorial', CONFIG_DEFAULTS.DIAS_HISTORIAL),
    METODO_DESCARGA: document.querySelector('input[name="metodoDescarga"]:checked')?.value || 'mojarra',
    EMITIDOS_RANGO: document.querySelector('input[name="cfgRangoEmitidos"]:checked')?.value || CONFIG_DEFAULTS.EMITIDOS_RANGO
  };

  chrome.runtime.sendMessage({ action: 'guardarConfig', config }, (response) => {
    if (response?.success) {
      configStatus.textContent = 'Configuracion guardada';
      configStatus.style.color = '#4caf50';
    } else {
      configStatus.textContent = 'Error al guardar';
      configStatus.style.color = '#f44336';
    }
    // Limpiar mensaje de estado despues de 3 segundos
    setTimeout(() => { configStatus.textContent = ''; }, 3000);
  });
}

/**
 * Restaura todos los valores de configuracion a sus valores por defecto
 * tanto en el UI como en el storage.
 */
function resetConfig() {
  // Restaurar valores en los inputs del DOM
  document.getElementById('cfgDelayDescarga').value = CONFIG_DEFAULTS.DELAY_DESCARGA;
  document.getElementById('cfgTimeoutDescarga').value = CONFIG_DEFAULTS.TIMEOUT_DESCARGA;
  document.getElementById('cfgDelayPagina').value = CONFIG_DEFAULTS.DELAY_PAGINA;
  document.getElementById('cfgTimeoutPagina').value = CONFIG_DEFAULTS.TIMEOUT_PAGINA;
  document.getElementById('cfgDelayReintento').value = CONFIG_DEFAULTS.DELAY_REINTENTO;
  document.getElementById('cfgMaxReintentos').value = CONFIG_DEFAULTS.MAX_REINTENTOS;
  document.getElementById('cfgDiasHistorial').value = CONFIG_DEFAULTS.DIAS_HISTORIAL;
  const mojarraRadio = document.querySelector('input[name="metodoDescarga"][value="mojarra"]');
  if (mojarraRadio) mojarraRadio.checked = true;
  const rangoMesRadio = document.querySelector('input[name="cfgRangoEmitidos"][value="mes"]');
  if (rangoMesRadio) rangoMesRadio.checked = true;

  // Guardar los defaults en storage
  const resetConfig = { ...CONFIG_DEFAULTS, METODO_DESCARGA: 'mojarra' };
  chrome.runtime.sendMessage({ action: 'guardarConfig', config: resetConfig }, (response) => {
    if (response?.success) {
      configStatus.textContent = 'Restaurado a valores por defecto';
      configStatus.style.color = '#2196f3';
    }
    setTimeout(() => { configStatus.textContent = ''; }, 3000);
  });
}

/** Boton "Guardar" del tab de configuracion */
btnGuardarConfig.addEventListener('click', guardarConfig);
/** Boton "Restaurar" del tab de configuracion */
btnResetConfig.addEventListener('click', resetConfig);

// =====================================================
// Organizacion de archivos: carga, guardado, reset
// =====================================================

/**
 * Carga la configuracion de organizacion desde el storage y la muestra
 * en los inputs del tab Organizacion. Incluye la estructura de carpetas,
 * carpeta raiz, formato de nombre y estado de habilitacion.
 */
function cargarOrganizacionUI() {
  chrome.runtime.sendMessage({ action: 'obtenerConfig' }, (response) => {
    const cfg = response?.config || {};
    const org = cfg.ORGANIZACION || CONFIG_DEFAULTS.ORGANIZACION;
    document.getElementById('cfgOrgHabilitado').checked = org.HABILITADO;
    document.getElementById('cfgCarpetaRaiz').value = org.CARPETA_RAIZ || 'descargas_sri';
    document.getElementById('cfgOrden').value = org.ORDEN || 'ruc_fecha';
    const fmtRadio = document.querySelector(`input[name="formatoNombre"][value="${org.FORMATO_NOMBRE || 'claveAcceso'}"]`);
    if (fmtRadio) fmtRadio.checked = true;
    toggleOrgDetalles(org.HABILITADO);
    actualizarPreview();
    document.getElementById('orgStatus').textContent = '';
  });
}

/**
 * Guarda la configuracion de organizacion en el storage.
 * Lee la configuracion existente primero para solo actualizar la seccion ORGANIZACION
 * sin sobreescribir otras configuraciones (delays, timeouts, etc.).
 */
async function guardarOrganizacion() {
  const orgConfig = obtenerOrganizacionUI();

  // Verificar si hay historial de descargas
  const hayHistorial = await new Promise(resolve => {
    chrome.runtime.sendMessage({ action: 'obtenerHistorial' }, (resp) => {
      const historial = resp?.historial || {};
      // Contar si hay al menos un documento descargado
      for (const ruc in historial) {
        for (const sid in historial[ruc].sesiones) {
          if (historial[ruc].sesiones[sid].documentos?.length > 0) {
            resolve(true);
            return;
          }
        }
      }
      resolve(false);
    });
  });

  // Si hay historial, obtener config guardada y comparar cambios criticos
  if (hayHistorial) {
    const configGuardada = await new Promise(resolve => {
      chrome.runtime.sendMessage({ action: 'obtenerConfig' }, (resp) => {
        resolve(resp?.config || {});
      });
    });

    const orgGuardada = configGuardada.ORGANIZACION || null;

    // Si hay config previa guardada, comparar; si no hay, siempre alertar
    const cambioCritico = !orgGuardada || (
      orgConfig.CARPETA_RAIZ !== orgGuardada.CARPETA_RAIZ ||
      orgConfig.FORMATO_NOMBRE !== orgGuardada.FORMATO_NOMBRE ||
      orgConfig.ORDEN !== orgGuardada.ORDEN
    );

    if (cambioCritico) {
      const aceptado = await mostrarModal(
        'Has cambiado la estructura de carpetas o el formato de nombre.\n\n' +
        'Los archivos ya descargados NO se moveran automaticamente. ' +
        'Quedaran en la ruta anterior y los nuevos se guardaran en la nueva ruta.\n\n' +
        '¿Deseas continuar con el cambio?'
      );
      if (!aceptado) return;
    }
  }

  // Leer config existente y solo actualizar ORGANIZACION
  chrome.runtime.sendMessage({ action: 'obtenerConfig' }, (response) => {
    const config = response?.config || {};
    config.ORGANIZACION = orgConfig;
    chrome.runtime.sendMessage({ action: 'guardarConfig', config }, (resp) => {
      const orgStatus = document.getElementById('orgStatus');
      if (resp?.success) {
        orgStatus.textContent = 'Organizacion guardada';
        orgStatus.style.color = '#4caf50';
      } else {
        orgStatus.textContent = 'Error al guardar';
        orgStatus.style.color = '#f44336';
      }
      setTimeout(() => { orgStatus.textContent = ''; }, 3000);
    });
  });
}

/**
 * Restaura la configuracion de organizacion a valores por defecto.
 * Actualiza los inputs del DOM y guarda los defaults en storage.
 */
function resetOrganizacion() {
  const defaults = CONFIG_DEFAULTS.ORGANIZACION;
  document.getElementById('cfgOrgHabilitado').checked = defaults.HABILITADO;
  document.getElementById('cfgCarpetaRaiz').value = defaults.CARPETA_RAIZ;
  document.getElementById('cfgOrden').value = defaults.ORDEN;
  const fmtRadioDefault = document.querySelector(`input[name="formatoNombre"][value="${defaults.FORMATO_NOMBRE}"]`);
  if (fmtRadioDefault) fmtRadioDefault.checked = true;
  toggleOrgDetalles(defaults.HABILITADO);
  actualizarPreview();
  guardarOrganizacion();
}

/** Boton "Guardar" del tab de organizacion */
document.getElementById('btnGuardarOrg').addEventListener('click', guardarOrganizacion);
/** Boton "Restaurar" del tab de organizacion */
document.getElementById('btnResetOrg').addEventListener('click', resetOrganizacion);

// --- Listeners de organizacion para actualizacion de preview en tiempo real ---

/** Checkbox de habilitar/deshabilitar organizacion: muestra/oculta detalles y actualiza preview */
document.getElementById('cfgOrgHabilitado').addEventListener('change', (e) => {
  toggleOrgDetalles(e.target.checked);
  actualizarPreview();
});
document.getElementById('cfgCarpetaRaiz').addEventListener('input', actualizarPreview);
document.getElementById('cfgOrden').addEventListener('change', actualizarPreview);
document.querySelectorAll('input[name="formatoNombre"]').forEach(radio => {
  radio.addEventListener('change', actualizarPreview);
});

// =====================================================
// Restauracion de preferencias del usuario
// =====================================================

/**
 * Restaura el tipo de descarga (XML/PDF/Ambos) que el usuario selecciono
 * en su ultima sesion, leyendo el valor guardado en chrome.storage.local.
 */
async function restaurarTipoDescarga() {
  const data = await chrome.storage.local.get(['ultimoTipoDescarga']);
  if (data.ultimoTipoDescarga) {
    const radio = document.querySelector(`input[name="tipoDescarga"][value="${data.ultimoTipoDescarga}"]`);
    if (radio) radio.checked = true;
  }
}

// =====================================================
// Menu de accesos directos al SRI
// =====================================================

/**
 * Estructura de datos del menu de accesos directos a paginas del SRI.
 * Organizado en categorias con sub-items. El item con `primary: true`
 * se muestra como boton principal destacado.
 * @type {Array<{nombre: string, url?: string, primary?: boolean, items?: Array<{nombre: string, url: string}>}>}
 */
const SRI_MENU = [
  { nombre: 'Descargar recibidos', primary: true, items: [
    { nombre: 'Facturas', url: 'https://srienlinea.sri.gob.ec/tuportal-internet/accederAplicacion.jspa?redireccion=57&idGrupo=55', tipoComprobante: '1' },
    { nombre: 'Liquidaciones de compra', url: 'https://srienlinea.sri.gob.ec/tuportal-internet/accederAplicacion.jspa?redireccion=57&idGrupo=55', tipoComprobante: '2' },
    { nombre: 'Notas de Credito', url: 'https://srienlinea.sri.gob.ec/tuportal-internet/accederAplicacion.jspa?redireccion=57&idGrupo=55', tipoComprobante: '3' },
    { nombre: 'Notas de Debito', url: 'https://srienlinea.sri.gob.ec/tuportal-internet/accederAplicacion.jspa?redireccion=57&idGrupo=55', tipoComprobante: '4' },
    { nombre: 'Comprobantes de Retencion', url: 'https://srienlinea.sri.gob.ec/tuportal-internet/accederAplicacion.jspa?redireccion=57&idGrupo=55', tipoComprobante: '6' },
  ]},
  // URL directa de la pantalla de emitidos (validada en vivo); si el SRI
  // redirige al menu intermedio, navegarAEmitidos hace click en la opcion
  { nombre: 'Descargar emitidos', primary: true, esEmitidos: true,
    url: 'https://srienlinea.sri.gob.ec/comprobantes-electronicos-internet/pages/consultas/recuperarComprobantes.jsf' },
  { nombre: 'Claves', items: [
    { nombre: 'Cambiar clave', url: 'https://srienlinea.sri.gob.ec/sri-en-linea/SriClaves/Generacion/internet/actualizar' },
    { nombre: 'Crear y administrar usuarios', url: 'https://srienlinea.sri.gob.ec/sri-en-linea/SriClaves/UsuariosAdicionales/administracion' },
    { nombre: 'Confirmacion usuario adicional', url: 'https://srienlinea.sri.gob.ec/sri-en-linea/SriClaves/UsuarioAdicional/confirmacion' },
  ]},
  { nombre: 'RUC', items: [
    { nombre: 'Consulta', url: 'https://srienlinea.sri.gob.ec/sri-en-linea/SriRucWeb/ConsultaRuc/Consultas/consultaRuc' },
    { nombre: 'Actualizacion', url: 'https://srienlinea.sri.gob.ec/tuportal-internet/accederAplicacion.jspa?redireccion=2292&idGrupo=1' },
    { nombre: 'Certificados', url: 'https://srienlinea.sri.gob.ec/tuportal-internet/accederAplicacion.jspa?redireccion=2293&idGrupo=1' },
    { nombre: 'Suspension / Reinicio', url: 'https://srienlinea.sri.gob.ec/tuportal-internet/accederAplicacion.jspa?redireccion=3192&idGrupo=1' },
  ]},
  { nombre: 'Facturacion Electronica', items: [
    { nombre: 'Validez de comprobantes', url: 'https://srienlinea.sri.gob.ec/tuportal-internet/accederAplicacion.jspa?redireccion=56&idGrupo=55' },
    { nombre: 'Comprobantes recibidos', url: 'https://srienlinea.sri.gob.ec/tuportal-internet/accederAplicacion.jspa?redireccion=57&idGrupo=55' },
    { nombre: 'Emisores autorizados', url: 'https://srienlinea.sri.gob.ec/tuportal-internet/accederAplicacion.jspa?redireccion=2892&idGrupo=55' },
    { nombre: 'Autorizacion (produccion)', url: 'https://srienlinea.sri.gob.ec/tuportal-internet/accederAplicacion.jspa?redireccion=59&idGrupo=58' },
    { nombre: 'Consultas (produccion)', url: 'https://srienlinea.sri.gob.ec/tuportal-internet/accederAplicacion.jspa?redireccion=60&idGrupo=58' },
    { nombre: 'Anulacion (produccion)', url: 'https://srienlinea.sri.gob.ec/tuportal-internet/accederAplicacion.jspa?redireccion=61&idGrupo=58' },
  ]},
  { nombre: 'Declaraciones', items: [
    { nombre: 'Elaboracion y envio', url: 'https://srienlinea.sri.gob.ec/sri-en-linea/SriDeclaraciones/Publico/declaraciones' },
    { nombre: 'Consulta declaraciones y pagos', url: 'https://srienlinea.sri.gob.ec/tuportal-internet/accederAplicacion.jspa?redireccion=1292&idGrupo=73' },
    { nombre: 'Consulta formulario 107 - RDEP', url: 'https://srienlinea.sri.gob.ec/tuportal-internet/accederAplicacion.jspa?redireccion=2708&idGrupo=73' },
    { nombre: 'Impuesto a la Renta, ISD y otros', url: 'https://srienlinea.sri.gob.ec/sri-en-linea/SriDeclaracionesWeb/ConsultaImpuestoRenta/Consultas/consultaImpuestoRenta' },
    { nombre: 'Herencias y legados', url: 'https://srienlinea.sri.gob.ec/sri-en-linea/SriDeclaracionesWeb/MostrarOpcionesHerencia/mostrarOpcionesHerencia' },
  ]},
  { nombre: 'Anexos', items: [
    { nombre: 'Envio y consulta de anexos', url: 'https://srienlinea.sri.gob.ec/sri-en-linea/SriAnexos/EnvioConsulta/envioConsulta' },
    { nombre: 'Registro beneficiario pension', url: 'https://srienlinea.sri.gob.ec/tuportal-internet/accederAplicacion.jspa?redireccion=99&idGrupo=98' },
    { nombre: 'Cargas familiares (desde 2023)', url: 'https://srienlinea.sri.gob.ec/tuportal-internet/accederAplicacion.jspa?redireccion=3600&idGrupo=98' },
    { nombre: 'Generacion anexo gastos', url: 'https://srienlinea.sri.gob.ec/tuportal-internet/accederAplicacion.jspa?redireccion=101&idGrupo=98' },
  ]},
  { nombre: 'Pagos', items: [
    { nombre: 'Pago de obligaciones', url: 'https://srienlinea.sri.gob.ec/tuportal-internet/accederAplicacion.jspa?redireccion=106&idGrupo=105' },
    { nombre: 'Consulta comprobante de pago', url: 'https://srienlinea.sri.gob.ec/tuportal-internet/accederAplicacion.jspa?redireccion=107&idGrupo=105' },
    { nombre: 'Convenio debito bancario', url: 'https://srienlinea.sri.gob.ec/tuportal-internet/accederAplicacion.jspa?redireccion=111&idGrupo=103' },
    { nombre: 'Reporte de pagos RISE', url: 'https://srienlinea.sri.gob.ec/tuportal-internet/accederAplicacion.jspa?redireccion=3292&idGrupo=103' },
  ]},
  { nombre: 'Deudas', items: [
    { nombre: 'Deudas firmes e impugnadas', url: 'https://srienlinea.sri.gob.ec/sri-en-linea/SriPagosWeb/ConsultaDeudasFirmesImpugnadas/Consultas/consultaDeudasFirmesImpugnadas' },
    { nombre: 'Obligaciones con el SRI', url: 'https://srienlinea.sri.gob.ec/tuportal-internet/accederAplicacion.jspa?redireccion=115&idGrupo=113' },
    { nombre: 'Ranking deudas', url: 'https://srienlinea.sri.gob.ec/sri-en-linea/SriPagosWeb/ConsultaRankingDeudas/Consultas/consultaRankingDeudas' },
    { nombre: 'Facilidades de pago', url: 'https://srienlinea.sri.gob.ec/tuportal-internet/accederAplicacion.jspa?redireccion=120&idGrupo=113' },
  ]},
  { nombre: 'Devoluciones', items: [
    { nombre: 'Devolucion Impuesto a la Renta', url: 'https://srienlinea.sri.gob.ec/tuportal-internet/accederAplicacion.jspa?redireccion=128&idGrupo=127' },
    { nombre: 'IVA - Adultos mayores', url: 'https://srienlinea.sri.gob.ec/tuportal-internet/accederAplicacion.jspa?redireccion=129&idGrupo=127' },
    { nombre: 'IVA - Personas con discapacidad', url: 'https://srienlinea.sri.gob.ec/tuportal-internet/accederAplicacion.jspa?redireccion=130&idGrupo=127' },
    { nombre: 'IVA Exportadores', url: 'https://srienlinea.sri.gob.ec/tuportal-internet/accederAplicacion.jspa?redireccion=283&idGrupo=127' },
    { nombre: 'Prevalidacion', url: 'https://srienlinea.sri.gob.ec/tuportal-internet/accederAplicacion.jspa?redireccion=131&idGrupo=127' },
  ]},
  { nombre: 'Certificados', items: [
    { nombre: 'Autorizacion a terceros', url: 'https://srienlinea.sri.gob.ec/tuportal-internet/accederAplicacion.jspa?redireccion=1492&idGrupo=27' },
    { nombre: 'Cumplimiento tributario', url: 'https://srienlinea.sri.gob.ec/tuportal-internet/accederAplicacion.jspa?redireccion=29&idGrupo=27' },
    { nombre: 'Validacion certificados QR', url: 'https://srienlinea.sri.gob.ec/sri-en-linea/SriRucWeb/CertificadoValidacionDocumentos/Consultas/certificadoValidacionDocumentos' },
  ]},
  { nombre: 'Vehiculos', items: [
    { nombre: 'Valores a pagar por placa', url: 'https://srienlinea.sri.gob.ec/sri-en-linea/SriVehiculosWeb/ConsultaValoresPagarVehiculo/Consultas/consultaRubros' },
    { nombre: 'Reporte de pagos', url: 'https://srienlinea.sri.gob.ec/sri-en-linea/SriVehiculosWeb/ReportePagosVehiculo/Consultas/consultarPagos' },
    { nombre: 'Consulta de subcategoria', url: 'https://srienlinea.sri.gob.ec/tuportal-internet/accederAplicacion.jspa?redireccion=164&idGrupo=160' },
    { nombre: 'Consulte sus vehiculos', url: 'https://srienlinea.sri.gob.ec/tuportal-internet/accederAplicacion.jspa?redireccion=165&idGrupo=160' },
    { nombre: 'Exonere sus vehiculos', url: 'https://srienlinea.sri.gob.ec/tuportal-internet/accederAplicacion.jspa?redireccion=166&idGrupo=160' },
  ]},
  { nombre: 'Tramites y Notificaciones', items: [
    { nombre: 'Ingreso de tramites', url: 'https://srienlinea.sri.gob.ec/tuportal-internet/accederAplicacion.jspa?redireccion=2492&idGrupo=136' },
    { nombre: 'Estado individual de tramite', url: 'https://srienlinea.sri.gob.ec/tuportal-internet/accederAplicacion.jspa?redireccion=137&idGrupo=136' },
    { nombre: 'Historial de mis tramites', url: 'https://srienlinea.sri.gob.ec/tuportal-internet/accederAplicacion.jspa?redireccion=138&idGrupo=136' },
    { nombre: 'Buzon del contribuyente', url: 'https://srienlinea.sri.gob.ec/sri-en-linea/SriBuzon/Contribuyente/notificaciones' },
    { nombre: 'Documentos notificados', url: 'https://srienlinea.sri.gob.ec/tuportal-internet/accederAplicacion.jspa?redireccion=142&idGrupo=139' },
  ]},
  { nombre: 'Reintegro de valores', url: 'https://srienlinea.sri.gob.ec/tuportal-internet/accederAplicacion.jspa?redireccion=2792&idGrupo=145' },
];

/**
 * Renderiza el menu principal de accesos directos al SRI.
 * Muestra un boton primario destacado y una grilla de categorias.
 * Las categorias con sub-items abren un submenu al hacer click.
 */
function renderSriMenu() {
  const container = document.getElementById('sriMenuContainer');
  container.innerHTML = '';

  // Renderizar botones primarios destacados (Descargar recibidos / emitidos)
  SRI_MENU.filter(m => m.primary).forEach(primary => {
    const btn = document.createElement('a');
    btn.className = 'sri-link sri-link-primary';
    btn.textContent = primary.nombre;
    if (primary.items) {
      btn.addEventListener('click', () => renderSriSubmenu(primary));
    } else if (primary.esEmitidos) {
      btn.addEventListener('click', () => navegarSRIEmitidos(primary.url));
    } else {
      btn.addEventListener('click', () => navegarSRI(primary.url));
    }
    container.appendChild(btn);
  });

  // Renderizar grilla de categorias
  const grid = document.createElement('div');
  grid.className = 'sri-links-grid';

  SRI_MENU.forEach(item => {
    if (item.primary) return; // Saltar el primario ya renderizado
    const btn = document.createElement('a');
    btn.className = 'sri-link';
    btn.textContent = item.nombre;
    if (item.items) {
      // Categoria con sub-items: abrir submenu
      btn.addEventListener('click', () => renderSriSubmenu(item));
    } else {
      // Link directo: navegar a la URL
      btn.addEventListener('click', () => navegarSRI(item.url));
    }
    grid.appendChild(btn);
  });

  container.appendChild(grid);
}

/**
 * Renderiza un submenu de una categoria del SRI con un boton "Volver"
 * para regresar al menu principal.
 * @param {Object} category - Categoria del menu con items y nombre
 * @param {string} category.nombre - Nombre de la categoria
 * @param {Array<{nombre: string, url: string}>} category.items - Sub-items de la categoria
 */
function renderSriSubmenu(category) {
  const container = document.getElementById('sriMenuContainer');
  container.innerHTML = '';

  // Cabecera del submenu con boton volver y titulo
  const header = document.createElement('div');
  header.className = 'sri-submenu-header';

  const backBtn = document.createElement('a');
  backBtn.className = 'sri-back-btn';
  backBtn.textContent = '\u2039 Volver';
  backBtn.addEventListener('click', renderSriMenu);
  header.appendChild(backBtn);

  const title = document.createElement('div');
  title.className = 'sri-submenu-title';
  title.textContent = category.nombre;
  header.appendChild(title);

  container.appendChild(header);

  // Grilla de sub-items de la categoria
  const grid = document.createElement('div');
  grid.className = 'sri-links-grid';

  category.items.forEach(item => {
    const btn = document.createElement('a');
    btn.className = 'sri-link';
    btn.textContent = item.nombre;
    btn.addEventListener('click', () => navegarSRI(item.url, item.tipoComprobante));
    grid.appendChild(btn);
  });

  container.appendChild(grid);
}

/**
 * Navega a la pantalla de comprobantes emitidos. La URL de "Consultas
 * (produccion)" cae en un menu intermedio (menu.jsf); el background espera
 * la carga y hace click en la opcion "Comprobantes electronicos emitidos".
 * @param {string} url - URL de accederAplicacion.jspa (redireccion=60)
 */
async function navegarSRIEmitidos(url) {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  chrome.runtime.sendMessage({ action: 'navegarAEmitidos', tabId: tab.id, url });
  window.close();
}

/**
 * Navega a una URL del SRI en la tab activa y cierra el popup.
 * Si es la pagina de comprobantes, setea dia = "Todos" y tipo de comprobante.
 * @param {string} url - URL destino dentro del portal SRI
 * @param {string} [tipoComprobante] - Valor del select de tipo de comprobante (1=Factura, 2=Liquidacion, etc.)
 */
async function navegarSRI(url, tipoComprobante) {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

  if (url.includes('redireccion=57')) {
    chrome.runtime.sendMessage({ action: 'navegarYSetearDia', tabId: tab.id, url, tipoComprobante });
  } else {
    chrome.tabs.update(tab.id, { url });
  }

  window.close();
}

// =====================================================
// Inicializacion del popup
// =====================================================

/**
 * Punto de entrada principal: al cargar el DOM del popup,
 * restaura las preferencias del usuario y carga los documentos de la pagina actual.
 */
/**
 * Detecta si el navegador es Edge y muestra advertencia sobre SmartScreen.
 * La advertencia se puede descartar y se recuerda la preferencia.
 */
function detectarEdge() {
  const isEdge = navigator.userAgent.includes('Edg/');
  if (!isEdge) return;

  chrome.storage.local.get(['edgeWarningDismissed'], (data) => {
    if (data.edgeWarningDismissed) return;

    const warning = document.getElementById('edgeWarning');
    warning.style.display = 'block';

    document.getElementById('btnDismissEdge').addEventListener('click', () => {
      warning.style.display = 'none';
      chrome.storage.local.set({ edgeWarningDismissed: true });
    });
  });
}

document.addEventListener('DOMContentLoaded', () => {
  detectarEdge();
  restaurarTipoDescarga();
  cargarDocumentos();
});
