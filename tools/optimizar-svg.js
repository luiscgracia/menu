#!/usr/bin/env node
/* =====================================================================
   Optimizador SEGURO de SVG para el menú (EN LOTE, RECURSIVO)
   ---------------------------------------------------------------------
   Procesa TODOS los .svg de la carpeta y subcarpetas de una sola pasada.

   Uso:
     node tools/optimizar-svg.js                     # todo imgs/ (recursivo)
     node tools/optimizar-svg.js --dry               # simula, no escribe
     node tools/optimizar-svg.js --dir imgs/mobile   # solo una carpeta
     node tools/optimizar-svg.js --backup            # respalda originales
                                                     #   en .svg-backup/
     node tools/optimizar-svg.js --menu-only         # solo N.M.svg
     node tools/optimizar-svg.js --concurrency 4     # paralelismo (def. 4)

   Seguridad:
     • Verifica que NO se pierdan <image> en ningún archivo. Si pasara,
       ese archivo se OMITE y se avisa.
     • Con --backup guarda los originales antes de sobrescribir.

   Qué hace: quita metadata de Inkscape, comentarios, XML decl, <desc>/<title>;
             limpia atributos, agrupa <g>, reduce precisión de coordenadas,
             elimina atributos vacíos y contenedores vacíos de forma segura.
   Qué NO hace: preset-default / multipass (borran imágenes embebidas) ni
             recomprimir los JPEG internos (eso se hace en la fuente).

   Ahorro seguro típico: ~15–25 % sin alterar el contenido.
   ===================================================================== */

const fs = require('fs');
const path = require('path');
const SVGO = require('svgo');

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
Uso: node tools/optimizar-svg.js [opciones]

Opciones:
  --dry              Simula, no escribe archivos
  --backup           Guarda originales en .svg-backup/ antes de sobrescribir
  --dir <ruta>       Carpeta raíz a procesar (defecto: imgs)
  --menu-only        Solo archivos con patrón N.M.svg
  --concurrency <n>  Archivos en paralelo (defecto: 4)
  --help, -h         Muestra esta ayuda
