# CLAUDE.md - Guia para Claude Code

## Proyecto
Extension de Chrome (Manifest V3) para descargar documentos XML/PDF del SRI Ecuador.
Version: 1.1.0 | Dominio: `srienlinea.sri.gob.ec`

## Estructura de archivos
```
sri-downloader-extension/
├── manifest.json      # Manifest V3 config
├── config.js          # Constantes compartidas (delays, selectores, timeouts)
├── background.js      # Service Worker - orquestacion de descargas
├── content.js         # Content Script - extractor de datos DOM
├── popup.html         # UI del popup
├── popup.js           # Logica del popup
├── popup.css          # Estilos (incluye dark mode)
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
- Constantes centralizadas: delays, timeouts, selectores, reintentos
- Compartido entre background.js (via `importScripts`) y content.js (via content_scripts en manifest)
- Objeto global `SRI_CONFIG`

### Background (Service Worker) - `background.js`
- **Persistente**: Continua aunque se cierre el popup
- Ejecuta descargas con `chrome.scripting.executeScript({ world: 'MAIN' })`
- Verifica descargas reales con `chrome.downloads.onCreated` (filtrado por dominio SRI)
- Guarda historial en `chrome.storage.local` (organizado por RUC)
- Enfoque **secuencial**: espera confirmacion de descarga antes de continuar
- Buffer en memoria durante sesion, escribe a storage al finalizar
- Limpieza automatica de historial >30 dias
- Indice Set() para deduplicacion O(1)
- Reintentos automaticos (configurable, default 2)
- Espera inteligente de paginacion (polling en vez de delay fijo)
- Detecta tab cerrada y aborta descarga
- Badge en icono con progreso
- Notificacion Chrome al finalizar
- Calcula tiempo estimado restante

### Popup - `popup.html` / `popup.js` / `popup.css`
- Dos tabs: **Descargar** | **Historial**
- Se comunica con background via `chrome.runtime.sendMessage`
- Al abrir, consulta estado actual con `obtenerEstado`
- Muestra barra de progreso granular (por documento, no por pagina)
- Estimacion de tiempo restante ("~2:30 restantes")
- Confirmacion antes de descarga masiva con estimado de documentos
- Historial filtrable: todos, exitosos, fallidos
- Exportar historial a CSV
- Boton reintentar fallidos
- Recordar ultimo tipo de descarga (XML/PDF/Ambos)
- Sonido al completar (AudioContext beep)
- Dark mode automatico (prefers-color-scheme)
- Construccion DOM segura (textContent, no innerHTML)

### Content Script - `content.js`
- Solo extractor de datos del DOM (~80 lineas)
- Extrae filas de tabla y paginacion
- Tiene guard `window.SRI_DOWNLOADER_LOADED` para evitar reinyeccion
- No ejecuta descargas (eso lo hace background)

## Mensajes entre componentes

### Popup -> Background
| Mensaje | Descripcion | Payload |
|---------|-------------|---------|
| `iniciarDescargaTotal` | Inicia descarga de todas las paginas | `{tabId, tipoDescarga}` |
| `detenerDescarga` | Detiene descarga en progreso | - |
| `obtenerEstado` | Obtiene estado actual | - |
| `obtenerHistorial` | Obtiene historial completo | `{ruc?}` |
| `obtenerFallidos` | Lista documentos fallidos | - |
| `limpiarHistorial` | Limpia storage | - |

### Popup -> Content Script
| Mensaje | Descripcion |
|---------|-------------|
| `obtenerDocumentos` | Extrae documentos de la tabla actual |

### Background -> Popup
| Mensaje | Descripcion |
|---------|-------------|
| `estadoDescarga` | Actualizacion de progreso en tiempo real |

## Flujo de descarga
1. Popup muestra confirm() con estimado de documentos
2. Envia `iniciarDescargaTotal` a background con `tabId` y `tipoDescarga`
3. Background construye indice Set de descargados previos (O(1) lookup)
4. Ejecuta `chrome.scripting.executeScript` para obtener datos de pagina
5. Por cada documento: verifica deduplicacion, ejecuta `mojarra.jsfcljs()` con reintentos
6. `chrome.downloads.onCreated` (filtrado por sri.gob.ec) confirma descarga
7. Espera inteligente (polling paginador) entre cambios de pagina
8. Actualiza badge, calcula tiempo estimado, notifica popup
9. Al finalizar: guarda en storage, envia notificacion Chrome, beep en popup

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
  DOMINIO_SRI: 'sri.gob.ec'  // filtro para downloads.onCreated
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
```

## Funcion de descarga del SRI
```javascript
mojarra.jsfcljs(
  document.getElementById('frmPrincipal'),
  { 'linkId': 'linkId' },
  ''
);
```

## Problemas conocidos y soluciones

### CSP bloquea scripts inline
- **Solucion**: Usar `chrome.scripting.executeScript` con `world: 'MAIN'`

### Popup se cierra al perder focus
- **Solucion**: Logica de descarga en background service worker

### Descargas "falsas" (marca OK pero no descargo)
- **Solucion**: Verificar con `chrome.downloads.onCreated` filtrado por dominio SRI

### Content script se reinyecta
- **Solucion**: Guard `if (window.SRI_DOWNLOADER_LOADED)` al inicio

### Tab cerrada durante descarga
- **Solucion**: Listener `chrome.tabs.onRemoved` aborta descarga

### Descargas fallidas por timeout transitorio
- **Solucion**: Reintentos automaticos (2 por default)

### Paginacion con servidor lento
- **Solucion**: Polling inteligente del paginador con fallback a delay fijo

## Permisos requeridos (manifest.json)
- `activeTab` - Acceso a la tab activa
- `scripting` - Ejecutar scripts en paginas
- `downloads` - Monitorear descargas
- `storage` - Almacenamiento local para historial
- `notifications` - Notificacion al finalizar descarga
- Host: `https://srienlinea.sri.gob.ec/*`

## Testing
1. Ir a srienlinea.sri.gob.ec
2. Login y navegar a comprobantes recibidos
3. Ejecutar consulta para tener documentos en la tabla
4. Abrir popup de la extension
5. Verificar que recuerda ultimo tipo de descarga
6. Probar "Descargar TODO" - verificar confirmacion con estimado
7. Verificar progreso granular y estimacion de tiempo
8. Verificar badge en icono de extension
9. Cerrar popup y verificar que continua (ver logs del service worker)
10. Verificar notificacion Chrome al finalizar
11. Reabrir popup y verificar que muestra progreso/resultado
12. Verificar historial en tab "Historial"
13. Probar filtros de historial (exitosos/fallidos)
14. Probar "Exportar" (genera CSV)
15. Probar "Reintentar fallidos"
16. Probar "Limpiar historial"
17. Verificar dark mode (cambiar tema del OS)
