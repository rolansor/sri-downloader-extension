# SRI Document Downloader - Extension Chrome

Extension para descargar documentos XML y PDF del portal SRI Ecuador (srienlinea.sri.gob.ec).

## Caracteristicas

- **Descarga masiva**: Descarga todos los documentos de todas las paginas con un solo click
- **Tipos de archivo**: XML, PDF o ambos
- **Seleccion individual**: Checkboxes para elegir documentos especificos
- **Navegacion automatica**: Recorre todas las paginas de resultados automaticamente
- **Descarga persistente**: Continua descargando aunque cierres el popup
- **Verificacion real**: Confirma que cada archivo se descargo antes de continuar
- **Historial de descargas**: Registro persistente organizado por RUC
  - Filtrable por estado (exitosos/fallidos)
  - Limpieza automatica de registros >30 dias
- **Deduplicacion**: Omite documentos ya descargados previamente
- **Progreso en tiempo real**: Barra de progreso con contadores de exito/fallo

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
   - **Descargar Seleccionados**: Solo los documentos marcados en la pagina actual
7. Puedes cerrar el popup; la descarga continua en segundo plano
8. Revisa el historial en la pestana "Historial"

## Arquitectura

```
┌──────────┐     mensajes     ┌──────────────┐    executeScript    ┌──────────┐
│  Popup   │ ◄──────────────► │  Background  │ ──────────────────► │ Pagina   │
│ popup.js │                  │ background.js│ ◄── downloads.on ── │  SRI     │
└──────────┘                  │ (Service W.) │                     └──────────┘
                              └──────────────┘
                                     │
                              chrome.storage
                              (historial)
```

- **Background (Service Worker)**: Orquesta descargas, verifica archivos, guarda historial
- **Popup**: Interfaz de usuario con tabs Descargar/Historial
- **Content Script**: Extrae datos de la tabla del SRI

## Permisos

| Permiso | Uso |
|---------|-----|
| `activeTab` | Acceso a la pestana activa del SRI |
| `scripting` | Ejecutar scripts para disparar descargas |
| `downloads` | Verificar que las descargas se iniciaron |
| `storage` | Guardar historial de descargas |

Solo funciona en `srienlinea.sri.gob.ec`.

## Notas tecnicas

- Delay de 300ms entre descargas para no sobrecargar el servidor
- Delay de 1500ms al cambiar de pagina para esperar carga del DOM
- Timeout de 5s por descarga; si no se confirma, se marca como fallida
- Los archivos van a la carpeta de descargas predeterminada de Chrome
- Usa `world: 'MAIN'` para ejecutar la funcion `mojarra.jsfcljs()` del SRI

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
