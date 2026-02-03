/**
 * SRI Document Downloader - Popup Script
 * Maneja la interfaz de usuario del popup
 */

let documentos = [];
let paginacion = { actual: 1, total: 1 };

// Elementos del DOM
const statusBox = document.getElementById('statusBox');
const statusMessage = document.getElementById('statusMessage');
const contentArea = document.getElementById('contentArea');
const totalDocs = document.getElementById('totalDocs');
const paginaInfo = document.getElementById('paginaInfo');
const docList = document.getElementById('docList');
const selectAll = document.getElementById('selectAll');
const btnDescargar = document.getElementById('btnDescargar');
const btnDescargarTodo = document.getElementById('btnDescargarTodo');
const btnDetener = document.getElementById('btnDetener');
const progressContainer = document.getElementById('progressContainer');
const progressFill = document.getElementById('progressFill');
const progressText = document.getElementById('progressText');
const controlesDescarga = document.getElementById('controlesDescarga');
const historialArea = document.getElementById('historialArea');
const listaHistorial = document.getElementById('listaHistorial');
const btnLimpiarHistorial = document.getElementById('btnLimpiarHistorial');
const btnExportarHistorial = document.getElementById('btnExportarHistorial');
const btnReintentarFallidos = document.getElementById('btnReintentarFallidos');
const resumenHistorial = document.getElementById('resumenHistorial');
const resumenTexto = document.getElementById('resumenTexto');

/**
 * Muestra un mensaje de estado
 */
function mostrarEstado(mensaje, tipo = 'info') {
  statusBox.className = `status-box ${tipo}`;
  statusMessage.textContent = mensaje;
  statusBox.style.display = 'block';
}

/**
 * Obtiene el tipo de descarga seleccionado
 */
function getTipoDescarga() {
  return document.querySelector('input[name="tipoDescarga"]:checked').value;
}

/**
 * Obtiene los indices de documentos seleccionados
 */
function getIndicesSeleccionados() {
  const checkboxes = docList.querySelectorAll('input[type="checkbox"]:checked');
  return Array.from(checkboxes).map(cb => parseInt(cb.dataset.index));
}

/**
 * Renderiza la lista de documentos (sin innerHTML para evitar XSS)
 */
function renderizarDocumentos() {
  docList.innerHTML = '';

  documentos.forEach(doc => {
    const item = document.createElement('div');
    item.className = 'doc-item';

    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.dataset.index = doc.index;
    checkbox.checked = true;

    const info = document.createElement('div');
    info.className = 'doc-info';

    const tipo = document.createElement('div');
    tipo.className = 'doc-tipo';
    tipo.textContent = doc.tipoYSerie || 'Sin informacion';

    const ruc = document.createElement('div');
    ruc.className = 'doc-ruc';
    ruc.textContent = `RUC: ${doc.ruc || 'N/A'} | Fecha: ${doc.fecha || 'N/A'}`;

    info.appendChild(tipo);
    info.appendChild(ruc);
    item.appendChild(checkbox);
    item.appendChild(info);
    docList.appendChild(item);
  });

  selectAll.checked = true;
}

/**
 * Formatea milisegundos a texto legible (ej: "2:30")
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

/**
 * Actualiza la UI segun el estado de descarga
 */
