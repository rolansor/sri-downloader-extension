# Descargador de Comprobantes SRI - Extension Chrome/Edge

Extension para descargar documentos XML y PDF del portal SRI Ecuador (srienlinea.sri.gob.ec),
tanto comprobantes **recibidos** como **emitidos**.

## Caracteristicas

### Comprobantes emitidos
- **PDF + XML**: El RIDE se descarga de la pagina; el XML (que el SRI no ofrece como link)
  se obtiene del web service publico de autorizacion usando la clave de acceso
- **Descarga por dia o mes completo**: El formulario del SRI consulta un solo dia;
  en modo mes la extension itera dia por dia automaticamente (hasta un dia antes
  del actual), saltando los dias sin comprobantes
- **Consulta automatica**: Al navegar a emitidos desde el menu, consulta sola
  (no hay captcha); no hace falta ejecutar la consulta manualmente
- **Tema verde agua**: Todo el popup cambia de color al trabajar sobre emitidos
  para distinguir el entorno (azul = recibidos)

### Descarga
- **Descarga masiva**: Descarga todos los documentos de todas las paginas con un solo clic
- **Tipos de archivo**: XML, PDF o ambos (recuerda tu ultima seleccion)
- **Seleccion individual**: Checkboxes para descargar solo documentos especificos de la pagina actual
- **Navegacion automatica**: Recorre todas las paginas de resultados
- **Descarga persistente**: Continua descargando aunque cierres el popup
- **Guardado incremental**: El historial se guarda pagina a pagina; no se pierde si Chrome recicla el service worker
- **Doble metodo**: Mojarra (JSF directo, mas rapido) o click emulado (mas compatible)
- **Reintentos automaticos**: Reintenta descargas fallidas (configurable, default 2)
- **Verificacion real**: Confirma que cada archivo se descargo via chrome.downloads API
- **Espera inteligente**: Detecta cuando la pagina termina de cargar (polling, no delays fijos)
- **Deduplicacion**: Omite documentos ya descargados (distingue XML y PDF por separado)

### Accesos directos SRI
- **Menu de navegacion rapida**: Accesos directos a las secciones principales del portal SRI
- **Descargar recibidos / Descargar emitidos**: Dos botones principales, cada uno con
  submenu por tipo de comprobante (Facturas, Liquidaciones, Notas de Credito/Debito,
  Guias de Remision en emitidos, Retenciones)
- **Pre-configuracion automatica**: Al navegar, setea dia="Todos" (recibidos) o consulta
  el dia 1 del mes (emitidos) y el tipo de comprobante automaticamente
- **13 categorias**: Claves, RUC, Facturacion Electronica, Declaraciones, Anexos, Pagos, Deudas, Devoluciones, Certificados, Vehiculos, Tramites y mas

### Organizacion de archivos
- **Carpetas automaticas**: Organiza descargas en estructura de carpetas configurable
- **Orden configurable**: RUC/Anio/Mes o Anio/Mes/RUC
- **3 formatos de nombre**: Clave de acceso, RUC+Serie, o Razon social+Serie
- **Estructura fija**: carpetaRaiz / [orden] / recibidos|emitidos / tipoDocumento / xml|pdf / archivo
- **Vista previa en tiempo real**: Muestra la ruta resultante antes de guardar

### Historial
- **Registro persistente**: Organizado por RUC y sesion, con origen (emitido/recibido)
- **Filtros**: Todo, exitosos o fallidos
- **Exportar a CSV**: Exporta el registro completo
- **Reintentar fallidos**: Re-descarga solo los documentos que fallaron
- **Limpieza automatica**: Elimina registros antiguos (configurable, default 30 dias)

### Configuracion
- **Tiempos ajustables**: Delay entre descargas, timeouts, delay de paginacion, delay de reintentos
- **Metodo de descarga**: Mojarra (JSF) o click emulado
- **Reintentos**: Numero maximo configurable
- **Todo desde el popup**: Pestana de configuracion integrada, sin editar archivos

### Interfaz
- **4 pestanas**: Descargar, Historial, Configuracion, Organizacion
- **Progreso detallado**: Barra por documento con estimacion de tiempo restante
- **Badge en icono**: Muestra progreso sin abrir el popup
- **Notificacion Chrome**: Avisa cuando termina la descarga masiva
- **Sonido al completar**: Beep sutil al finalizar
- **Confirmacion**: Modal con estimado de documentos antes de iniciar
- **Dark mode**: Se adapta automaticamente al tema del sistema operativo
- **Deteccion de Edge**: Advertencia sobre SmartScreen con instrucciones para desactivarlo

## Instalacion

1. Descarga o clona este repositorio
2. Abre Chrome/Edge y ve a `chrome://extensions/` o `edge://extensions/`
3. Activa el **Modo de desarrollador** (esquina superior derecha)
4. Haz clic en **Cargar descomprimida**
5. Selecciona la carpeta `sri-downloader-extension`

> **Nota para Edge**: Microsoft SmartScreen puede bloquear descargas de archivos XML/PDF.
> Para desactivarlo: `edge://settings/privacy` > desactiva "Microsoft Defender SmartScreen".

## Uso

