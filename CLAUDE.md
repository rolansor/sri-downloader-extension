# CLAUDE.md - Guia para Claude Code

## Proyecto
Extension de Chrome (Manifest V3) para descargar documentos XML/PDF del SRI Ecuador.
Organiza archivos en carpetas configurables y ofrece accesos directos al portal SRI.
Version: 1.4.0 | Dominio: `srienlinea.sri.gob.ec`

## Estructura de archivos
```
sri-downloader-extension/
├── manifest.json      # Manifest V3 config (permisos, service worker, content scripts)
├── config.js          # Constantes compartidas (delays, selectores, timeouts, organizacion)
├── background.js      # Service Worker - descargas, organizacion archivos, navegacion SRI
├── content.js         # Content Script - extractor de datos DOM (~80 lineas)
├── popup.html         # UI del popup (4 tabs + accesos directos SRI + modal)
├── popup.js           # Logica del popup (menu SRI, config, organizacion, historial)
├── popup.css          # Estilos (light + dark mode)
├── icons/             # Iconos PNG y SVG (16, 48, 128)
├── README.md
└── CLAUDE.md
```

## Comandos utiles
- Actualizar extension: `chrome://extensions/` > click en actualizar
- Ver logs background: `chrome://extensions/` > "Service worker" > click para inspeccionar
- Ver logs pagina: F12 en la pagina del SRI

## Arquitectura clave

### Config - `config.js`
- Constantes centralizadas: delays, timeouts, selectores, reintentos, organizacion
- Compartido entre background.js (via `importScripts`) y content.js (via content_scripts en manifest)
- Objeto global `SRI_CONFIG` con guard `if (typeof SRI_CONFIG !== 'undefined')` para evitar redeclaracion
- Config de organizacion con estructura fija: `carpetaRaiz / [orden] / recibidos / tipoDoc / xml|pdf / archivo`

### Background (Service Worker) - `background.js`
- **Persistente**: Continua aunque se cierre el popup
- **Doble metodo de descarga**: `mojarra.jsfcljs()` (directo JSF) o click emulado
- Ejecuta descargas con `chrome.scripting.executeScript({ world: 'MAIN' })`
- Verifica descargas reales con `chrome.downloads.onCreated` (ventana de tiempo)
- Auto-acepta descargas "peligrosas" del SRI con `chrome.downloads.acceptDanger`
- Guarda historial en `chrome.storage.local` (organizado por RUC)
- Enfoque **secuencial**: espera confirmacion de descarga antes de continuar
- Buffer en memoria durante sesion, escribe a storage al finalizar
- Limpieza automatica de historial >30 dias
- Indice Set() para deduplicacion O(1) (distingue XML y PDF por separado)
- Reintentos automaticos (configurable, default 2)
- Espera inteligente de paginacion (polling en vez de delay fijo)
- Detecta tab cerrada y aborta descarga
- Badge en icono con progreso
- Notificacion Chrome al finalizar
- Calcula tiempo estimado restante

### Organizacion de archivos (background.js)
- Usa `chrome.downloads.onDeterminingFilename` para interceptar descargas y asignar ruta organizada
- `downloadMetadataMap`: Map temporal que asocia downloadId con metadata del documento
- Metadata se propaga por la cadena: `ejecutarConReintento` -> `ejecutarDescargaSRI` -> `ejecutarDescargaMojarra`/`ejecutarDescargaClick`
- Ruta fija: `carpetaRaiz / [ruc/anio/mes o anio/mes/ruc] / recibidos / tipoDoc / nombre.ext`
- Ruta incluye subcarpeta `xml/` o `pdf/` para separar tipos de archivo
- Funciones auxiliares: `sanitizarNombreCarpeta`, `parsearFechaSRI`, `limpiarTipoDoc`, `construirNombreArchivo`, `construirRutaArchivo`
- `conflictAction: 'overwrite'` para sobrescribir archivos existentes
- Si deshabilitado, `suggest()` sin parametros = carpeta de descargas por defecto

