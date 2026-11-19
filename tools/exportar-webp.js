#!/usr/bin/env node
/* =====================================================================
   Exportador SVG -> WebP (en lote) para el menú
   ---------------------------------------------------------------------
   Convierte cada SVG de menú (N.M.svg) a WebP (N.M.webp) en la MISMA
   carpeta, manteniendo la proporción original. Los SVG quedan como
   fuente editable; los WebP son lo que publica la app.

   Requiere (una sola vez, desde la raíz del proyecto):
     npm install --no-save @resvg/resvg-js sharp

   Uso (desde la raíz del proyecto):
     node tools/exportar-webp.js --dry               # simula, no escribe
     node tools/exportar-webp.js                      # exporta todo (mobile + portadas)
     node tools/exportar-webp.js --width 1440         # otro ancho (def. 1080)
     node tools/exportar-webp.js --quality 82         # calidad WebP (def. 80)
     node tools/exportar-webp.js --dir imgs/mobile    # una sola carpeta
     node tools/exportar-webp.js --dir imgs/mobile,imgs/portadas   # varias
     node tools/exportar-webp.js --force              # regenera aunque exista y no cambie
     node tools/exportar-webp.js --sec 1,3,5          # solo esas secciones
     node tools/exportar-webp.js --concurrency 3      # paralelismo (def. 3)

   Qué procesa:
     • Menú:     archivos N.M.svg  (ej. 1.1.svg, 2.3.svg).
     • Portadas: archivos N.svg    (ej. 1.svg, 2.svg).
     • Ignora header.svg, footer.svg, deslizar.svg u otros no numéricos.

   Notas:
     • Ancho fijo (--width) y alto automático -> la PROPORCIÓN se respeta.
     • Fondo blanco (el WebP no admite transparencia útil en menú y evita
       halos oscuros al convertir). Si necesitas transparencia, cambia
       FONDO a null.
   ===================================================================== */

const fs = require('fs');
const path = require('path');

let Resvg, sharp;
try {
  ({ Resvg } = require('@resvg/resvg-js'));
  sharp = require('sharp');
} catch (e) {
  console.error('Faltan dependencias. Ejecuta desde la raíz del proyecto:\n');
  console.error('  npm install --no-save @resvg/resvg-js sharp\n');
  process.exit(1);
}

/* ---- Opciones ---- */
const args = process.argv.slice(2);

function has(flag) {
  return args.includes(flag);
}

function opt(name, def) {
  const i = args.indexOf(name);
  return i !== -1 && args[i + 1] !== undefined ? args[i + 1] : def;
}

if (has('--help') || has('-h')) {
  console.log(`
Uso: node tools/exportar-webp.js [opciones]

Opciones:
  --dry              Simula, no escribe archivos
  --force            Regenera aunque el WebP sea más nuevo
  --width <px>       Ancho de salida (defecto: 1080)
  --quality <0-100>  Calidad WebP (defecto: 80)
  --dir <rutas>      Carpeta(s) a procesar, separadas por coma
                     (defecto: imgs/mobile,imgs/portadas)
  --sec <lista>      Solo secciones indicadas (ej: 1,3,5)
  --concurrency <n>  Archivos en paralelo (defecto: 3)
  --help, -h         Muestra esta ayuda
`);
  process.exit(0);
}

const dry          = has('--dry');
const force        = has('--force');
const width        = Math.max(320, parseInt(opt('--width', '1080'), 10) || 1080);
const quality      = Math.min(100, Math.max(40, parseInt(opt('--quality', '80'), 10) || 80));
const dirs         = opt('--dir', 'imgs/mobile,imgs/portadas')
                       .split(',')
                       .map(d => d.trim())
                       .filter(Boolean);
const concurrency  = Math.max(1, Math.min(8, parseInt(opt('--concurrency', '3'), 10) || 3));
const FONDO        = '#ffffff';   // blanco; pon null si alguna vez necesitas alpha

/* --sec 1,3,5 → Set de números de sección */
const secRaw = opt('--sec', '');
const soloSecciones = secRaw
  ? new Set(secRaw.split(',').map(s => parseInt(s.trim(), 10)).filter(n => !isNaN(n) && n > 0))
  : null;

/* Reconoce dos patrones de nombre:
     N.M.svg  -> menú    (ej. 1.1.svg)  => {n, m}
     N.svg    -> portada (ej. 1.svg)    => {n, m: 0}
   Devuelve null si no encaja. */
function esSVG(nombre) {
  let m = nombre.match(/^(\d+)\.(\d+)\.svg$/i);
  if (m) return { n: +m[1], m: +m[2] };
  m = nombre.match(/^(\d+)\.svg$/i);
  if (m) return { n: +m[1], m: 0 };
  return null;
}

function listarSVG(carpeta) {
  return fs.readdirSync(carpeta)
    .filter(f => {
      const info = esSVG(f);
      if (!info) return false;
      if (soloSecciones && !soloSecciones.has(info.n)) return false;
      return true;
    })
    .map(f => ({
      archivo: f,
      base: f.replace(/\.svg$/i, ''),
      info: esSVG(f)
    }))
    .sort((a, b) => a.info.n - b.info.n || a.info.m - b.info.m);
}

async function exportarUno(svgPath, outPath) {
  const svg = fs.readFileSync(svgPath, 'utf8');
  if (!svg.trim()) throw new Error('SVG vacío');

  const resvg = new Resvg(svg, {
    fitTo: { mode: 'width', value: width },
    background: FONDO || 'transparent'
  });
  const png = resvg.render().asPng();

  const buf = await sharp(png)
    .webp({
      quality: quality,
      alphaQuality: FONDO ? 100 : 90,
      effort: 5
    })
    .toBuffer();

  fs.writeFileSync(outPath, buf);
  return buf.length;
}