function actualizarUIEstado(estado) {
  if (estado.activo) {
    progressContainer.classList.add('active');
    controlesDescarga.style.display = 'none';
    btnDetener.disabled = false;

    // Progreso granular por documento
    const porcentaje = estado.totalDocumentos > 0
      ? Math.round((estado.documentoActual / estado.totalDocumentos) * 100)
      : 0;
    progressFill.style.width = `${Math.min(porcentaje, 98)}%`;

    let textoProgreso = `Pag ${estado.paginaActual}/${estado.totalPaginas} - `;
    textoProgreso += `${estado.exitosos} OK`;
    if (estado.fallidos > 0) textoProgreso += `, ${estado.fallidos} fallidos`;
    if (estado.omitidos > 0) textoProgreso += `, ${estado.omitidos} omitidos`;

    // Estimacion de tiempo restante
    const tiempoTexto = formatearTiempo(estado.tiempoEstimado);
    if (tiempoTexto) textoProgreso += ` (${tiempoTexto})`;

    progressText.textContent = textoProgreso;

  } else {
    controlesDescarga.style.display = 'block';

    if (estado.exitosos > 0 || estado.fallidos > 0 || estado.omitidos > 0) {
      progressFill.style.width = '100%';

      let mensaje = estado.detenido ? 'Detenido: ' : 'Completado: ';
      mensaje += `${estado.exitosos} OK`;
      if (estado.fallidos > 0) mensaje += `, ${estado.fallidos} fallidos`;
      if (estado.omitidos > 0) mensaje += `, ${estado.omitidos} omitidos`;

      progressText.textContent = mensaje;

      if (estado.fallidos === 0 && estado.exitosos > 0) {
        mostrarEstado(mensaje, 'success');
      } else if (estado.exitosos > 0) {
        mostrarEstado(mensaje, 'info');
      }

      // Sonido al completar
      reproducirSonido();

      setTimeout(() => {
        progressContainer.classList.remove('active');
        statusBox.style.display = 'none';
      }, 3000);
    } else {
      progressContainer.classList.remove('active');
    }

    btnDetener.disabled = true;
    btnDescargar.disabled = false;
    btnDescargarTodo.disabled = false;
  }
}

/**
 * Reproduce un beep corto al completar descarga
 */
function reproducirSonido() {
  try {
    const ctx = new AudioContext();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.frequency.value = 800;
    gain.gain.value = 0.1;
    osc.start();
    osc.stop(ctx.currentTime + 0.15);
    // Segundo beep
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

/**
 * Verifica el estado actual de descarga al abrir popup
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
 * Carga los documentos de la pagina actual
 */
async function cargarDocumentos() {
  try {
    const estado = await verificarEstadoDescarga();

    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

    if (!tab.url.includes('srienlinea.sri.gob.ec')) {
      mostrarEstado('Esta extension solo funciona en srienlinea.sri.gob.ec', 'error');
      return;
    }

    // Inyectar config.js y content.js si no estan cargados
    try {
      await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        files: ['config.js', 'content.js']
      });
    } catch (e) {
      // Los scripts pueden ya estar inyectados
    }

    await new Promise(r => setTimeout(r, 100));

    chrome.tabs.sendMessage(tab.id, { action: 'obtenerDocumentos' }, (response) => {
      if (chrome.runtime.lastError) {
        mostrarEstado('Error al comunicarse con la pagina. Recarga la pagina e intenta de nuevo.', 'error');
        return;
      }

      if (response?.error) {
        mostrarEstado(response.error, 'error');
        return;
      }

      documentos = response?.documentos || [];
      paginacion = response?.paginacion || { actual: 1, total: 1 };

      if (documentos.length === 0) {
        mostrarEstado('No se encontraron documentos. Asegurate de haber ejecutado una consulta.', 'info');
        return;
      }

      statusBox.style.display = 'none';
      contentArea.style.display = 'block';

      totalDocs.textContent = documentos.length;
      paginaInfo.textContent = `${paginacion.actual} de ${paginacion.total}`;

      renderizarDocumentos();

      if (estado?.activo) {
        actualizarUIEstado(estado);
      }
    });

  } catch (error) {
    mostrarEstado(`Error: ${error.message}`, 'error');
  }
}

/**
 * Inicia la descarga de TODAS las paginas con confirmacion
 */