### Navegacion SRI (background.js)
- Mensaje `navegarYSetearDia`: navega a comprobantes recibidos y setea automaticamente:
  - Dia del periodo = "Todos" (`frmPrincipal:dia` value `0`)
  - Tipo de comprobante segun seleccion (`frmPrincipal:cmbTipoComprobante`)
- Usa `chrome.tabs.onUpdated` + reintentos cada 1s (hasta 10) para esperar carga JSF

### Popup - `popup.html` / `popup.js` / `popup.css`
- **4 tabs** en grilla 2x2: Descargar | Historial | Configuracion | Organizacion
- Tabs se ocultan cuando no hay tabla de comprobantes (solo se muestran accesos directos)
- Se comunica con background via `chrome.runtime.sendMessage`
- Al abrir, consulta estado actual con `obtenerEstado`
- **Accesos directos SRI**: menu con submenus para navegar secciones del portal SRI
  - "Descargar comprobantes" tiene submenu con tipos: Facturas, Liquidaciones, Notas Credito/Debito, Retenciones
  - Cada opcion navega y pre-configura dia="Todos" + tipo de comprobante
- Muestra barra de progreso granular (por documento, no por pagina)
- Estimacion de tiempo restante ("~2:30 restantes")
- Confirmacion con modal antes de descarga masiva
- Historial filtrable: todos, exitosos, fallidos
- Exportar historial a CSV
- Boton reintentar fallidos
- Recordar ultimo tipo de descarga (XML/PDF/Ambos)
- Sonido al completar (AudioContext beep)
- Dark mode automatico (prefers-color-scheme)
- Construccion DOM segura (textContent, no innerHTML)
- Alerta al cambiar config de organizacion si hay historial previo

### Content Script - `content.js`
- Solo extractor de datos del DOM (~80 lineas)
- Extrae filas de tabla y paginacion
- Tiene guard `window.SRI_DOWNLOADER_LOADED` para evitar reinyeccion
- No ejecuta descargas (eso lo hace background)

## Mensajes entre componentes

### Popup -> Background
| Mensaje | Descripcion | Payload |
|---------|-------------|---------|
| `iniciarDescargaTotal` | Inicia descarga de todas las paginas | `{tabId, tipoDescarga, ignorarHistorial}` |
| `iniciarDescargaSeleccionados` | Descarga seleccionados de la pagina actual (sin dedup) | `{tabId, tipoDescarga, claves[]}` |
| `detenerDescarga` | Detiene descarga en progreso | - |
| `obtenerEstado` | Obtiene estado actual | - |
| `obtenerHistorial` | Obtiene historial completo | `{ruc?}` |
| `obtenerFallidos` | Lista documentos fallidos | - |
| `limpiarHistorial` | Limpia storage | - |
| `obtenerConfig` | Obtiene configuracion guardada | - |
| `guardarConfig` | Guarda configuracion | `{config}` |
| `navegarYSetearDia` | Navega a comprobantes y pre-configura formulario | `{tabId, url, tipoComprobante}` |

### Popup -> Content Script
| Mensaje | Descripcion |
|---------|-------------|
| `obtenerDocumentos` | Extrae documentos de la tabla actual |

### Background -> Popup
| Mensaje | Descripcion |
|---------|-------------|
| `estadoDescarga` | Actualizacion de progreso en tiempo real |

## Flujo de descarga
1. Popup muestra modal con estimado de documentos
2. Envia `iniciarDescargaTotal` a background con `tabId`, `tipoDescarga` e `ignorarHistorial`
3. Background carga config usuario y construye indice Set de descargados previos (O(1) lookup)
4. Ejecuta `chrome.scripting.executeScript` para obtener datos de pagina
5. Por cada documento: verifica deduplicacion (distingue XML/PDF), construye `docMeta`
6. Ejecuta descarga con `ejecutarConReintento` -> `ejecutarDescargaSRI` -> mojarra o click
7. `chrome.downloads.onCreated` guarda metadata en `downloadMetadataMap`
8. `chrome.downloads.onDeterminingFilename` intercepta y asigna ruta organizada
9. Espera inteligente (polling paginador) entre cambios de pagina
10. Actualiza badge, calcula tiempo estimado, notifica popup
11. Al finalizar: guarda buffer en storage, limpia downloadMetadataMap, notificacion Chrome

