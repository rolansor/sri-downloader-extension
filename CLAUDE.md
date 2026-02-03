# CLAUDE.md - Guia para Claude Code

## Proyecto
Extension de Chrome (Manifest V3) para descargar documentos XML/PDF del SRI Ecuador.
Version: 1.0.0 | Dominio: `srienlinea.sri.gob.ec`

## Estructura de archivos
```
sri-downloader-extension/
├── manifest.json      # Manifest V3 config
├── background.js      # Service Worker (~590 lineas)
├── content.js         # Content Script (~407 lineas)
├── popup.html         # UI del popup
├── popup.js           # Logica del popup (~470 lineas)
├── icons/             # Iconos PNG y SVG (16, 48, 128)
├── README.md
└── CLAUDE.md
```

## Comandos utiles
- Actualizar extension: `chrome://extensions/` > click en actualizar
- Ver logs background: `chrome://extensions/` > "Service worker" > click para inspeccionar
- Ver logs pagina: F12 en la pagina del SRI

## Arquitectura clave

### Background (Service Worker) - `background.js`
- **Persistente**: Continua aunque se cierre el popup
- Ejecuta descargas con `chrome.scripting.executeScript({ world: 'MAIN' })`
- Verifica descargas reales con `chrome.downloads.onCreated`
- Guarda historial en `chrome.storage.local` (organizado por RUC)
- Enfoque **secuencial**: espera confirmacion de descarga antes de continuar
- Buffer en memoria durante sesion, escribe a storage al finalizar
- Limpieza automatica de historial >30 dias

### Popup - `popup.html` / `popup.js`
- Dos tabs: **Descargar** | **Historial**
- Se comunica con background via `chrome.runtime.sendMessage`
- Al abrir, consulta estado actual con `obtenerEstado`
- Muestra barra de progreso en tiempo real durante descargas
- Historial filtrable: todos, exitosos, fallidos
- Seleccion individual con checkboxes o "Seleccionar todo"
- Seleccion de tipo: XML, PDF o Ambos

### Content Script - `content.js`
- Extrae datos de la tabla del SRI (RUC, tipo, fecha, links)
- Maneja paginacion: detecta pagina actual y total
- Tiene guard `window.SRI_DOWNLOADER_LOADED` para evitar reinyeccion
- Config: `DELAY_DESCARGA=300ms`, `DELAY_PAGINA=1500ms`, `MAX_DOCUMENTOS=500`

## Mensajes entre componentes

### Popup → Background
| Mensaje | Descripcion | Payload |
|---------|-------------|---------|
| `iniciarDescargaTotal` | Inicia descarga de todas las paginas | `{tabId, tipoDescarga}` |
| `detenerDescarga` | Detiene descarga en progreso | - |
| `obtenerEstado` | Obtiene estado actual | - |
| `obtenerHistorial` | Obtiene historial completo | `{ruc?}` |
| `limpiarHistorial` | Limpia storage | - |
| `obtenerFallidos` | Lista documentos fallidos | - |

### Popup → Content Script
| Mensaje | Descripcion |
|---------|-------------|
| `obtenerDocumentos` | Extrae documentos de la tabla actual |
| `descargarSeleccionados` | Descarga indices seleccionados |

### Background → Popup
| Mensaje | Descripcion |
|---------|-------------|
| `estadoDescarga` | Actualizacion de progreso en tiempo real |

### Content Script → Background
| Mensaje | Descripcion |
|---------|-------------|
| `ejecutarDescarga` | Solicita descarga de un `linkId` |

## Flujo de descarga
1. Popup envia `iniciarDescargaTotal` a background con `tabId` y `tipoDescarga`
2. Background ejecuta `chrome.scripting.executeScript` en la tab para obtener datos de pagina
3. Por cada documento, ejecuta `mojarra.jsfcljs()` via `executeScript({ world: 'MAIN' })`
4. `chrome.downloads.onCreated` confirma que la descarga inicio (timeout 5s si no)
5. Espera 300ms entre descargas, 1500ms entre cambios de pagina
6. Al finalizar, guarda resultados en `chrome.storage.local`
7. Envia `estadoDescarga` al popup con progreso actualizado

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
- **Solucion**: Verificar con `chrome.downloads.onCreated` antes de continuar

### Content script se reinyecta
- **Solucion**: Guard `if (window.SRI_DOWNLOADER_LOADED)` al inicio

## Limitaciones actuales
- Selectores hardcodeados: cambios en el DOM del SRI rompen la extraccion
- `MAX_DOCUMENTOS` (500) esta definido pero no se aplica en el codigo
- No hay reintento automatico de descargas fallidas
- No se puede re-descargar solo los fallidos desde el historial
- `chrome.downloads.onCreated` confirma inicio, no finalizacion de descarga

## Permisos requeridos (manifest.json)
- `activeTab` - Acceso a la tab activa
- `scripting` - Ejecutar scripts en paginas
- `downloads` - Monitorear descargas
- `storage` - Almacenamiento local para historial
- Host: `https://srienlinea.sri.gob.ec/*`

## Testing
1. Ir a srienlinea.sri.gob.ec
2. Login y navegar a comprobantes recibidos
3. Ejecutar consulta para tener documentos en la tabla
4. Abrir popup de la extension
5. Probar "Descargar TODO" - verificar progreso en tiempo real
6. Cerrar popup y verificar que continua (ver logs del service worker)
7. Reabrir popup y verificar que muestra progreso actual
8. Verificar historial en tab "Historial"
9. Probar filtros de historial (exitosos/fallidos)
10. Probar "Limpiar historial"
