// Spanish copy, keyed to the t() calls in the components.
//
// Split by area so several screens can be worked on without fighting over one
// file. `npm test` fails if a t() key has no entry here, or if an entry here is
// no longer used by any component.
//
// GLOSSARY — keep these consistent across every screen. These are the terms
// used on the warehouse floor, not textbook translations:
//
//   pallet               → tarima
//   bag                  → bolsa
//   case                 → caja
//   load                 → carga
//   BOL / Bill of Lading → BOL (spell out "conocimiento de embarque" only on
//                          first mention within a screen, if at all)
//   picklist             → lista de surtido
//   staging area         → área de preparación
//   staging lane         → carril de preparación
//   inspection           → inspección
//   inspector            → inspector
//   scan (verb)          → escanear
//   batch code           → código de lote
//   damage               → daño
//   discrepancy          → discrepancia
//   returns              → devoluciones
//   retag                → reetiquetado
//   dock                 → andén
//   site                 → sitio
//   photo                → foto
//   flag (verb)          → marcar
//   complete / submit    → completar / enviar
//   skip                 → omitir
//   retake               → volver a tomar
//   trailer              → remolque
//   seal                 → sello
//   quantity             → cantidad
//   expected / actual    → esperado / real
//
// Tone: neutral imperatives ("Tome una foto"), never informal "tú" forms.
// Keep strings short — these render on a tablet held at arm's length.

import { admin } from './admin';
import { capture } from './capture';
import { components } from './components';
import { pallet } from './pallet';
import { shell } from './shell';
import { verify } from './verify';

export const es: Record<string, string> = {
  ...shell,
  ...capture,
  ...pallet,
  ...verify,
  ...admin,
  ...components,
};