## Organizacion de archivos - Estructura de ruta
```
carpetaRaiz / [orden configurable] / recibidos / tipoDoc / xml|pdf / nombre.ext
```

### Orden configurable (2 opciones):
- `ruc_fecha`: `ruc / anio / mes` (default)
- `fecha_ruc`: `anio / mes / ruc`

### Niveles fijos (no configurables):
- `recibidos` (tipo de movimiento, siempre recibidos por ahora)
- Tipo de documento: `factura`, `notas_de_credito`, `comprobante_de_retencion`, etc.
- Tipo de archivo: `xml` o `pdf`

### Extraccion de serie:
- La celda 2 de la tabla contiene tipo + serie juntos (ej: "Factura  001-006-055715817")
- Se extrae la serie con regex `\d{3}-\d{3}-\d+` (ej: "001-006-055715817")

### Formatos de nombre de archivo:
| Formato | Ejemplo |
|---------|---------|
| `claveAcceso` (default) | `0103202601179184765200120010010347004903470049013.xml` |
| `ruc_serie` | `1791847652001_001001034700490.xml` |
| `razon_serie` | `SETEL_S.A._001001034700490.xml` |

### Ejemplo de ruta completa:
```
descargas_sri/0930808662001/2026/03/recibidos/factura/xml/0103202601...013.xml
descargas_sri/0930808662001/2026/03/recibidos/factura/pdf/0103202601...013.pdf
```

## Configuracion (`config.js`)
```javascript
SRI_CONFIG = {
  DELAY_DESCARGA: 300,       // ms entre descargas
  DELAY_PAGINA: 1500,        // ms fallback cambio pagina
  DELAY_REINTENTO: 1000,     // ms entre reintentos
  TIMEOUT_DESCARGA: 5000,    // ms max por descarga
  TIMEOUT_PAGINA: 10000,     // ms max esperando cambio pagina
  MAX_REINTENTOS: 2,         // reintentos por descarga
  DIAS_HISTORIAL: 30,        // auto-limpieza
  SELECTORES: { ... },       // selectores CSS del SRI
  DOMINIO_SRI: 'sri.gob.ec', // filtro para downloads.onCreated
  ORGANIZACION: {
    HABILITADO: false,
    CARPETA_RAIZ: 'descargas_sri',
    ORDEN: 'ruc_fecha',            // 'ruc_fecha' | 'fecha_ruc'
    FORMATO_NOMBRE: 'claveAcceso'  // 'claveAcceso' | 'ruc_serie' | 'razon_serie'
  }
}
```

## Selectores importantes del SRI
```javascript
'#frmPrincipal\\:tablaCompRecibidos_data'  // Tabla de documentos
'.ui-paginator-current'                      // Info paginacion "(X of Y)"
'.ui-paginator-next:not(.ui-state-disabled)' // Boton siguiente
'.ui-paginator-first:not(.ui-state-disabled)'// Boton primera pagina
'[id$=":lnkXml"]'                            // Links de descarga XML
'[id$=":lnkPdf"]'                            // Links de descarga PDF
'.area-usuario-blue span'                    // RUC del usuario logueado
'frmPrincipal:dia'                           // Select de dia (value "0" = Todos)
'frmPrincipal:cmbTipoComprobante'            // Select tipo comprobante (1-6)
```

## Tipos de comprobante del SRI
| Value | Tipo |
|-------|------|
| 1 | Factura |
| 2 | Liquidacion de compra |
| 3 | Notas de Credito |
| 4 | Notas de Debito |
| 6 | Comprobante de Retencion |

## Funcion de descarga del SRI
```javascript
// Metodo mojarra (directo JSF)
mojarra.jsfcljs(
  document.getElementById('frmPrincipal'),
  { 'linkId': 'linkId' },
  ''
);
// Metodo click emulado
document.getElementById(linkId).click();
```

## Problemas conocidos y soluciones

