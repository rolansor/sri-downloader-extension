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
 * Obtiene los índices de documentos seleccionados
 */
function getIndicesSeleccionados() {
  const checkboxes = docList.querySelectorAll('input[type="checkbox"]:checked');
  return Array.from(checkboxes).map(cb => parseInt(cb.dataset.index));
}

/**
 * Renderiza la lista de documentos
 */
function renderizarDocumentos() {
  docList.innerHTML = '';

  documentos.forEach(doc => {
    const item = document.createElement('div');
    item.className = 'doc-item';
    item.innerHTML = `
      <input type="checkbox" data-index="${doc.index}" checked>
      <div class="doc-info">
        <div class="doc-tipo">${doc.tipoYSerie || 'Sin información'}</div>
        <div class="doc-ruc">RUC: ${doc.ruc || 'N/A'} | Fecha: ${doc.fecha || 'N/A'}</div>
      </div>
    `;
    docList.appendChild(item);
  });

  selectAll.checked = true;
}

/**
 * Actualiza la UI según el estado de descarga
 */
function actualizarUIEstado(estado) {
  if (estado.activo) {
    // Descarga en progreso
    progressContainer.classList.add('active');
    controlesDescarga.style.display = 'none';
    btnDetener.disabled = false;

    const porcentaje = estado.totalPaginas > 0
      ? Math.round((estado.paginaActual / estado.totalPaginas) * 100)
      : 0;
    progressFill.style.width = `${Math.min(porcentaje, 95)}%`;

    let textoProgreso = `Página ${estado.paginaActual}/${estado.totalPaginas} - `;
    textoProgreso += `${estado.exitosos} OK`;
    if (estado.fallidos > 0) textoProgreso += `, ${estado.fallidos} fallidos`;
    if (estado.omitidos > 0) textoProgreso += `, ${estado.omitidos} omitidos`;

    progressText.textContent = textoProgreso;

  } else {
    // Descarga terminada o no activa
    controlesDescarga.style.display = 'block';

    if (estado.exitosos > 0 || estado.fallidos > 0 || estado.omitidos > 0) {
      // Mostrar resultado final
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

      // Ocultar progreso después de 3 segundos
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
 * Carga los documentos de la página actual
 */
async function cargarDocumentos() {
  try {
    // Primero verificar si hay descarga en progreso
    const estado = await verificarEstadoDescarga();

    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

    if (!tab.url.includes('srienlinea.sri.gob.ec')) {
      mostrarEstado('Esta extensión solo funciona en srienlinea.sri.gob.ec', 'error');
      return;
    }

    // Intentar inyectar el content script si no está cargado
    try {
      await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        files: ['content.js']
      });
    } catch (e) {
      // El script puede ya estar inyectado
    }

    await new Promise(r => setTimeout(r, 100));

    // Solicitar documentos al content script
    chrome.tabs.sendMessage(tab.id, { action: 'obtenerDocumentos' }, (response) => {
      if (chrome.runtime.lastError) {
        mostrarEstado('Error al comunicarse con la página. Recarga la página e intenta de nuevo.', 'error');
        return;
      }

      if (response?.error) {
        mostrarEstado(response.error, 'error');
        return;
      }

      documentos = response?.documentos || [];
      paginacion = response?.paginacion || { actual: 1, total: 1 };

      if (documentos.length === 0) {
        mostrarEstado('No se encontraron documentos. Asegúrate de haber ejecutado una consulta.', 'info');
        return;
      }

      // Mostrar contenido
      statusBox.style.display = 'none';
      contentArea.style.display = 'block';

      // Actualizar información
      totalDocs.textContent = documentos.length;
      paginaInfo.textContent = `${paginacion.actual} de ${paginacion.total}`;

      // Renderizar lista
      renderizarDocumentos();

      // Si hay descarga activa, actualizar UI
      if (estado?.activo) {
        actualizarUIEstado(estado);
      }
    });

  } catch (error) {
    mostrarEstado(`Error: ${error.message}`, 'error');
  }
}

/**
 * Inicia la descarga de TODAS las páginas (persistente)
 */
async function iniciarDescargaTotal() {
  const tipoDescarga = getTipoDescarga();

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
 * Inicia la descarga de documentos seleccionados (solo página actual)
 */
async function iniciarDescarga() {
  const indices = getIndicesSeleccionados();

  if (indices.length === 0) {
    mostrarEstado('Selecciona al menos un documento', 'error');
    setTimeout(() => statusBox.style.display = 'none', 2000);
    return;
  }

  const tipoDescarga = getTipoDescarga();

  btnDescargar.disabled = true;
  btnDescargarTodo.disabled = true;
  progressContainer.classList.add('active');
  progressFill.style.width = '0%';
  progressText.textContent = `Descargando 0 de ${indices.length}...`;

  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

    chrome.tabs.sendMessage(tab.id, {
      action: 'descargarSeleccionados',
      indices: indices,
      tipoDescarga: tipoDescarga
    });

  } catch (error) {
    mostrarEstado(`Error: ${error.message}`, 'error');
    btnDescargar.disabled = false;
    btnDescargarTodo.disabled = false;
    progressContainer.classList.remove('active');
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

  // Para descarga de página individual (del content script)
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

// Filtros de historial
document.querySelectorAll('input[name="filtroHistorial"]').forEach(radio => {
  radio.addEventListener('change', cargarHistorial);
});

// Tabs
document.querySelectorAll('.tab-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    // Actualizar botones
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');

    // Mostrar contenido correcto
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
 * Carga el historial de descargas
 */
async function cargarHistorial() {
  const filtro = document.querySelector('input[name="filtroHistorial"]:checked')?.value || 'fallidos';

  listaHistorial.innerHTML = '<p class="empty-msg">Cargando...</p>';

  chrome.runtime.sendMessage({ action: 'obtenerHistorial' }, (response) => {
    if (response?.error) {
      listaHistorial.innerHTML = '<p class="empty-msg">Error al cargar historial</p>';
      return;
    }

    const historial = response?.historial || {};
    let documentos = [];

    // Extraer todos los documentos del historial
    for (const ruc in historial) {
      for (const sesionId in historial[ruc].sesiones) {
        const sesion = historial[ruc].sesiones[sesionId];
        documentos.push(...sesion.documentos.map(d => ({
          ...d,
          rucUsuario: ruc,
          sesionId: sesionId
        })));
      }
    }

    // Filtrar según selección
    if (filtro === 'fallidos') {
      documentos = documentos.filter(d => !d.exito);
    } else if (filtro === 'exitosos') {
      documentos = documentos.filter(d => d.exito);
    }

    // Ordenar por fecha más reciente
    documentos.sort((a, b) => new Date(b.fechaDescarga) - new Date(a.fechaDescarga));

    if (documentos.length === 0) {
      const textoVacio = filtro === 'fallidos' ? 'No hay documentos fallidos' :
                         filtro === 'exitosos' ? 'No hay documentos exitosos' :
                         'No hay documentos en el historial';
      listaHistorial.innerHTML = `<p class="empty-msg">${textoVacio}</p>`;
      resumenHistorial.style.display = 'none';
      return;
    }

    listaHistorial.innerHTML = '';

    documentos.forEach(doc => {
      const item = document.createElement('div');
      item.className = `fallido-item historial-item ${doc.exito ? 'exitoso' : 'fallido'}`;

      const fecha = new Date(doc.fechaDescarga).toLocaleString('es-EC', {
        day: '2-digit',
        month: '2-digit',
        year: '2-digit',
        hour: '2-digit',
        minute: '2-digit'
      });

      const estado = doc.exito ? '✓' : '✗';
      const errorHtml = doc.error ? `<div class="fallido-error">${doc.error}</div>` : '';

      item.innerHTML = `
        <div class="fallido-info">
          <div class="fallido-detalle">
            <div class="fallido-tipo">${estado} ${doc.tipoDoc} ${doc.serie}</div>
            <div class="fallido-ruc">RUC: ${doc.ruc} - ${doc.razonSocial || ''}</div>
            ${errorHtml}
          </div>
          <div class="fallido-fecha">${fecha}</div>
        </div>
      `;
      listaHistorial.appendChild(item);
    });

    // Mostrar resumen
    const exitosos = documentos.filter(d => d.exito).length;
    const fallidos = documentos.filter(d => !d.exito).length;
    resumenHistorial.style.display = 'block';
    resumenTexto.textContent = `Mostrando ${documentos.length} documentos (${exitosos} exitosos, ${fallidos} fallidos)`;
  });
}

/**
 * Limpia el historial de descargas
 */
async function limpiarHistorial() {
  if (!confirm('¿Limpiar todo el historial de descargas?\n\nEsto permitirá volver a descargar todos los documentos.')) return;

  chrome.runtime.sendMessage({ action: 'limpiarHistorial' }, (response) => {
    if (response?.success) {
      listaHistorial.innerHTML = '<p class="empty-msg">Historial limpiado</p>';
      resumenHistorial.style.display = 'none';
    }
  });
}

// Cargar documentos al abrir el popup
document.addEventListener('DOMContentLoaded', cargarDocumentos);