async function iniciarDescargaTotal() {
  const tipoDescarga = getTipoDescarga();

  // Estimacion y confirmacion
  const estimado = documentos.length * paginacion.total;
  const tipoTexto = tipoDescarga === 'ambos' ? 'XML + PDF' : tipoDescarga.toUpperCase();
  if (!confirm(`Se descargaran aprox. ${estimado} documentos (${tipoTexto}) de ${paginacion.total} pagina(s).\n\nDocumentos ya descargados se omitiran automaticamente.\n\n¿Continuar?`)) {
    return;
  }

  btnDescargar.disabled = true;
  btnDescargarTodo.disabled = true;
  btnDetener.disabled = false;
  progressContainer.classList.add('active');
  controlesDescarga.style.display = 'none';
  progressFill.style.width = '0%';
  progressText.textContent = 'Iniciando descarga...';

  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

    chrome.runtime.sendMessage({
      action: 'iniciarDescargaTotal',
      tabId: tab.id,
      tipoDescarga: tipoDescarga
    });

  } catch (error) {
    mostrarEstado(`Error: ${error.message}`, 'error');
    btnDescargar.disabled = false;
    btnDescargarTodo.disabled = false;
    btnDetener.disabled = true;
    progressContainer.classList.remove('active');
    controlesDescarga.style.display = 'block';
  }
}

/**
 * Inicia la descarga de documentos seleccionados (solo pagina actual)
 */
async function iniciarDescarga() {
  const indices = getIndicesSeleccionados();

  if (indices.length === 0) {
    mostrarEstado('Selecciona al menos un documento', 'error');
    setTimeout(() => statusBox.style.display = 'none', 2000);
    return;
  }

  const tipoDescarga = getTipoDescarga();

  // Filtrar documentos por indices seleccionados
  const docsSeleccionados = documentos.filter(d => indices.includes(d.index));

  btnDescargar.disabled = true;
  btnDescargarTodo.disabled = true;
  btnDetener.disabled = false;
  progressContainer.classList.add('active');
  controlesDescarga.style.display = 'none';
  progressFill.style.width = '0%';
  progressText.textContent = `Descargando 0 de ${docsSeleccionados.length}...`;

  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

    chrome.runtime.sendMessage({
      action: 'descargarPaginaActual',
      tabId: tab.id,
      tipoDescarga: tipoDescarga,
      indices: indices
    });

  } catch (error) {
    mostrarEstado(`Error: ${error.message}`, 'error');
    btnDescargar.disabled = false;
    btnDescargarTodo.disabled = false;
    btnDetener.disabled = true;
    progressContainer.classList.remove('active');
    controlesDescarga.style.display = 'block';
  }
}

/**
 * Detiene la descarga en progreso
 */
async function detenerDescarga() {
  progressText.textContent = 'Deteniendo...';
  btnDetener.disabled = true;
  chrome.runtime.sendMessage({ action: 'detenerDescarga' });
}

// Escuchar actualizaciones de estado desde el background
chrome.runtime.onMessage.addListener((request) => {
  if (request.action === 'estadoDescarga') {
    actualizarUIEstado(request.estado);
  }

  if (request.action === 'progreso') {
    progressText.textContent = `Descargando ${request.actual} de ${request.total || '?'}...`;
    const porcentaje = request.total ? (request.actual / request.total) * 100 : 50;
    progressFill.style.width = `${porcentaje}%`;
  }

  if (request.action === 'descargaCompleta') {
    const resultado = request.resultado;
    progressFill.style.width = '100%';

    const mensaje = `Completado: ${resultado.exitosos} exitosos, ${resultado.fallidos} fallidos`;
    progressText.textContent = mensaje;

    if (resultado.fallidos === 0) {
      mostrarEstado(mensaje, 'success');
    } else {
      mostrarEstado(mensaje, 'info');
    }

    reproducirSonido();

    setTimeout(() => {
      btnDescargar.disabled = false;
      btnDescargarTodo.disabled = false;
      progressContainer.classList.remove('active');
      statusBox.style.display = 'none';
    }, 3000);
  }
});