### CSP bloquea scripts inline
- **Solucion**: Usar `chrome.scripting.executeScript` con `world: 'MAIN'`

### Popup se cierra al perder focus
- **Solucion**: Logica de descarga en background service worker

### Descargas "falsas" (marca OK pero no descargo)
- **Solucion**: Verificar con `chrome.downloads.onCreated` con ventana de tiempo

### Content script se reinyecta
- **Solucion**: Guard `if (window.SRI_DOWNLOADER_LOADED)` al inicio

### Tab cerrada durante descarga
- **Solucion**: Listener `chrome.tabs.onRemoved` aborta descarga

### Descargas fallidas por timeout transitorio
- **Solucion**: Reintentos automaticos (2 por default)

### Paginacion con servidor lento
- **Solucion**: Polling inteligente del paginador con fallback a delay fijo

### Chrome marca descargas como peligrosas
- **Solucion**: `chrome.downloads.acceptDanger` automatico para URLs del SRI

### Deduplicacion no distinguia XML de PDF
- **Solucion**: `exitoXml`/`exitoPdf` usan `null` = no se intento ese formato,
  `true`/`false` = resultado real. El indice de dedup exige `=== true` y que
  la sesion haya cubierto ese formato (`tipoDescarga` de la sesion), lo que
  tambien neutraliza registros viejos que guardaban `true` por defecto

### Campo de config vacio generaba NaN y rompia los reintentos
- **Solucion**: `leerConfigNum` en popup.js (Number.isNaN → default, clamp min/max)

### Service worker MV3 puede morir a mitad de descarga larga
- **Solucion**: guardado incremental del buffer por pagina (`guardarBufferAlStorage(false)`)

### Descargas ajenas del usuario contaban como exito
- **Solucion**: `downloads.onCreated` filtra por origen ademas de la ventana
  de tiempo (dominio SRI, `blob:` o URL vacia; rechaza otros sitios)

### tipoDoc incluia la serie en la ruta
- **Solucion**: `limpiarTipoDoc()` extrae solo el tipo sin la serie usando regex

### Setear dia="Todos" al navegar a comprobantes
- **Solucion**: Logica en background.js con `chrome.tabs.onUpdated` + reintentos, no en popup (que se cierra)

## Permisos requeridos (manifest.json)
- `activeTab` - Acceso a la tab activa
- `scripting` - Ejecutar scripts en paginas
- `downloads` - Monitorear descargas + `onDeterminingFilename` para organizar archivos
- `storage` - Almacenamiento local para historial y configuracion
- `notifications` - Notificacion al finalizar descarga
- Host: `https://srienlinea.sri.gob.ec/*`

## Testing
1. Ir a srienlinea.sri.gob.ec
2. Verificar accesos directos SRI cuando no hay tabla (menu con submenus)
3. Click en "Descargar comprobantes" > "Facturas" - verificar que navega y setea dia="Todos" + tipo="Factura"
4. Ejecutar consulta para tener documentos en la tabla
5. Abrir popup - verificar que aparecen los 4 tabs y controles de descarga
6. Verificar que recuerda ultimo tipo de descarga
7. Probar "Descargar TODO" - verificar modal con estimado
8. Verificar progreso granular y estimacion de tiempo
9. Verificar badge en icono de extension
10. Cerrar popup y verificar que continua (ver logs del service worker)
11. Verificar que archivos se organizan en carpetas correctas (ruc/anio/mes/recibidos/tipo/)
12. Verificar notificacion Chrome al finalizar
13. Descargar XML, luego descargar PDF - verificar que no los omite
14. Reabrir popup y verificar historial en tab "Historial"
15. Probar filtros de historial (exitosos/fallidos)
16. Probar "Exportar" (genera CSV)
17. Probar "Reintentar fallidos"
18. Probar "Limpiar historial"
19. Tab Configuracion: cambiar tiempos, metodo descarga, reintentos
20. Tab Organizacion: cambiar orden carpetas, formato nombre, verificar preview
21. Cambiar config de organizacion con historial existente - verificar alerta
22. Verificar dark mode (cambiar tema del OS)
