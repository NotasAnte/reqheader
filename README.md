# ReqHeader

Extensión de Chrome (Manifest V3) para modificar cabeceras HTTP, al estilo de ModHeader.

## Funciones

- **Perfiles**: crea varios, cada uno con su nombre y color; se aplica el perfil seleccionado.
- **Cabeceras de petición y de respuesta**, con tres operaciones: establecer, añadir o eliminar.
- **Filtros de URL** por patrón (`||example.com/api/*`), regex o lista de dominios. Si no hay filtros, el perfil se aplica a todas las URLs.
- **Pausa global** con un clic.
- **Badge** con el número de cabeceras activas, en el color del perfil.
- **Importar y exportar** en JSON. También importa los archivos exportados desde ModHeader.
- Los errores de validación (nombre de cabecera inválido, regex que Chrome no admite…) aparecen en el popup.

## Instalación

1. Abre `chrome://extensions`.
2. Activa el **Modo de desarrollador**.
3. Pulsa **Cargar descomprimida** y selecciona esta carpeta.

## Estructura

| Archivo | Qué hace |
|---|---|
| `manifest.json` | Permisos `declarativeNetRequest` y `storage` |
| `shared.js` | Estado, saneado de datos y construcción de reglas |
| `background.js` | Sincroniza las reglas dinámicas cuando cambia el estado y actualiza el badge |
| `popup.html/css/js` | Interfaz |

## Limitaciones de Chrome

- Chrome solo permite la operación «añadir» en algunas cabeceras de petición (`accept`, `cookie`, `user-agent`…). El popup te avisa si eliges otra.
- Hay cabeceras que `declarativeNetRequest` no deja modificar, y las peticiones de otras extensiones no se ven afectadas.
