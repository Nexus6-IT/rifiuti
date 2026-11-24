import { Injectable } from '@angular/core';

/** Tetti dell'app, allineati al server (1 MiB per foto, 3 per esito). */
export const MAX_BYTE_FOTO = 1024 * 1024;
export const MAX_FOTO_PER_ESITO = 3;
/** Si punta un po' sotto il tetto del server: un margine, non il limite esatto. */
const OBIETTIVO_BYTE = 900_000;
const LATO_MASSIMO_PX = 1600;

/** Foto pronta da mettere in coda: gia' compressa, con l'impronta dei byte che verranno inviati. */
export interface FotoPronta {
  mimeType: 'image/jpeg';
  dimensioneByte: number;
  /** SHA-256 esadecimale dei byte in `contenuto`. */
  sha256: string;
  contenuto: ArrayBuffer;
}

export class FotoNonUtilizzabile extends Error {}

/**
 * Compressione della foto sul telefono (canvas): lato lungo al massimo 1600 px, JPEG con qualita'
 * decrescente finche' sta sotto ~900 kB. Astratta perche' jsdom non ha canvas: i test la sostituiscono.
 */
@Injectable({ providedIn: 'root', useFactory: () => new ElaboratoreFotoCanvas() })
export abstract class ElaboratoreFoto {
  abstract prepara(file: File): Promise<FotoPronta>;
}

export async function sha256Hex(dati: ArrayBuffer): Promise<string> {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle)
    throw new FotoNonUtilizzabile('Il telefono non può calcolare l’impronta della foto.');
  const h = new Uint8Array(await subtle.digest('SHA-256', dati));
  return Array.from(h, (b) => b.toString(16).padStart(2, '0')).join('');
}

/** Passi di compressione: (lato lungo massimo, qualita' JPEG). Dal migliore al piu' leggero. */
export const PASSI_COMPRESSIONE: readonly [number, number][] = [
  [LATO_MASSIMO_PX, 0.7],
  [LATO_MASSIMO_PX, 0.55],
  [1280, 0.5],
  [1024, 0.45],
  [800, 0.4],
];

export class ElaboratoreFotoCanvas implements ElaboratoreFoto {
  async prepara(file: File): Promise<FotoPronta> {
    if (!file.type.startsWith('image/')) {
      throw new FotoNonUtilizzabile('Questo file non è una foto.');
    }
    if (typeof createImageBitmap !== 'function' || typeof document === 'undefined') {
      throw new FotoNonUtilizzabile('Questo telefono non riesce a elaborare le foto.');
    }
    let immagine: ImageBitmap;
    try {
      // `imageOrientation: from-image` applica l'orientamento EXIF: la foto esce dritta.
      immagine = await createImageBitmap(file, { imageOrientation: 'from-image' });
    } catch {
      throw new FotoNonUtilizzabile('Non riesco a leggere la foto.');
    }
    try {
      for (const [lato, qualita] of PASSI_COMPRESSIONE) {
        const blob = await this.ridimensiona(immagine, lato, qualita);
        if (blob.size <= OBIETTIVO_BYTE) {
          const contenuto = await blob.arrayBuffer();
          return {
            mimeType: 'image/jpeg',
            dimensioneByte: contenuto.byteLength,
            sha256: await sha256Hex(contenuto),
            contenuto,
          };
        }
      }
    } finally {
      immagine.close();
    }
    throw new FotoNonUtilizzabile('La foto è troppo pesante anche dopo la compressione.');
  }

  private ridimensiona(img: ImageBitmap, latoMax: number, qualita: number): Promise<Blob> {
    const scala = Math.min(1, latoMax / Math.max(img.width, img.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(img.width * scala));
    canvas.height = Math.max(1, Math.round(img.height * scala));
    const ctx = canvas.getContext('2d');
    if (!ctx)
      return Promise.reject(new FotoNonUtilizzabile('Il telefono non riesce a elaborare la foto.'));
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    return new Promise((ok, ko) =>
      canvas.toBlob(
        (b) => (b ? ok(b) : ko(new FotoNonUtilizzabile('Non riesco a comprimere la foto.'))),
        'image/jpeg',
        qualita,
      ),
    );
  }
}