// Event Listeners
selectAll.addEventListener('change', () => {
  const checkboxes = docList.querySelectorAll('input[type="checkbox"]');
  checkboxes.forEach(cb => cb.checked = selectAll.checked);
});

btnDescargar.addEventListener('click', iniciarDescarga);
btnDescargarTodo.addEventListener('click', iniciarDescargaTotal);
btnDetener.addEventListener('click', detenerDescarga);
btnLimpiarHistorial.addEventListener('click', limpiarHistorial);
btnExportarHistorial.addEventListener('click', exportarHistorial);
btnReintentarFallidos.addEventListener('click', reintentarFallidos);

// Recordar tipo de descarga seleccionado
document.querySelectorAll('input[name="tipoDescarga"]').forEach(radio => {
  radio.addEventListener('change', () => {
    chrome.storage.local.set({ ultimoTipoDescarga: radio.value });
  });
});

// Filtros de historial
document.querySelectorAll('input[name="filtroHistorial"]').forEach(radio => {
  radio.addEventListener('change', cargarHistorial);
});

// Tabs
document.querySelectorAll('.tab-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');

    const tab = btn.dataset.tab;
    if (tab === 'descarga') {
      contentArea.style.display = 'block';
      historialArea.style.display = 'none';
    } else {
      contentArea.style.display = 'none';
      historialArea.style.display = 'block';
      cargarHistorial();
    }
  });
});

/**
 * Carga el historial de descargas (sin innerHTML para evitar XSS)
 */
async function cargarHistorial() {
  const filtro = document.querySelector('input[name="filtroHistorial"]:checked')?.value || 'fallidos';

  listaHistorial.innerHTML = '';
  const loadingMsg = document.createElement('p');
  loadingMsg.className = 'empty-msg';
  loadingMsg.textContent = 'Cargando...';
  listaHistorial.appendChild(loadingMsg);

  chrome.runtime.sendMessage({ action: 'obtenerHistorial' }, (response) => {
    if (response?.error) {
      listaHistorial.innerHTML = '';
      const errMsg = document.createElement('p');
      errMsg.className = 'empty-msg';
      errMsg.textContent = 'Error al cargar historial';
      listaHistorial.appendChild(errMsg);
      return;
    }

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

    if (filtro === 'fallidos') {
      docs = docs.filter(d => !d.exito);
    } else if (filtro === 'exitosos') {
      docs = docs.filter(d => d.exito);
    }

    docs.sort((a, b) => new Date(b.fechaDescarga) - new Date(a.fechaDescarga));

    // Mostrar/ocultar boton reintentar
    const hayFallidos = docs.some(d => !d.exito) || (filtro === 'fallidos' && docs.length > 0);
    btnReintentarFallidos.style.display = hayFallidos ? 'block' : 'none';

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

    listaHistorial.innerHTML = '';

    docs.forEach(doc => {
      const item = document.createElement('div');
      item.className = `fallido-item historial-item ${doc.exito ? 'exitoso' : 'fallido'}`;

      const fecha = new Date(doc.fechaDescarga).toLocaleString('es-EC', {
        day: '2-digit', month: '2-digit', year: '2-digit',
        hour: '2-digit', minute: '2-digit'
      });

      const infoDiv = document.createElement('div');
      infoDiv.className = 'fallido-info';

      const detalleDiv = document.createElement('div');
      detalleDiv.className = 'fallido-detalle';

      const tipoDiv = document.createElement('div');
      tipoDiv.className = 'fallido-tipo';
      tipoDiv.textContent = `${doc.exito ? '\u2713' : '\u2717'} ${doc.tipoDoc || ''} ${doc.serie || ''}`;

      const rucDiv = document.createElement('div');
      rucDiv.className = 'fallido-ruc';
      rucDiv.textContent = `RUC: ${doc.ruc || ''} - ${doc.razonSocial || ''}`;

      detalleDiv.appendChild(tipoDiv);
      detalleDiv.appendChild(rucDiv);

      if (doc.error) {
        const errorDiv = document.createElement('div');
        errorDiv.className = 'fallido-error';
        errorDiv.textContent = doc.error;
        detalleDiv.appendChild(errorDiv);
      }

      const fechaDiv = document.createElement('div');
      fechaDiv.className = 'fallido-fecha';
      fechaDiv.textContent = fecha;

      infoDiv.appendChild(detalleDiv);
      infoDiv.appendChild(fechaDiv);
      item.appendChild(infoDiv);
      listaHistorial.appendChild(item);
    });

    const exitosos = docs.filter(d => d.exito).length;
    const fallidos = docs.filter(d => !d.exito).length;
    resumenHistorial.style.display = 'block';
    resumenTexto.textContent = `Mostrando ${docs.length} documentos (${exitosos} exitosos, ${fallidos} fallidos)`;
  });
}

