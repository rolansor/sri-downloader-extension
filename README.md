# SRI Document Downloader - Extension Chrome

Extension para descargar documentos XML y PDF del portal SRI Ecuador (srienlinea.sri.gob.ec).

## Caracteristicas

- **Descarga masiva**: Descarga todos los documentos de todas las paginas con un solo click
- **Tipos de archivo**: XML, PDF o ambos (recuerda tu ultima seleccion)
- **Seleccion individual**: Checkboxes para elegir documentos especificos
- **Navegacion automatica**: Recorre todas las paginas de resultados
- **Descarga persistente**: Continua descargando aunque cierres el popup
- **Reintentos automaticos**: Reintenta descargas fallidas hasta 2 veces
- **Verificacion real**: Confirma que cada archivo se descargo (filtrado por dominio SRI)
- **Espera inteligente**: Detecta cuando la pagina termina de cargar (no usa delays fijos)
- **Deduplicacion**: Omite documentos ya descargados previamente (busqueda O(1))
- **Progreso detallado**: Barra por documento con estimacion de tiempo restante
- **Badge en icono**: Muestra progreso sin abrir el popup
- **Notificacion Chrome**: Avisa cuando termina la descarga masiva
- **Sonido al completar**: Beep sutil cuando finaliza (si el popup esta abierto)
- **Historial de descargas**: Registro persistente organizado por RUC
  - Filtrable por estado (exitosos/fallidos)
  - Exportar a CSV
  - Reintentar fallidos con un click
  - Limpieza automatica de registros >30 dias
- **Deteccion de tab cerrada**: Aborta descarga si cierras la pagina del SRI
- **Dark mode**: Se adapta automaticamente al tema del sistema operativo
- **Confirmacion**: Muestra estimado de documentos antes de iniciar descarga masiva

## Instalacion

1. Descarga o clona este repositorio
2. Abre Chrome y ve a `chrome://extensions/`
3. Activa el **Modo de desarrollador** (esquina superior derecha)
4. Haz click en **Cargar descomprimida**
5. Selecciona la carpeta `sri-downloader-extension`

## Uso

1. Inicia sesion en el portal SRI: https://srienlinea.sri.gob.ec
2. Navega a **Comprobantes Electronicos Recibidos**
3. Realiza una consulta para que aparezca la tabla de documentos
4. Haz click en el icono de la extension en la barra de herramientas
5. Selecciona el tipo de descarga (XML, PDF o Ambos)
6. Opciones:
   - **Descargar TODO**: Descarga todos los documentos de todas las paginas
   - **Descargar Solo Esta Pagina**: Solo los documentos marcados en la pagina actual
7. Puedes cerrar el popup; la descarga continua en segundo plano
8. Revisa el historial en la pestana "Historial"
9. Exporta el historial a CSV con el boton "Exportar"

## Arquitectura

```
┌──────────┐     mensajes     ┌──────────────┐    executeScript    ┌──────────┐
│  Popup   │ <──────────────> │  Background  │ ──────────────────> │ Pagina   │
│ popup.js │                  │ background.js│ <── downloads.on ── │  SRI     │
└──────────┘                  │ (Service W.) │                     └──────────┘
                              └──────────────┘
                                     │
                              chrome.storage
                              (historial)
```

- **config.js**: Constantes centralizadas (delays, timeouts, selectores)
- **Background (Service Worker)**: Orquesta descargas, reintentos, badge, notificaciones
- **Popup**: Interfaz con tabs Descargar/Historial, progreso, exportar CSV
- **Content Script**: Extrae datos de la tabla del SRI (solo lectura)

## Permisos

| Permiso | Uso |
|---------|-----|
| `activeTab` | Acceso a la pestana activa del SRI |
| `scripting` | Ejecutar scripts para disparar descargas |
| `downloads` | Verificar que las descargas se iniciaron |
| `storage` | Guardar historial y preferencias |
| `notifications` | Notificar al completar descarga masiva |

Solo funciona en `srienlinea.sri.gob.ec`.

## Configuracion

Los valores se pueden ajustar en `config.js`:

| Parametro | Default | Descripcion |
|-----------|---------|-------------|
| `DELAY_DESCARGA` | 300ms | Espera entre descargas |
| `DELAY_REINTENTO` | 1000ms | Espera entre reintentos |
| `TIMEOUT_DESCARGA` | 5000ms | Max espera por descarga |
| `TIMEOUT_PAGINA` | 10000ms | Max espera cambio pagina |
| `MAX_REINTENTOS` | 2 | Reintentos por descarga fallida |
| `DIAS_HISTORIAL` | 30 | Dias antes de auto-limpiar |

## Solucion de problemas

### "No se encontro la tabla de comprobantes"
- Asegurate de estar en la pagina de Comprobantes Recibidos
- Ejecuta una consulta primero para que aparezca la tabla

### "Error al comunicarse con la pagina"
- Recarga la pagina del SRI (F5)
- Vuelve a hacer click en la extension

### Las descargas no funcionan
- Verifica que Chrome tiene permisos para descargar archivos
- Revisa la carpeta de descargas de Chrome
- Inspecciona el Service Worker en `chrome://extensions/` para ver errores

### La extension no aparece
- Verifica que el Modo de desarrollador esta activado
- Intenta recargar la extension desde `chrome://extensions/`

### Muchas descargas fallidas
- El servidor del SRI puede estar lento; los reintentos automaticos ayudan
- Puedes usar "Reintentar fallidos" en el historial para re-intentar solo los que fallaron
