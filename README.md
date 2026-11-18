# Menú Digital — Restaurante

Aplicación web progresiva (PWA) de menú digital pensada **exclusivamente para móvil**, que es el caso real de un cliente que llega a un restaurante y escanea un código QR.

La app muestra una portada, una serie de secciones de menú (bebidas, almuerzo/cena, etc.) con navegación tipo presentación, y una pantalla de contacto al final. Las imágenes del menú se cargan **automáticamente** a partir de archivos numerados, sin tocar el código.

---

## Índice

- [Características](#características)
- [Estructura del proyecto](#estructura-del-proyecto)
- [Cómo agregar o editar secciones](#cómo-agregar-o-editar-secciones)
- [Cómo se cargan las imágenes (numeración)](#cómo-se-cargan-las-imágenes-numeración)
- [Rendimiento y caché](#rendimiento-y-caché)
- [Instalación / PWA](#instalación--pwa)
- [Mantenimiento: qué subir y cuándo](#mantenimiento-qué-subir-y-cuándo)
- [Desarrollo local](#desarrollo-local)

---

## Características

- **Una sola versión (móvil).** `index.html` redirige siempre a `mobile.html`.
- **Navegación fullPage.js**: desplazamiento vertical entre secciones y horizontal entre las imágenes de una misma sección.
- **Secciones autogeneradas**: detecta las imágenes existentes y crea las secciones y diapositivas por sí sola.
- **Nombres de sección hardcodeados** en una lista fácil de editar (no dependen de lógica compleja).
- **PWA instalable**: manifest, iconos y service worker. Funciona sin conexión una vez cacheada.
- **Rendimiento**: detección de archivos con concurrencia limitada, caché en `localStorage`, precarga de la primera imagen de cada sección, `loading="lazy"` y `fetchpriority` en las imágenes, y precache en el service worker.

---

## Estructura del proyecto

```
menu/
├── index.html            Redirige siempre a mobile.html
├── mobile.html           Aplicación principal (única versión)
├── manifest.json         Configuración PWA (fullscreen, portrait)
├── sw.js                 Service worker (caché y precache)
├── README.md
├── css/
│   ├── jquery.fullPage.css
│   ├── estilos.css
│   └── estilos_slide.css
├── js/
│   ├── jquery.fullPage.js
│   └── ...               (librerías de apoyo)
├── fuentes/              Fuentes tipográficas (Arlrdlt, Arlrdbd, etc.)
└── imgs/
    ├── logocrepes1.*     Logo de la portada
    ├── bebidas.jpg       Imagen de fondo de las portadas de sección
    ├── icon-192.png      Icono PWA
    ├── icon-512.png      Icono PWA
    └── mobile/
        ├── header.svg    Cabecera del menú
        ├── footer.svg    Pie del menú
        ├── 1.1.svg       Sección 1, imagen 1
        ├── 1.2.svg       Sección 1, imagen 2
        ├── 2.1.svg       Sección 2, imagen 1
        └── ...
```

Las imágenes del menú viven **todas** en `imgs/mobile/`.

---

## Cómo agregar o editar secciones

### 1. Agregar las imágenes

Crea archivos dentro de `imgs/mobile/` con el patrón `N.M.svg`:

- `N` = número de sección (1, 2, 3, …)
- `M` = número de imagen dentro de la sección (1, 2, 3, …)

Ejemplo:

```
imgs/mobile/7.1.svg
imgs/mobile/7.2.svg
imgs/mobile/7.3.svg
```

> La detección empieza en `N.1.svg`. Si falta `N.1.svg`, la sección `N` no se muestra.

### 2. Poner el nombre de la sección

En `mobile.html`, edita la lista `NOMBRES`. **La posición en la lista indica el número de archivo**:

```javascript
var NOMBRES = [
	'BEBIDAS',            // 1.x.svg
	'ALMUERZO / CENA',    // 2.x.svg
	'DESAYUNO / BRUNCH',  // 3.x.svg
	'HELADOS / POSTRES',  // 4.x.svg
	'OTROS',              // 5.x.svg
	'MENÚ INFANTIL'       // 6.x.svg
];
```

- Si existe `7.1.svg` pero no hay 7.º nombre en la lista, se usará `"SECCIÓN 7"`.
- Para **quitar** una sección: borra sus imágenes.

### 3. Bumpear la caché (ver [Mantenimiento](#mantenimiento-qué-subir-y-cuándo))

---

## Cómo se cargan las imágenes (numeración)

- Al abrir la app, `mobile.html` busca `imgs/mobile/1.1.svg`, `2.1.svg`, `3.1.svg`… hasta `MAX_SECCIONES`.
- Para cada sección detectada, busca `N.1.svg`, `N.2.svg`, `N.3.svg`… hasta encontrar un hueco o llegar a `MAX_SLIDES`.
- Cada imagen se muestra en una diapositiva con el **header/footer** del menú.
- Cada imagen `N.M.svg` corresponde siempre a la sección `N` (nunca se reasigna a otra numeración).

Límites configurables en `mobile.html`:

```javascript
var MAX_SLIDES    = 40;   // máximo de imágenes por sección
var MAX_SECCIONES = Math.max(NOMBRES.length + 5, 8);
```

**Proporción recomendada** de las imágenes: **1 : 1.84** (vertical), para que encajen bien en el área de la pantalla.

---

## Rendimiento y caché

La app usa varias estrategias para cargar rápido y funcionar offline:

### En `mobile.html`

- **Detección cacheada**: los resultados de "qué secciones existen" se guardan en `localStorage` (`CACHE_KEY`) para no repetir la detección en cada apertura.
- **Refresco en segundo plano**: si hay caché, se muestra de inmediato y se actualiza en silencio.
- **Guard anti-truncado**: si una detección falla a medias (red intermitente), no pisa la caché buena por una lista incompleta.
- **`preload`** de la primera imagen de cada sección.
- **`loading="lazy"`, `decoding="async"`, `fetchpriority`** y `width/height` en las imágenes para evitar saltos de layout.
- **Timeout de 4 s** en la comprobación de existencia de archivos.

### En `sw.js` (Service Worker)

- **Shell precacheado**: HTML, CSS, JS, fuentes, iconos, header/footer e imágenes de la intro.
- **Imágenes y fuentes**: *cache-first*.
- **HTML**: *network-first* con respaldo en caché (funciona offline).
- **CSS/JS**: *stale-while-revalidate*.
- **Precache dinámico**: `mobile.html` envía al SW la lista de imágenes detectadas para guardarlas en segundo plano (con concurrencia limitada).

### Variables de caché

```javascript
// mobile.html
var CACHE_KEY = 'menu-mobile-v2';          // súbelo al AÑADIR secciones
var CACHE_TTL = 12 * 60 * 60 * 1000;       // 12 h (red de seguridad)

// sw.js
var VERSION = 'v2';                        // súbelo al EDITAR archivos existentes
```

---

## Instalación / PWA

La app cumple lo necesario para instalarse como aplicación en Android/iOS:

- `manifest.json` con `display: fullscreen`, `orientation: portrait`, iconos 192 y 512.
- Service worker registrado.
- Metatags de PWA en `mobile.html`.

Para instalar: abrir la página en el móvil → menú del navegador → **"Agregar a pantalla de inicio"** / **"Instalar"**.

---

## Mantenimiento: qué subir y cuándo

| Acción                                          | Qué subir                         |
|-------------------------------------------------|-----------------------------------|
| **Añadir secciones nuevas** (`7.1.svg`…)         | `CACHE_KEY` en `mobile.html`      |
| **Editar un SVG/imagen ya existente**            | `VERSION` en `sw.js`              |
| **Editar la lógica o los estilos** (HTML/CSS/JS) | `VERSION` en `sw.js`              |
| Si tienes dudas                                    | Subir ambas a la vez (es seguro)  |

`CACHE_TTL` (12 h) es solo una red de seguridad: aunque olvides subir las claves, los cambios aparecerán como máximo dentro de ese plazo.

Recuerda: tras actualizar, cada dispositivo debe recargar una vez (Ctrl+F5 o reabrir la app) para que el nuevo service worker tome el control.

---

## Desarrollo local

Sirve el proyecto desde un servidor HTTP (el service worker y la detección `fetch` **no funcionan** abriendo el archivo con `file://`).

Ejemplo con PHP (XAMPP/LAMPP):

```bash
# Coloca el proyecto en htdocs y abre:
http://localhost/webpages/menu/
```

O con Python:

```bash
python3 -m http.server 8000
# y abre http://localhost:8000/
```

> En local, si el navegador tiene cacheado un service worker antiguo, prueba en una ventana de incógnito o borra los datos del sitio.

---

## Créditos

- Navegación: [fullPage.js](https://github.com/alvarotrigo/fullPage.js)
- Resto: HTML/CSS/JS propios.
