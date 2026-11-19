# Optimización de imágenes y rendimiento

Esta guía explica cómo reducir el peso del menú y qué esperar en el hosting.

Herramientas incluidas en `tools/`:

- **`optimizar-svg.js`** — limpia los SVG (metadata, comentarios) sin tocar las
  imágenes embebidas. Ver [Ahorro seguro con svgo](#ahorro-seguro-con-svgo-18-).
- **`exportar-webp.js`** — convierte los SVG del menú y las portadas a WebP
  (mucho más liviano). Ver [Exportar SVG → WebP](#exportar-svg--webp-con-toolsexportar-webpjs).

## Situación actual (medida)

- Los SVG de `imgs/mobile/` pesan **~725 KB cada uno** (header/footer ~800–860 KB).
- **Total: ~16 MB** para una sección media de menú.
- El peso viene de **imágenes JPEG embebidas en base64** dentro de cada SVG
  (~385 KB por archivo, 5 imágenes) + vectorizado de Inkscape.

Para un cliente nuevo eso significa descargar hasta **16 MB** en la primera visita.
Con la caché (service worker + HTTP) solo pasa **la primera vez**.

## Ahorro seguro con svgo: ~18 %

El script `tools/optimizar-svg.js` limpia metadata, comentarios y coordenadas
**sin tocar las imágenes embebidas**. Verifica en cada archivo que el número de
`<image>` se conserve; si un archivo perdiera imágenes, lo omite.

```bash
# Instalar svgo (una vez)
npm install --no-save svgo

# Ver el ahorro sin escribir nada
node tools/optimizar-svg.js --dry

# Aplicar la optimización (en sitio)
node tools/optimizar-svg.js
```

Resultado típico: **16 MB → 13 MB (-18.5 %)** con contenido intacto.

> ⚠️ **NO usar** `svgo --multipass` ni `preset-default` en estos SVG: se comprobó
> que **borran 4 de cada 5 `<image>`** embebidas y romperían el menú.

## Exportar SVG → WebP con `tools/exportar-webp.js`

Este script convierte los SVG a WebP en lote (mucho más liviano y rápido de
cargar). **Los `.svg` se mantienen como fuente editable**; los `.webp` son lo
que publica la app.

La app usa una lógica **.webp primero, .svg de respaldo**: si existe el `.webp`
lo sirve; si no, cae al `.svg`. Así nunca se rompe una sección aunque falte el
WebP.

### Qué procesa

El script trabaja dos tipos de archivo y, por defecto, **ambas carpetas**:

| Carpeta            | Patrón         | Ejemplo         | Qué es           |
|--------------------|----------------|-----------------|------------------|
| `imgs/mobile/`     | `N.M.svg`      | `1.1.svg`       | Slides del menú  |
| `imgs/portadas/`   | `N.svg`        | `3.svg`         | Portada sección `N` |

> Ignora archivos no numéricos como `header.svg`, `footer.svg`, `deslizar.svg`.

La **portada** de la sección `N` sale de `imgs/portadas/N.webp` (o `N.svg`); si
no existe ninguno de los dos, `mobile.html` usa `imgs/bebidas.jpg` por defecto.

### Requisitos (una sola vez)

```bash
npm install --no-save @resvg/resvg-js sharp
```

### Uso

```bash
# Exportar TODO (imgs/mobile + imgs/portadas)
node tools/exportar-webp.js

# Simular sin escribir nada (ver tamaños y ahorro)
node tools/exportar-webp.js --dry

# Solo una carpeta
node tools/exportar-webp.js --dir imgs/portadas

# Varias carpetas explícitas
node tools/exportar-webp.js --dir imgs/mobile,imgs/portadas

# Forzar regeneración (aunque el .webp ya exista y sea más nuevo)
node tools/exportar-webp.js --force

# Solo ciertas secciones (filtra por N en ambas carpetas)
node tools/exportar-webp.js --sec 1,3,5

# Ajustes de calidad / tamaño / paralelismo
node tools/exportar-webp.js --width 1440 --quality 82 --concurrency 3
```

### Opciones

| Opción              | Defecto                        | Descripción                          |
|---------------------|--------------------------------|--------------------------------------|
| `--dry`             | —                              | Simula, no escribe archivos          |
| `--force`           | —                              | Regenera aunque el WebP sea más nuevo|
| `--width <px>`      | `1080`                         | Ancho de salida (alto automático)    |
| `--quality <0-100>` | `80`                           | Calidad WebP                         |
| `--dir <rutas>`     | `imgs/mobile,imgs/portadas`    | Carpeta(s), separadas por coma       |
| `--sec <lista>`     | (todas)                        | Solo secciones: `1,3,5`              |
| `--concurrency <n>` | `3`                            | Archivos en paralelo                 |

### Comportamiento

- **Ancho fijo, alto automático** → la **proporción original se respeta**.
- **Fondo blanco** al convertir (evita halos oscuros; el WebP del menú no usa
  transparencia). Si alguna vez necesitas alpha, cambia `FONDO` a `null` dentro
  del script.
- **Salta archivos ya al día**: si el `.webp` existe y es más nuevo que su
  `.svg`, no lo regenera (salvo con `--force`). Solo exporta lo que cambió.
- Muestra el **ahorro por archivo** y un **resumen por carpeta + TOTAL**.

### Flujo recomendado de publicación

1. Editas/creas los `.svg` (menú en `imgs/mobile/N.M.svg`, portadas en
   `imgs/portadas/N.svg`).
2. Ejecutas `node tools/exportar-webp.js` (o `--dir imgs/portadas` si solo
   tocaste portadas).
3. **Sube tanto el `.svg` como el `.webp`** al servidor.
4. Si cambiaste portadas o slides ya cacheadas, **sube `CACHE_KEY`** en
   `mobile.html` (ej. `menu-mobile-v9`) o la `VERSION` de `sw.js` para que los
   clientes recojan los cambios; si no, verán la versión cacheada hasta que
   caduque (12 h).

> ⚠️ **Importante:** la detección de archivos se guarda en `localStorage`
> (`CACHE_KEY`, TTL 12 h). Crea el `.svg` y su `.webp` **juntos antes de
> publicar**; si añades el `.webp` después, los clientes que ya visitaron
> seguirán usando el `.svg` (o el fallback) hasta renovar caché.

## El ahorro grande (manual, desde la fuente)

Para bajar de forma agresiva (50 %+) hay que reducir las **imágenes JPEG
embebidas**, que es donde está el peso real:

1. Abrir el `.svg` en **Inkscape** (o el archivo fuente original).
2. Bajar la resolución de las imágenes raster a lo que se muestra en pantalla
   (~1080 px de ancho; proporción 1:1.84).
3. Exportar/embeker en **JPEG calidad ~80** o, mejor, **WebP**.
4. Reexportar el SVG y volver a pasar `tools/optimizar-svg.js`.

## Cache-Control en el servidor

Como los archivos son estáticos e idénticos para todos, configura caché larga
en el servidor (ej. Apache `.htaccess`):

```apache
<IfModule mod_headers.c>
  <FilesMatch "\.(svg|png|jpe?g|webp|gif|woff2?|ttf|css|js)$">
    Header set Cache-Control "public, max-age=31536000, immutable"
  </FilesMatch>
  <FilesMatch "\.html?$">
    Header set Cache-Control "no-cache"
  </FilesMatch>
</IfModule>
```

El HTML queda en `no-cache` (para que recoja la nueva `VERSION`/`CACHE_KEY`),
y los assets en caché de un año (el "bumpeo" de versión los renueva).

Habilita también **gzip/Brotli** para HTML/CSS/JS.

## CDN (muy recomendable)

Poner **Cloudflare** (plan gratuito) delante absorbe los picos: las imágenes se
sirven desde su red global y el servidor de origen casi no siente la carga.

## ¿Aguanta 1500–2000 personas a la vez?

- Sitio **estático** (sin PHP, sin BD): el servidor solo entrega archivos.
- La **mayoría de visitas repiten desde caché** → no vuelven a pedir imágenes.
- **Con CDN + SVG optimizados**: aguanta sin problema picos de miles.
- **Sin CDN en hosting compartido**: aguanta bien cientos simultáneos; un pico
  de miles *en primera visita* podría saturarlo. El CDN es la solución barata.
