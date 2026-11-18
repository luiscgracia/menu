# Menú Digital — Restaurante

Aplicación web progresiva (PWA) de menú digital pensada **exclusivamente para móvil**, que es el caso real de un cliente que llega a un restaurante y escanea un código QR.

La app muestra una portada, una serie de secciones de menú (bebidas, almuerzo/cena, etc.) con navegación tipo presentación, y una pantalla de contacto al final. Las imágenes del menú se cargan **automáticamente** a partir de archivos numerados, sin tocar el código.

---

## Índice

- [Características](#características)
- [Estructura del proyecto](#estructura-del-proyecto)
- [Cómo agregar o editar secciones](#cómo-agregar-o-editar-secciones)
- [Cómo se cargan las imágenes (numeración)](#cómo-se-cargan-las-imágenes-numeración)
- [Publicar imágenes: SVG fuente → WebP](#publicar-imágenes-svg-fuente--webp)
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
├── tools/
│   ├── exportar-webp.js           Exporta N.M.svg -> N.M.webp (en lote)
│   └── optimizar-svg.js           (opcional) limpieza de SVG; ver README-optimizacion.md
├── fuentes/              Fuentes tipográficas (Arlrdlt, Arlrdbd, etc.)
└── imgs/
    ├── logocrepes1.*     Logo de la portada
    ├── bebidas.jpg       Imagen de fondo de las portadas de sección
    ├── icon-192.png      Icono PWA
    ├── icon-512.png      Icono PWA
    └── mobile/
        ├── header.svg    Cabecera del menú
        ├── footer.svg    Pie del menú
        ├── 1.1.svg       Sección 1, imagen 1 (fuente editable)
        ├── 1.1.webp      Sección 1, imagen 1 (publicada, la usa la app)
        ├── 1.2.svg
        ├── 1.2.webp
        ├── 2.1.svg
        ├── 2.1.webp
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

> La detección empieza en `N.1.svg` (o `N.1.webp`). Si falta `N.1` en ambos formatos, la sección `N` no se muestra.

### 1.b Exportar a WebP

Cuando el contenido esté listo, exporta a WebP con un solo comando (ver [Publicar imágenes](#publicar-imágenes-svg-fuente--webp)):

```bash
node tools/exportar-webp.js
```

Esto crea `N.M.webp` junto a cada `N.M.svg`. La app usará el WebP si existe.

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

- Al abrir la app, `mobile.html` busca `imgs/mobile/1.1`, `2.1`, `3.1`… hasta `MAX_SECCIONES`.
- Para cada sección detectada, busca `N.1`, `N.2`, `N.3`… hasta encontrar un hueco o llegar a `MAX_SLIDES`.
- Para cada posición **prefiere el `.webp`** (publicado) y **cae al `.svg`** (fuente) si no existe el WebP.
- Cada imagen se muestra en una diapositiva con el **header/footer** del menú.
- Cada imagen `N.M` corresponde siempre a la sección `N` (nunca se reasigna a otra numeración).

Límites configurables en `mobile.html`:

```javascript
var MAX_SLIDES    = 40;   // máximo de imágenes por sección
var MAX_SECCIONES = Math.max(NOMBRES.length + 5, 8);
```

**Proporción** de las imágenes: la actual de los SVG es **~1 : 1.44** (vertical). Lo importante es que **todos los SVG usen la misma proporción** entre sí y que se exporten a WebP **sin recortar** (el script mantiene la proporción original de cada archivo). En pantalla la imagen se ajusta con `object-fit: contain`, así que no se deforma.

---

## Publicar imágenes: SVG fuente → WebP

### Estrategia

- Se **diseña y edita en SVG** (`N.M.svg`), porque es lo más cómodo para cambiar texto de platos y precios.
- Cuando las secciones están **definitivas**, se **exportan a WebP** (`N.M.webp`) con un solo comando. El WebP pesa mucho menos y **mantiene la misma resolución y proporción**.
- **Los SVG se conservan** en la misma carpeta como fuente editable (para futuros cambios de precio). Publicar el WebP y quedarse el SVG.
- La app usa el **`.webp` si existe** y, si no, cae al `.svg`. Así nunca se rompe una imagen aunque falte exportar.

> **Cuándo exportar:** cuando el contenido esté aprobado. Mientras se edita/prototipa no hace falta; la app funciona directamente con los `.svg`.

### Por qué WebP y no JPG

En estas imágenes, **WebP con pérdida (lossy) pesa menos que JPG** con calidad equivalente (en pruebas: ~155 KB vs ~265 KB por imagen), **sin perder resolución**. (Exportar WebP *sin* pérdida desde Inkscape puede salir más grande que JPG; por eso el script usa WebP **lossy** a calidad 80.)

El peso real de los SVG está en las **imágenes JPEG embebidas** que llevan dentro, no en el dibujo vectorial: por eso el export a WebP es lo que de verdad reduce el tráfico. Ahorro típico medido: **~74 %** (menú de ~12 MB a ~3 MB).

### Requisitos (instalar una sola vez)

- **Node.js v18 o superior** → [nodejs.org](https://nodejs.org).
- Las librerías (una sola vez, desde la raíz del proyecto):

```bash
npm install --no-save @resvg/resvg-js sharp
```

> `--no-save` evita crear `package.json`; instala en `node_modules/`, que ya está en `.gitignore`.
> `@resvg/resvg-js` rasteriza los SVG **headless** (no necesita Inkscape ni pantalla) y `sharp` genera el WebP.

### Cómo se ejecuta (IMPORTANTE: desde la raíz del proyecto)

Los comandos se ejecutan **desde la raíz del proyecto** (la carpeta que contiene `tools/` e `imgs/`), **no** dentro de la carpeta de imágenes.

```bash
# 1) Situarse en la raíz del proyecto
cd ruta/a/menu

# 2) (Primera vez) instalar las librerías
npm install --no-save @resvg/resvg-js sharp

# 3) SIMULACRO: muestra el ahorro sin crear archivos
node tools/exportar-webp.js --dry

# 4) EXPORTAR: crea todos los N.M.webp en imgs/mobile/
node tools/exportar-webp.js
```

### Opciones del script

| Comando | Qué hace |
|---|---|
| `node tools/exportar-webp.js --dry` | Simula y muestra el ahorro. **No escribe nada.** |
| `node tools/exportar-webp.js` | Exporta todos los `N.M.svg` de menú a `N.M.webp` (ancho 1080, calidad 80). |
| `node tools/exportar-webp.js --width 1440` | Otro ancho de salida (la proporción se respeta solo). |
| `node tools/exportar-webp.js --quality 82` | Otra calidad WebP (por defecto 80). |
| `node tools/exportar-webp.js --force` | Regenera aunque el WebP exista y no haya cambiado. |
| `node tools/exportar-webp.js --dir imgs/mobile` | Procesa otra carpeta (por defecto `imgs/mobile`). |

### Qué procesa

- **Solo los SVG de menú** con patrón `N.M.svg` (ej. `1.1.svg`, `2.3.svg`).
- **Ignora** `header.svg`, `footer.svg`, `deslizar.svg` u otros no numéricos (esos se dejan en SVG).
- Mantiene la **proporción original** de cada SVG (ancho fijo, alto automático).
- Si un `.webp` ya está más actualizado que su `.svg`, lo **salta** (usa `--force` para forzar).

### Flujo recomendado (resumen)

1. Crear/editar los `.svg` de menú (`N.M.svg`).
2. Al aprobar el contenido: `node tools/exportar-webp.js --dry` para ver el ahorro.
3. `node tools/exportar-webp.js` para generar los `.webp`.
4. Subir `VERSION` en `sw.js` (ver [Mantenimiento](#mantenimiento-qué-subir-y-cuándo)).
5. Revisar en el navegador (incógnito o borrando caché) que se vea bien.

> Los `.svg` originales quedan junto a los `.webp` para ediciones futuras (p. ej. cambiar un precio) y volver a exportar.

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
var VERSION = 'v3';                        // súbelo al EDITAR archivos o re-exportar WebP
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
| **Editar un SVG/imagen ya existente**            | Re-exportar a WebP y `VERSION` en `sw.js` |
| **Re-exportar a WebP** (ver [Publicar imágenes](#publicar-imágenes-svg-fuente--webp)) | `VERSION` en `sw.js` |
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