/**
 * Limpia el historial de descargas
 */
async function limpiarHistorial() {
  if (!confirm('Limpiar todo el historial de descargas?\n\nEsto permitira volver a descargar todos los documentos.')) return;

  chrome.runtime.sendMessage({ action: 'limpiarHistorial' }, (response) => {
    if (response?.success) {
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
 * Exporta el historial a CSV
 */
async function exportarHistorial() {
  chrome.runtime.sendMessage({ action: 'obtenerHistorial' }, (response) => {
    if (response?.error || !response?.historial) {
      mostrarEstado('Error al exportar historial', 'error');
      return;
    }

    const historial = response.historial;
    const filas = [];

    // Header
    filas.push(['RUC Emisor', 'Razon Social', 'Tipo Doc', 'Serie', 'Clave Acceso', 'Fecha Emision', 'Fecha Autorizacion', 'Estado', 'Error', 'Fecha Descarga'].join(','));

    for (const ruc in historial) {
      for (const sesionId in historial[ruc].sesiones) {
        const sesion = historial[ruc].sesiones[sesionId];
        for (const doc of sesion.documentos) {
          const fila = [
            doc.ruc || '',
            `"${(doc.razonSocial || '').replace(/"/g, '""')}"`,
            doc.tipoDoc || '',
            doc.serie || '',
            doc.claveAcceso || '',
            doc.fechaEmision || '',
            doc.fechaAutorizacion || '',
            doc.exito ? 'OK' : 'FALLIDO',
            `"${(doc.error || '').replace(/"/g, '""')}"`,
            doc.fechaDescarga || ''
          ];
          filas.push(fila.join(','));
        }
      }
    }

    if (filas.length <= 1) {
      mostrarEstado('No hay datos para exportar', 'info');
      return;
    }

    const csv = filas.join('\n');
    const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);

    chrome.downloads.download({
      url: url,
      filename: `historial_sri_${new Date().toISOString().slice(0, 10)}.csv`,
      saveAs: true
    });
  });
}

/**
 * Reintentar descarga (la deduplicacion omite los ya descargados)
 */
async function reintentarFallidos() {
  // Cambiar a tab de descarga
  document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
  document.querySelector('[data-tab="descarga"]').classList.add('active');
  contentArea.style.display = 'block';
  historialArea.style.display = 'none';

  // Iniciar descarga total (la deduplicacion se encarga de omitir exitosos)
  iniciarDescargaTotal();
}

/**
 * Restaura el tipo de descarga guardado previamente
 */
async function restaurarTipoDescarga() {
  const data = await chrome.storage.local.get(['ultimoTipoDescarga']);
  if (data.ultimoTipoDescarga) {
    const radio = document.querySelector(`input[name="tipoDescarga"][value="${data.ultimoTipoDescarga}"]`);
    if (radio) radio.checked = true;
  }
}

// Cargar documentos al abrir el popup
document.addEventListener('DOMContentLoaded', () => {
  restaurarTipoDescarga();
  cargarDocumentos();
});