1. Inicia sesion en el portal SRI: https://srienlinea.sri.gob.ec
2. Haz clic en el icono de la extension
3. Usa **Descargar recibidos** o **Descargar emitidos** y elige el tipo de comprobante;
   la extension navega y deja la consulta lista
4. Selecciona el tipo de descarga (XML, PDF o Ambos)
5. En emitidos elige el rango: **Mes completo** (por defecto, itera dia por dia el mes
   de la fecha elegida en el selector) o **Dia consultado**
6. Opciones:
   - **Descargar TODO**: Descarga todo lo consultado (o todo el mes en emitidos)
   - **Descargar ignorando historial**: Re-descarga todo sin verificar duplicados
   - **Descargar seleccionados (esta pagina)**: Solo los documentos marcados en la lista desplegable
7. Puedes cerrar el popup; la descarga continua en segundo plano (el boton
   "Detener Descarga" cancela en cualquier momento)
8. Configura la **organizacion de archivos** para ordenar descargas en carpetas
9. Revisa el historial en la pestana "Historial"
10. Exporta el historial a CSV con el boton "Exportar" (incluye columna Origen)

## Arquitectura

```
┌──────────┐     mensajes     ┌──────────────┐    executeScript    ┌──────────┐
│  Popup   │ <──────────────> │  Background  │ ──────────────────> │ Pagina   │
│ popup.js │                  │ background.js│ <── downloads.on ── │  SRI     │
└──────────┘                  │ (Service W.) │                     └──────────┘
                              └──────────────┘
                                     │
                              chrome.storage
                              (historial + config)
```

- **config.js**: Constantes centralizadas (delays, timeouts, selectores, organizacion)
- **Background (Service Worker)**: Orquesta descargas, reintentos, organizacion de archivos, navegacion SRI
- **Popup**: Interfaz con 4 tabs, accesos directos SRI, progreso, configuracion
- **Content Script**: Extrae datos de la tabla del SRI (solo lectura, ~80 lineas)

## Permisos

| Permiso | Uso |
|---------|-----|
| `activeTab` | Acceso a la pestana activa del SRI |
| `scripting` | Ejecutar scripts para disparar descargas |
| `downloads` | Verificar descargas + organizar en carpetas |
| `storage` | Guardar historial, configuracion y preferencias |
| `notifications` | Notificar al completar descarga masiva |

Hosts permitidos: `srienlinea.sri.gob.ec` (portal) y `cel.sri.gob.ec` / `celcer.sri.gob.ec`
(web service publico de autorizacion, usado para obtener el XML de los emitidos).

## Configuracion

Los valores se pueden ajustar desde la pestana **Configuracion** del popup, o directamente en `config.js`:

| Parametro | Default | Descripcion |
|-----------|---------|-------------|
| `DELAY_DESCARGA` | 300ms | Espera entre descargas |
| `DELAY_PAGINA` | 1500ms | Fallback cambio de pagina |
| `DELAY_REINTENTO` | 1000ms | Espera entre reintentos |
| `TIMEOUT_DESCARGA` | 5000ms | Max espera por descarga |
| `TIMEOUT_PAGINA` | 10000ms | Max espera cambio pagina |
| `MAX_REINTENTOS` | 2 | Reintentos por descarga fallida |
| `DIAS_HISTORIAL` | 30 | Dias antes de auto-limpiar |

### Organizacion de archivos

| Parametro | Default | Opciones |
|-----------|---------|----------|
| Habilitado | No | Si / No |
| Carpeta raiz | `descargas_sri` | Texto libre |
| Orden | RUC/Fecha | `ruc_fecha` / `fecha_ruc` |
| Formato nombre | Clave de acceso | `claveAcceso` / `ruc_serie` / `razon_serie` |

## Solucion de problemas

### "No se encontro la tabla de comprobantes"
- Asegurate de estar en la pagina de Comprobantes Recibidos
- Ejecuta una consulta primero para que aparezca la tabla
- Usa los accesos directos SRI de la extension para navegar rapidamente

### "Error al comunicarse con la pagina"
- Recarga la pagina del SRI (F5)
- Vuelve a hacer clic en la extension

### Las descargas no funcionan
- Verifica que el navegador tiene permisos para descargar archivos
- **En Edge**: Desactiva SmartScreen en `edge://settings/privacy`
- Revisa la carpeta de descargas del navegador
- Prueba cambiar el metodo de descarga (Mojarra vs Click emulado) en Configuracion
- Inspecciona el Service Worker en `chrome://extensions/` para ver errores

### La extension no aparece
- Verifica que el Modo de desarrollador esta activado
- Intenta recargar la extension desde `chrome://extensions/`

### Muchas descargas fallidas
- El servidor del SRI puede estar lento; los reintentos automaticos ayudan
- Puedes usar "Reintentar fallidos" en el historial para re-intentar solo los que fallaron
- Aumenta los tiempos de delay y timeout en la pestana Configuracion

### Los archivos no se organizan en carpetas
- Verifica que la organizacion esta habilitada en la pestana "Organizacion"
- Revisa la vista previa de ruta para confirmar la estructura

## Nota

Esta extension **NO** esta afiliada al SRI. Es una herramienta independiente que interactua con el portal publico del Servicio de Rentas Internas del Ecuador.