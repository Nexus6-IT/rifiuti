import { ArchivioGiroIndexedDb } from './archivio-giro.indexeddb';
import type { SnapshotGiro } from './archivio-giro';

const snap: SnapshotGiro = {
  utenteId: 'u1',
  data: '2026-11-20',
  aggiornatoIl: 'x',
  giro: { data: '2026-11-20', autista: { id: 'a', nome: 'M', cognome: 'B' }, ritiri: [] },
};

/** Doppio minimo di IndexedDB: un record, connessioni che possono «perdersi» (iOS). */
class FakeIdb {
  dato: unknown = undefined;
  aperture = 0;
  /** Connessioni aperte, nell'ordine; `chiusa` dice se e' stato chiamato `close()`. */
  dbs: Array<{ chiusa: boolean; onclose: null | (() => void) }> = [];
  /** Quante delle prossime `transaction()` lanciano InvalidStateError. */
  transazioniChePerdono = 0;
  open() {
    this.aperture++;
    const rich: Record<string, unknown> = { result: null };
    const db = {
      chiusa: false,
      onclose: null as null | (() => void),
      onversionchange: null as null | (() => void),
      close: () => {
        db.chiusa = true;
      },
      createObjectStore: () => undefined,
      objectStoreNames: { contains: () => true },
      transaction: () => {
        if (this.transazioniChePerdono > 0) {
          this.transazioniChePerdono--;
          throw new DOMException('Connection lost', 'InvalidStateError');
        }
        const tx: Record<string, unknown> = {};
        const store = {
          put: (v: unknown) => this.richiesta(tx, () => (this.dato = v)),
          get: () => this.richiesta(tx, () => this.dato),
          clear: () => this.richiesta(tx, () => (this.dato = undefined)),
        };
        tx['objectStore'] = () => store;
        return tx;
      },
    };
    this.dbs.push(db);
    rich['result'] = db;
    queueMicrotask(() => {
      (rich['onupgradeneeded'] as undefined | (() => void))?.();
      (rich['onsuccess'] as () => void)();
    });
    return rich;
  }
  private richiesta(tx: Record<string, unknown>, op: () => unknown) {
    const r = { result: undefined as unknown };
    queueMicrotask(() => {
      r.result = op();
      (tx['oncomplete'] as () => void)();
    });
    return r;
  }
}

describe('ArchivioGiroIndexedDb', () => {
  let fake: FakeIdb;
  beforeEach(() => {
    fake = new FakeIdb();
    vi.stubGlobal('indexedDB', fake);
  });
  afterEach(() => vi.unstubAllGlobals());

  it('salva e rilegge', async () => {
    const a = new ArchivioGiroIndexedDb();
    await a.salva(snap);
    expect(await a.leggi()).toEqual(snap);
    await a.cancella();
    expect(await a.leggi()).toBeNull();
  });

  it('connessione persa (iOS): riapre e ritenta, il salvataggio non va perso', async () => {
    const a = new ArchivioGiroIndexedDb();
    await a.salva(snap);
    fake.transazioniChePerdono = 1;
    await a.salva({ ...snap, aggiornatoIl: 'y' });
    expect(fake.aperture).toBe(2);
    expect((await a.leggi())?.aggiornatoIl).toBe('y');
  });

  it('connessione persa: la cancellazione riesce comunque', async () => {
    const a = new ArchivioGiroIndexedDb();
    await a.salva(snap);
    fake.transazioniChePerdono = 1;
    await a.cancella();
    expect(fake.dato).toBeUndefined();
  });

  it('se anche il secondo tentativo fallisce, cancella() lo segnala (non passa in silenzio)', async () => {
    const a = new ArchivioGiroIndexedDb();
    await a.salva(snap);
    fake.transazioniChePerdono = 2;
    await expect(a.cancella()).rejects.toThrow();
  });

  it('la chiusura della connessione azzera la cache: la prossima operazione riapre', async () => {
    const a = new ArchivioGiroIndexedDb();
    await a.salva(snap);
    fake.dbs[0].onclose?.();
    await a.salva(snap);
    expect(fake.aperture).toBe(2);
  });

  it('la connessione scartata dopo un errore viene chiusa (close), non lasciata aperta', async () => {
    const a = new ArchivioGiroIndexedDb();
    await a.salva(snap);
    fake.transazioniChePerdono = 1;
    await a.salva(snap);
    expect(fake.dbs).toHaveLength(2);
    expect(fake.dbs[0].chiusa).toBe(true);
    expect(fake.dbs[1].chiusa).toBe(false);
  });

  it('la onclose ritardata di una connessione vecchia non azzera quella nuova', async () => {
    const a = new ArchivioGiroIndexedDb();
    await a.salva(snap);
    fake.transazioniChePerdono = 1;
    await a.salva(snap); // la prima connessione e' scartata, ne e' aperta una seconda
    expect(fake.aperture).toBe(2);
    fake.dbs[0].onclose?.(); // arriva in ritardo l'evento della vecchia
    await a.salva(snap);
    expect(fake.aperture).toBe(2); // la seconda e' ancora in cache: nessuna terza apertura
  });

  it('una cancellazione fallita viene ricordata e ritentata alla prossima operazione', async () => {
    localStorage.clear();
    const a = new ArchivioGiroIndexedDb();
    await a.salva(snap);
    fake.transazioniChePerdono = 2;
    await expect(a.cancella()).rejects.toThrow();
    expect(fake.dato).toEqual(snap); // i dati sono ancora li'
    // Nuova operazione: prima ritenta la pulizia, quindi non rilegge i dati da cancellare.
    expect(await a.leggi()).toBeNull();
    expect(fake.dato).toBeUndefined();
    // Pulizia riuscita: il promemoria sparisce e una nuova scrittura resta.
    await a.salva(snap);
    expect(await a.leggi()).toEqual(snap);
  });

  it('senza indexedDB non lancia ma non e riuscito nulla (la cache non resta bloccata)', async () => {
    vi.stubGlobal('indexedDB', undefined);
    const a = new ArchivioGiroIndexedDb();
    await a.salva(snap);
    expect(await a.leggi()).toBeNull();
    vi.stubGlobal('indexedDB', fake);
    await a.salva(snap);
    expect(await a.leggi()).toEqual(snap);
  });
});
