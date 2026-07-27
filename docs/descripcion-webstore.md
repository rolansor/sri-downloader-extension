# Descripcion para la Chrome Web Store

Texto de la ficha de la extension en la Chrome Web Store. Mantener sincronizado
con las funcionalidades reales antes de cada publicacion.

---

Descargador de Comprobantes SRI automatiza la descarga de comprobantes electrónicos (XML y PDF) desde el portal del SRI Ecuador (srienlinea.sri.gob.ec). Funciona con comprobantes **recibidos** y **emitidos**.

Características principales:

- Descarga masiva: Descarga todos los comprobantes de todas las páginas con un solo clic.
- Comprobantes emitidos: Descarga el RIDE (PDF) y el XML autorizado de tus propios comprobantes. El XML se obtiene directamente del web service oficial de autorización del SRI usando la clave de acceso.
- Descarga por día o mes completo: En emitidos, elige entre el día consultado o el mes completo — la extensión consulta día por día automáticamente, saltando los días sin comprobantes.
- Consulta automática: Al navegar a emitidos desde el menú, la extensión ejecuta la consulta por ti; no necesitas llenar el formulario.
- Formatos: Elige entre XML, PDF o ambos (recuerda tu última selección).
- Accesos directos SRI: Botones "Descargar recibidos" y "Descargar emitidos" con submenú por tipo de comprobante (Facturas, Retenciones, Notas de Crédito/Débito, Liquidaciones, Guías de Remisión), más navegación rápida a Declaraciones, RUC, Claves y otras secciones del portal. Pre-configura automáticamente el formulario.
- Entornos diferenciados por color: La interfaz cambia a verde agua cuando trabajas sobre emitidos y azul en recibidos, para que siempre sepas dónde estás.
- Organización de archivos: Organiza las descargas en carpetas automáticamente (RUC/Año/Mes o Año/Mes/RUC), separando recibidos de emitidos, con 3 formatos de nombre de archivo y vista previa en tiempo real.
- Progreso en tiempo real: Barra de progreso por documento (y por día en modo mes) con estimación de tiempo restante y badge en el ícono. Cancela en cualquier momento con "Detener Descarga".
- Configuración desde el popup: Ajusta tiempos, método de descarga (Mojarra JSF o click emulado) y reintentos sin editar código.
- Historial de descargas: Consulta qué documentos ya descargaste, con su origen (emitido o recibido), y filtra por exitosos o fallidos.
- Reintentos automáticos: Si una descarga falla por demora del servidor, se reintenta automáticamente (configurable).
- Sin duplicados: No vuelve a descargar documentos que ya tienes (distingue XML y PDF por separado).
- Exportar historial: Exporta el registro de descargas a CSV, con columna de origen.
- Continúa en segundo plano: Si cierras la ventana emergente, la descarga continúa. Recibirás una notificación y sonido al finalizar.
- 4 pestañas integradas: Descargar, Historial, Configuración y Organización.
- Modo oscuro: Se adapta automáticamente al tema de tu sistema operativo.
- Seguro: Se comunica únicamente con los servidores oficiales del SRI (portal y web service de autorización). No recopila ni envía datos a terceros.

Ideal para contadores, asistentes contables y cualquier profesional que necesite descargar grandes volúmenes de comprobantes del SRI.

Cómo usar:
1. Inicia sesión en srienlinea.sri.gob.ec
2. Haz clic en el ícono de la extensión
3. Presiona "Descargar recibidos" o "Descargar emitidos" y elige el tipo de comprobante — la extensión navega y deja la consulta lista
4. Selecciona el tipo de descarga (XML, PDF o Ambos)
5. En emitidos, elige el rango: Mes completo (por defecto) o Día consultado
6. Presiona "Descargar TODO"
7. Opcionalmente, configura la organización de archivos para ordenar tus descargas en carpetas

Nota: Esta extensión NO está afiliada al SRI. Es una herramienta independiente que interactúa con el portal público.