/* Ejecuta promesas con límite de concurrencia */
async function pMap(items, fn, limit) {
  const results = new Array(items.length);
  let idx = 0;
  let active = 0;

  return new Promise((resolve) => {
    if (!items.length) return resolve(results);

    function next() {
      while (active < limit && idx < items.length) {
        const i = idx++;
        active++;
        Promise.resolve(fn(items[i], i))
          .then(r => { results[i] = r; })
          .catch(e => { results[i] = { error: e }; })
          .finally(() => {
            active--;
            if (results.filter(Boolean).length === items.length) resolve(results);
            else next();
          });
      }
    }
    next();
  });
}

/* Procesa una carpeta y devuelve un objeto con totales y resultados */
async function procesarCarpeta(dir) {
  if (!fs.existsSync(dir)) {
    console.error('No existe la carpeta: ' + dir);
    return null;
  }

  const items = listarSVG(dir);
  if (!items.length) {
    console.log('[' + dir + '] sin SVG que procesar');
    return { dir, totalSVG: 0, totalWebP: 0, hechos: 0, saltados: 0, errores: 0 };
  }

  console.log(`[${dir}] ${items.length} SVG` +
              (soloSecciones ? `  [solo sec: ${[...soloSecciones].join(',')}]` : ''));

  let totalSVG = 0, totalWebP = 0, hechos = 0, saltados = 0, errores = 0;

  const resultados = await pMap(items, async (it) => {
    const svgPath = path.join(dir, it.archivo);
    const outPath = path.join(dir, it.base + '.webp');
    const kbSVG = fs.statSync(svgPath).size / 1024;

    // Si ya existe el webp y es más nuevo que el svg, saltar (salvo --force)
    if (!force && fs.existsSync(outPath) &&
        fs.statSync(outPath).mtimeMs >= fs.statSync(svgPath).mtimeMs) {
      const kbWebP = fs.statSync(outPath).size / 1024;
      return { tipo: 'saltado', kbSVG, kbWebP, base: it.base };
    }

    try {
      if (dry) {
        // En dry no escribimos; estimamos generando en memoria
        const svg = fs.readFileSync(svgPath, 'utf8');
        const resvg = new Resvg(svg, {
          fitTo: { mode: 'width', value: width },
          background: FONDO || 'transparent'
        });
        const png = resvg.render().asPng();
        const buf = await sharp(png).webp({ quality, effort: 5 }).toBuffer();
        const kbWebP = buf.length / 1024;
        return { tipo: 'dry', kbSVG, kbWebP, base: it.base };
      } else {
        const bytes = await exportarUno(svgPath, outPath);
        const kbWebP = bytes / 1024;
        return { tipo: 'ok', kbSVG, kbWebP, base: it.base };
      }
    } catch (e) {
      return { tipo: 'error', kbSVG, base: it.base, error: e.message };
    }
  }, concurrency);

  // Resumen ordenado de la carpeta
  for (const r of resultados) {
    if (!r) continue;
    totalSVG += r.kbSVG || 0;

    if (r.tipo === 'saltado') {
      totalWebP += r.kbWebP;
      saltados++;
    } else if (r.tipo === 'error') {
      errores++;
      console.log(`  ✗ ${r.base}: ERROR ${r.error}`);
    } else {
      totalWebP += r.kbWebP;
      hechos++;
      const pct = r.kbSVG > 0 ? ((1 - r.kbWebP / r.kbSVG) * 100).toFixed(0) : '0';
      const marca = r.tipo === 'dry' ? '·' : '✓';
      console.log(`  ${marca} ${r.base}${r.tipo === 'ok' ? '.webp' : ''}: ${r.kbSVG.toFixed(0)}KB → ${r.kbWebP.toFixed(0)}KB (-${pct}%)`);
    }
  }

  return { dir, totalSVG, totalWebP, hechos, saltados, errores };
}

async function main() {
  console.log(`Exportando SVG de menú/portadas a WebP` +
              ` (ancho ${width}px, calidad ${quality}, paralelismo ${concurrency})` +
              (dry ? '  [MODO PRUEBA, no escribe]' : '') +
              '\n');

  const resumenes = [];
  for (const dir of dirs) {
    const r = await procesarCarpeta(dir);
    if (r) resumenes.push(r);
    console.log(''); // separación entre carpetas
  }

  // Totales globales
  let totalSVG = 0, totalWebP = 0, hechos = 0, saltados = 0, errores = 0;
  for (const r of resumenes) {
    totalSVG += r.totalSVG;
    totalWebP += r.totalWebP;
    hechos += r.hechos;
    saltados += r.saltados;
    errores += r.errores;
  }

  const ahorro = totalSVG > 0 ? ((1 - totalWebP / totalSVG) * 100).toFixed(1) : '0';
  console.log('--------------------------------------------');
  console.log(`TOTAL  Exportados: ${hechos}  (ya al día: ${saltados})  errores: ${errores}`);
  console.log(`Total SVG: ${(totalSVG / 1024).toFixed(1)} MB → WebP: ${(totalWebP / 1024).toFixed(1)} MB (-${ahorro}%)`);
  if (dry) console.log('(--dry: no se escribió ningún archivo)');
  if (errores) console.log('⚠ Hubo errores en algunos archivos (ver arriba).');
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});
