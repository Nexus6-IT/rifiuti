import { describe, expect, it } from 'vitest';
import {
  ALTEZZA_TELA,
  LARGHEZZA_TELA,
  PUNTI_MASSIMI,
  TrattoFirma,
} from './tratto-firma';

const lineaRetta = (t: TrattoFirma, da: number, a: number, y = 50) => {
  t.inizia({ x: da, y });
  for (let x = da + 5; x <= a; x += 5) t.aggiungi({ x, y });
  t.termina();
};

describe('TrattoFirma', () => {
  it('vuoto all inizio e dopo pulisci', () => {
    const t = new TrattoFirma();
    expect(t.vuoto()).toBe(true);
    lineaRetta(t, 10, 200);
    expect(t.vuoto()).toBe(false);
    t.pulisci();
    expect(t.vuoto()).toBe(true);
    expect(t.lunghezza()).toBe(0);
  });

  it('un tocco o un puntino non e una firma', () => {
    const t = new TrattoFirma();
    t.inizia({ x: 100, y: 100 });
    t.termina();
    expect(t.vuoto()).toBe(true);
    expect(t.sufficiente()).toBe(false);
    t.inizia({ x: 100, y: 100 });
    t.aggiungi({ x: 100, y: 100 });
    t.aggiungi({ x: 103, y: 101 });
    t.termina();
    expect(t.sufficiente()).toBe(false);
  });

  it('un tratto lungo e esteso basta; uno lungo ma tutto sullo stesso punto no', () => {
    const t = new TrattoFirma();
    lineaRetta(t, 10, 200);
    expect(t.lunghezza()).toBeCloseTo(190, 0);
    expect(t.sufficiente()).toBe(true);

    const u = new TrattoFirma();
    u.inizia({ x: 100, y: 100 });
    for (let i = 0; i < 100; i++) {
      u.aggiungi({ x: 100 + (i % 2) * 3, y: 100 });
    }
    u.termina();
    expect(u.lunghezza()).toBeGreaterThan(120);
    expect(u.estensione().larghezza).toBeLessThan(40);
    expect(u.sufficiente()).toBe(false);
  });

  it('piu tratti si sommano', () => {
    const t = new TrattoFirma();
    lineaRetta(t, 10, 80, 30);
    lineaRetta(t, 10, 80, 90);
    expect(t.tratti()).toHaveLength(2);
    expect(t.lunghezza()).toBeCloseTo(140, 0);
    expect(t.sufficiente()).toBe(true);
  });

  it('i punti fuori dalla tela o non numerici sono riportati dentro', () => {
    const t = new TrattoFirma();
    t.inizia({ x: -50, y: 9999 });
    t.aggiungi({ x: 9999, y: -3 });
    t.aggiungi({ x: Number.NaN, y: Number.POSITIVE_INFINITY });
    t.termina();
    const punti = t.tratti().flat();
    expect(punti[0]).toEqual({ x: 0, y: ALTEZZA_TELA });
    expect(punti[1]).toEqual({ x: LARGHEZZA_TELA, y: 0 });
    for (const p of punti) {
      expect(p.x).toBeGreaterThanOrEqual(0);
      expect(p.x).toBeLessThanOrEqual(LARGHEZZA_TELA);
      expect(p.y).toBeGreaterThanOrEqual(0);
      expect(p.y).toBeLessThanOrEqual(ALTEZZA_TELA);
    }
  });

  it('non memorizza piu punti del tetto', () => {
    const t = new TrattoFirma();
    t.inizia({ x: 0, y: 0 });
    for (let i = 1; i < PUNTI_MASSIMI * 2; i++) t.aggiungi({ x: i % 600, y: (i * 7) % 240 });
    expect(t.tratti().flat().length).toBeLessThanOrEqual(PUNTI_MASSIMI);
  });

  it('aggiungere senza aver iniziato non fa nulla', () => {
    const t = new TrattoFirma();
    t.aggiungi({ x: 10, y: 10 });
    expect(t.tratti()).toHaveLength(0);
  });
});
