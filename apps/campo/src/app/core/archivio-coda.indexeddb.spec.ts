import { ArchivioCodaIndexedDb } from './archivio-coda.indexeddb';
import type { EventoInCoda } from './coda-eventi';

const evento = (id: string): EventoInCoda => ({
  id,
  utenteId: 'u1',
  ritiroId: 'r1',
  tipo: 'RITIRO_ESEGUITO',
  versioneVista: 1,
  dataVista: '2026-12-01',
  sedeVista: '33333333-3333-4333-8333-333333333333',
  dati: {},
  rilevatoIl: '2026-12-01T08:00:00.000Z',
  stato: 'DA_INVIARE',
  tentativi: 0,
  errore: null,
  esito: null,
  motivoConflitto: null,
});

/** Doppio minimo di IndexedDB con uno store a chiave `id`. */
class FakeIdb {
  righe = new Map<string, unknown>();
  aperture = 0;
  transazioniChePerdono = 0;
  creazione: unknown = undefined;
  open() {
    this.aperture++;
    const rich: Record<string, unknown> = { result: null };
    const db = {
      onclose: null,
      onversionchange: null,
      close: () => undefined,
      createObjectStore: (_n: string, opz: unknown) => {
        this.creazione = opz;
      },
      transaction: () => {
        if (this.transazioniChePerdono > 0) {
          this.transazioniChePerdono--;
          throw new DOMException('Connection lost', 'InvalidStateError');
        }
        const tx: Record<string, unknown> = {};
        const richiesta = (op: () => unknown) => {
          const r = { result: undefined as unknown };
          queueMicrotask(() => {
            r.result = op();
            (tx['oncomplete'] as () => void)();
          });
          return r;
        };
        const store = {
          put: (v: { id: string }) => richiesta(() => this.righe.set(v.id, structuredClone(v))),
          getAll: () => richiesta(() => [...this.righe.values()].map((v) => structuredClone(v))),
          delete: (id: string) => richiesta(() => this.righe.delete(id)),
        };
        tx['objectStore'] = () => store;
        return tx;
      },
    };
    rich['result'] = db;
    queueMicrotask(() => {
      (rich['onupgradeneeded'] as undefined | (() => void))?.();
      (rich['onsuccess'] as () => void)();
    });
    return rich;
  }
}

describe('ArchivioCodaIndexedDb', () => {
  let fake: FakeIdb;
  beforeEach(() => {
    fake = new FakeIdb();
    vi.stubGlobal('indexedDB', fake);
  });
  afterEach(() => vi.unstubAllGlobals());

  it('salva, rilegge, sostituisce per id e rimuove; lo store ha keyPath id', async () => {
    const a = new ArchivioCodaIndexedDb();
    await a.salva(evento('a'));
    await a.salva(evento('b'));
    await a.salva({ ...evento('a'), stato: 'CONFERMATO' });
    const tutti = await a.tutti();
    expect(tutti.map((e) => `${e.id}:${e.stato}`).sort()).toEqual(['a:CONFERMATO', 'b:DA_INVIARE']);
    await a.rimuovi('a');
    expect((await a.tutti()).map((e) => e.id)).toEqual(['b']);
    expect(fake.creazione).toEqual({ keyPath: 'id' });
  });

  it('connessione persa (iOS): riapre e ritenta, l esito non va perso', async () => {
    const a = new ArchivioCodaIndexedDb();
    await a.salva(evento('a'));
    fake.transazioniChePerdono = 1;
    await a.salva(evento('b'));
    expect(fake.aperture).toBe(2);
    expect((await a.tutti()).length).toBe(2);
  });

  it('senza IndexedDB salva() lancia (l evento non sarebbe al sicuro), tutti() da vuoto', async () => {
    vi.stubGlobal('indexedDB', undefined);
    const a = new ArchivioCodaIndexedDb();
    await expect(a.salva(evento('a'))).rejects.toThrow();
    expect(await a.tutti()).toEqual([]);
  });

  it('se anche il secondo tentativo fallisce salva() lancia', async () => {
    const a = new ArchivioCodaIndexedDb();
    fake.transazioniChePerdono = 2;
    await expect(a.salva(evento('a'))).rejects.toThrow();
  });
});
