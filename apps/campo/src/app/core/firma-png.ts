import { Injectable } from '@angular/core';
import { ALTEZZA_TELA, LARGHEZZA_TELA, type TrattoFirma } from './tratto-firma';

/** Spessore del pennino sulla tela (unita' della tela). */
export const SPESSORE_PENNINO = 3;

/**
 * Disegna i tratti su un contesto 2D. Usato sia dalla tela a schermo sia dall'esportazione, cosi'
 * il PNG inviato e' esattamente quello che il cliente ha visto.
 */
export function disegna(ctx: CanvasRenderingContext2D, tratto: TrattoFirma, sfondo: boolean): void {
  if (sfondo) {
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, LARGHEZZA_TELA, ALTEZZA_TELA);
  } else {
    ctx.clearRect(0, 0, LARGHEZZA_TELA, ALTEZZA_TELA);
  }
  ctx.strokeStyle = '#111111';
  ctx.fillStyle = '#111111';
  ctx.lineWidth = SPESSORE_PENNINO;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  for (const t of tratto.tratti()) {
    if (t.length === 0) continue;
    ctx.beginPath();
    ctx.moveTo(t[0].x, t[0].y);
    for (let i = 1; i < t.length; i++) ctx.lineTo(t[i].x, t[i].y);
    ctx.stroke();
  }
}

/**
 * Esporta la firma in PNG su sfondo BIANCO opaco (niente trasparenza: nel PDF finirebbe nera).
 * Astratto per poterlo sostituire nei test (jsdom non ha canvas).
 */
@Injectable({ providedIn: 'root' })
export class FirmaPng {
  /** PNG in base64 senza prefisso `data:`, oppure `null` se il browser non sa disegnare. */
  esporta(tratto: TrattoFirma): string | null {
    const tela = document.createElement('canvas');
    tela.width = LARGHEZZA_TELA;
    tela.height = ALTEZZA_TELA;
    const ctx = tela.getContext('2d');
    if (!ctx) return null;
    disegna(ctx, tratto, true);
    const url = tela.toDataURL('image/png');
    const prefisso = 'data:image/png;base64,';
    return url.startsWith(prefisso) ? url.slice(prefisso.length) : null;
  }
}
