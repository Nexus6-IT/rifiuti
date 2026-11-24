import { ElaboratoreFotoCanvas, FotoNonUtilizzabile, sha256Hex } from './foto';

describe('sha256Hex', () => {
  it('calcola lo SHA-256 esadecimale (vettore noto di «abc»)', async () => {
    const abc = new TextEncoder().encode('abc').buffer as ArrayBuffer;
    expect(await sha256Hex(abc)).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    );
  });
});

describe('ElaboratoreFotoCanvas', () => {
  it('rifiuta un file che non e una foto, e senza canvas dice che il telefono non puo', async () => {
    const e = new ElaboratoreFotoCanvas();
    await expect(e.prepara(new File(['x'], 'a.pdf', { type: 'application/pdf' }))).rejects.toThrow(
      FotoNonUtilizzabile,
    );
    // jsdom non ha createImageBitmap: l errore e comprensibile, non un crash.
    await expect(e.prepara(new File(['x'], 'a.jpg', { type: 'image/jpeg' }))).rejects.toThrow(
      /elaborare/,
    );
  });
});