`);
  process.exit(0);
}

const dry         = has('--dry');
const backup      = has('--backup');
const menuOnly    = has('--menu-only');
const rootDir     = opt('--dir', 'imgs');
const concurrency = Math.max(1, Math.min(8, parseInt(opt('--concurrency', '4'), 10) || 4));

const config = {
  multipass: false,
  plugins: [
    'removeDoctype',
    'removeXMLProcInst',
    'removeComments',
    'removeMetadata',
    'removeEditorsNSData',
    'removeDesc',
    'removeTitle',
    'cleanupAttrs',
    'removeEmptyAttrs',
    'removeEmptyContainers',
    { name: 'cleanupNumericValues', params: { floatPrecision: 3 } },
    { name: 'convertPathData', params: { floatPrecision: 3, noSpaceAfterFlags: false } },
    'collapseGroups'
    // Sin preset-default, sin removeHiddenElems, sin cleanupIds agresivo,
    // sin removeDimensions: todo lo que pueda tocar <image> queda fuera.
  ]
};

function contarImagenes(svg) {
  const m = svg.match(/<image[\s>]/g);
  return m ? m.length : 0;
}

function esMenuSVG(nombre) {
  return /^\d+\.\d+\.svg$/i.test(nombre);
}

/* Recorre rootDir y devuelve rutas de todos los .svg (recursivo) */
function listarSVG(dir) {
  let out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === '.svg-backup') continue;   // no procesar respaldos
      out = out.concat(listarSVG(full));
    } else if (entry.name.toLowerCase().endsWith('.svg')) {
      if (menuOnly && !esMenuSVG(entry.name)) continue;
      out.push(full);
    }
  }
  return out;
}

function guardarBackup(file, contenido) {
  const rel  = path.relative(rootDir, file);
  const dest = path.join(rootDir, '.svg-backup', rel);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  if (!fs.existsSync(dest)) {
    fs.writeFileSync(dest, contenido); // no pisar backup previo
  }
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
            if (results.filter(r => r !== undefined).length === items.length) {
              resolve(results);
            } else {
              next();
            }
          });
      }
    }
    next();
  });
}

async function main() {
  if (!fs.existsSync(rootDir)) {
    console.error('No existe la carpeta: ' + rootDir);
    process.exit(1);
  }

  const files = listarSVG(rootDir);
  if (!files.length) {
    console.log('No se encontraron SVG en ' + rootDir +
      (menuOnly ? ' (modo --menu-only)' : ''));
    return;
  }

  console.log(`Procesando ${files.length} archivo(s) en "${rootDir}"` +
              ` (paralelismo ${concurrency})` +
              (dry ? '  [MODO PRUEBA, no escribe]' : '') +
              (menuOnly ? '  [--menu-only]' : '') +
              '\n');

  let totalAntes = 0, totalDespues = 0, conCambios = 0, problemas = 0, iguales = 0;

  const resultados = await pMap(files, async (file) => {
    const rel = path.relative(rootDir, file);
    const original = fs.readFileSync(file, 'utf8');
    const imgsAntes = contarImagenes(original);

    let optimizado;
    try {
      const result = SVGO.optimize(original, { path: file, ...config });
      optimizado = result.data;
    } catch (e) {
      return { tipo: 'error', rel, error: e.message };
    }

    const imgsDespues = contarImagenes(optimizado);
    const kbAntes   = Buffer.byteLength(original) / 1024;
    const kbDespues = Buffer.byteLength(optimizado) / 1024;

    // Guard: si se pierden <image>, NO tocar
    if (imgsDespues < imgsAntes) {
      return {
        tipo: 'peligro',
        rel,
        imgsAntes,
        imgsDespues,
        kbAntes,
        kbDespues
      };
    }

    if (kbDespues < kbAntes - 0.5) {
      if (!dry) {
        if (backup) guardarBackup(file, original);
        fs.writeFileSync(file, optimizado);
      }
      return {
        tipo: 'mejorado',
        rel,
        kbAntes,
        kbDespues,
        imgsAntes
      };
    }

    return {
      tipo: 'igual',
      rel,
      kbAntes,
      kbDespues
    };
  }, concurrency);

  // Resumen ordenado
  for (const r of resultados) {
    if (!r) continue;

    if (r.tipo === 'error') {
      problemas++;
      console.log(`  ✗ ${r.rel}: ERROR al optimizar → ${r.error}`);
      continue;
    }

    totalAntes   += r.kbAntes || 0;
    totalDespues += r.kbDespues || 0;

    if (r.tipo === 'peligro') {
      problemas++;
      console.log(`  ✗ ${r.rel}: PELIGRO, <image> ${r.imgsAntes} → ${r.imgsDespues}. NO se toca.`);
    } else if (r.tipo === 'mejorado') {
      conCambios++;
      const pct = ((1 - r.kbDespues / r.kbAntes) * 100).toFixed(1);
      console.log(`  ✓ ${r.rel}: ${r.kbAntes.toFixed(0)}KB → ${r.kbDespues.toFixed(0)}KB (-${pct}%)` +
                  (r.imgsAntes ? `  [${r.imgsAntes} img OK]` : ''));
    } else {
      iguales++;
    }
  }

  const ahorro = totalAntes > 0 ? ((1 - totalDespues / totalAntes) * 100).toFixed(1) : '0';
  console.log('\n--------------------------------------------');
  console.log(`Archivos con mejora: ${conCambios}/${files.length}  (sin mejora: ${iguales})`);
  console.log(`Total: ${(totalAntes / 1024).toFixed(1)} MB → ${(totalDespues / 1024).toFixed(1)} MB (-${ahorro}%)`);
  if (problemas) console.log(`⚠ ${problemas} archivo(s) con problemas, se omitieron.`);
  if (backup && !dry) console.log(`Copias de respaldo en: ${path.join(rootDir, '.svg-backup')}`);
  if (dry) console.log('(--dry: no se escribió ningún archivo)');
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});
