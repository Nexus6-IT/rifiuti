import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ArchivioCoda } from './archivio-coda';
import { ArchivioCodaMemoria } from './archivio-coda.memoria';
import { CodaEventi } from './coda-eventi';
import { SessioneService } from './sessione.service';

const jwt = (sub: string) =>
  `h.${btoa(JSON.stringify({ sub })).replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_')}.s`;

const URL_EVENTI = '/api/v1/campo/eventi';
const eseguito = (ritiroId = 'r1') => ({
  ritiroId,
  tipo: 'RITIRO_ESEGUITO' as const,
  versioneVista: 1,
  dati: {},
});
const nonEseguito = (ritiroId = 'r1') => ({
  ritiroId,
  tipo: 'RITIRO_NON_ESEGUITO' as const,
  versioneVista: 1,
  dati: { motivo: 'Cliente assente' },
});
const ok = (id: string, esito = 'APPLICATO', motivoConflitto: string | null = null) => ({
  id,
  esito,
  motivoConflitto,
  ricevutoIl: '2026-12-01T09:00:00.000Z',
});

describe('CodaEventi (coda di uscita)', () => {
  let archivio: ArchivioCodaMemoria;
  let http: HttpTestingController;
  let coda: CodaEventi;
  let sessione: SessioneService;

  const accedi = (utente: string) =>
    sessione.salvaDaFragment(`#accessToken=${jwt(utente)}&refreshToken=r`);
  const flush = () => new Promise<void>((r) => setTimeout(r, 0));
  /** Risponde alla prossima POST e lascia girare la coda. */
  const rispondi = async (fn: (req: ReturnType<HttpTestingController['expectOne']>) => void) => {
    const req = http.expectOne(URL_EVENTI);
    fn(req);
    await flush();
  };
  const senzaRete = (req: { error: (e: ProgressEvent, o: { status: number }) => void }) =>
    req.error(new ProgressEvent('error'), { status: 0 });

  beforeEach(() => {
    localStorage.clear();
    archivio = new ArchivioCodaMemoria();
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: ArchivioCoda, useValue: archivio },
      ],
    });
    http = TestBed.inject(HttpTestingController);
    coda = TestBed.inject(CodaEventi);
    sessione = TestBed.inject(SessioneService);
  });

  afterEach(() => {
    coda.ferma();
    http.verify();
  });

  it('registra sul telefono PRIMA di inviare: l evento e in archivio con uuid, utente e ora', async () => {
    accedi('u1');
    const e = await coda.registra(nonEseguito());
    expect(e).toMatchObject({
      utenteId: 'u1',
      ritiroId: 'r1',
      tipo: 'RITIRO_NON_ESEGUITO',
      stato: 'DA_INVIARE',
      dati: { motivo: 'Cliente assente' },
    });
    expect(e.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(new Date(e.rilevatoIl).getTime()).toBeLessThanOrEqual(Date.now());
    expect((await archivio.tutti()).map((x) => x.id)).toEqual([e.id]);
    // Il corpo inviato non porta l utente: lo decide il server dal token.
    const req = http.expectOne(URL_EVENTI);
    expect(req.request.body).toEqual({
      id: e.id,
      ritiroId: 'r1',
      tipo: 'RITIRO_NON_ESEGUITO',
      versioneVista: 1,
      rilevatoIl: e.rilevatoIl,
      dati: { motivo: 'Cliente assente' },
    });
    req.flush(ok(e.id));
    await flush();
  });

  it('esito confermato: stato CONFERMATO con l esito del server, nessun reinvio', async () => {
    accedi('u1');
    const e = await coda.registra(eseguito());
    await rispondi((r) => r.flush(ok(e.id, 'DA_RICONCILIARE', 'RITIRO_ANNULLATO')));
    const [x] = coda.miei();
    expect(x).toMatchObject({
      stato: 'CONFERMATO',
      esito: 'DA_RICONCILIARE',
      motivoConflitto: 'RITIRO_ANNULLATO',
    });
    expect(coda.daInviare()).toBe(0);
    await coda.invia();
    http.expectNone(URL_EVENTI);
  });

  it('senza rete l evento resta in coda; al ritorno della rete parte con LO STESSO uuid', async () => {
    accedi('u1');
    const e = await coda.registra(eseguito());
    await rispondi(senzaRete);
    expect(coda.miei()[0]).toMatchObject({ stato: 'DA_INVIARE', tentativi: 1 });
    expect(coda.daInviare()).toBe(1);
    // La rete torna.
    window.dispatchEvent(new Event('online'));
    await coda.avvia();
    const req = http.expectOne(URL_EVENTI);
    expect(req.request.body.id).toBe(e.id);
    req.flush(ok(e.id));
    await flush();
    expect(coda.daInviare()).toBe(0);
  });

  it('risposta persa (il server ha scritto ma il telefono non lo sa): il reinvio e lo stesso uuid, nessun duplicato locale', async () => {
    accedi('u1');
    const e = await coda.registra(eseguito());
    await rispondi(senzaRete);
    void coda.invia();
    const req = http.expectOne(URL_EVENTI);
    expect(req.request.body.id).toBe(e.id);
    req.flush(ok(e.id)); // il server riconosce l uuid e risponde come la prima volta
    await flush();
    expect((await archivio.tutti()).length).toBe(1);
    expect(coda.miei()).toHaveLength(1);
  });

  it('piu eventi: il primo fallito resta davanti, si inviano sempre in ordine', async () => {
    accedi('u1');
    const a = await coda.registra(eseguito('r1'));
    await rispondi(senzaRete); // il primo fallisce: il secondo non deve nemmeno partire
    const b = await coda.registra(nonEseguito('r2'));
    await flush();
    let req = http.expectOne(URL_EVENTI);
    expect(req.request.body.id).toBe(a.id);
    req.flush(ok(a.id));
    await flush();
    req = http.expectOne(URL_EVENTI);
    expect(req.request.body.id).toBe(b.id);
    req.flush(ok(b.id));
    await flush();
    expect(coda.daInviare()).toBe(0);
  });

  it('invio in corso: una seconda chiamata non spedisce di nuovo lo stesso evento', async () => {
    accedi('u1');
    await coda.registra(eseguito());
    const p1 = coda.invia();
    const p2 = coda.invia();
    const reqs = http.match(URL_EVENTI);
    expect(reqs).toHaveLength(1);
    reqs[0].flush(ok(reqs[0].request.body.id));
    await Promise.all([p1, p2]);
  });

  it('un doppio tocco sullo stesso ritiro non crea due eventi', async () => {
    accedi('u1');
    const [a, b] = await Promise.all([coda.registra(eseguito()), coda.registra(eseguito())]);
    expect(b.id).toBe(a.id);
    expect((await archivio.tutti()).length).toBe(1);
    await rispondi((r) => r.flush(ok(a.id)));
  });

  it('rifiuto definitivo del server (400/404/409): RIFIUTATO con il messaggio, non si ritenta, gli altri proseguono', async () => {
    accedi('u1');
    const a = await coda.registra(eseguito('r1'));
    await rispondi((r) =>
      r.flush({ message: 'Ritiro non trovato.' }, { status: 404, statusText: 'x' }),
    );
    const b = await coda.registra(eseguito('r2'));
    await flush();
    expect(coda.miei().find((x) => x.id === a.id)).toMatchObject({
      stato: 'RIFIUTATO',
      errore: 'Ritiro non trovato.',
    });
    const req = http.expectOne(URL_EVENTI);
    expect(req.request.body.id).toBe(b.id);
    req.flush(ok(b.id));
    await flush();
    expect(coda.rifiutati()).toBe(1);
    await coda.invia();
    http.expectNone(URL_EVENTI);
  });

  it('errori transitori (429, 500, 503): resta DA_INVIARE', async () => {
    accedi('u1');
    await coda.registra(eseguito());
    for (const status of [429, 500, 503]) {
      await rispondi((r) => r.flush({}, { status, statusText: 'x' }));
      expect(coda.miei()[0].stato).toBe('DA_INVIARE');
      void coda.invia();
    }
    const req = http.expectOne(URL_EVENTI);
    req.flush(ok(req.request.body.id));
    await flush();
    expect(coda.daInviare()).toBe(0);
  });

  it('403 (es. autista non collegato): resta in coda con l errore, senza martellare il server', async () => {
    accedi('u1');
    await coda.registra(eseguito());
    await rispondi((r) =>
      r.flush({ message: 'Il tuo accesso non e collegato.' }, { status: 403, statusText: 'x' }),
    );
    expect(coda.miei()[0]).toMatchObject({
      stato: 'DA_INVIARE',
      errore: expect.stringContaining('collegato'),
    });
    expect(coda.daInviare()).toBe(1);
  });

  it('403 permanente: i tentativi automatici si fermano e lo dice; «Invia ora» riprova', async () => {
    accedi('u1');
    await coda.registra(eseguito());
    await rispondi((r) =>
      r.flush({ message: 'Autista non collegato.' }, { status: 403, statusText: 'x' }),
    );
    expect(coda.bloccata()).toContain('non collegato');
    window.dispatchEvent(new Event('online'));
    await coda.avvia().catch(() => undefined);
    http.match(URL_EVENTI).forEach((r) => r.flush({}, { status: 403, statusText: 'x' }));
    await flush();
    void coda.invia();
    const req = http.expectOne(URL_EVENTI);
    req.flush(ok(req.request.body.id));
    await flush();
    expect(coda.bloccata()).toBeNull();
    expect(coda.daInviare()).toBe(0);
  });

  it('sopravvive al riavvio: un nuovo servizio rilegge dall archivio e invia', async () => {
    accedi('u1');
    const e = await coda.registra(eseguito());
    await rispondi(senzaRete);
    coda.ferma();
    // Riavvio dell app: servizio nuovo, stesso archivio.
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: ArchivioCoda, useValue: archivio },
      ],
    });
    http = TestBed.inject(HttpTestingController);
    sessione = TestBed.inject(SessioneService);
    accedi('u1');
    coda = TestBed.inject(CodaEventi);
    await coda.avvia();
    const req = http.expectOne(URL_EVENTI);
    expect(req.request.body.id).toBe(e.id);
    req.flush(ok(e.id));
    await flush();
    expect(coda.daInviare()).toBe(0);
  });

  describe('telefono passato a un collega', () => {
    it('gli eventi di un altro utente non si inviano e non si mostrano; si possono scartare', async () => {
      accedi('u1');
      const e = await coda.registra(eseguito());
      await rispondi(senzaRete);
      sessione.pulisci(); // fine sessione (401, logout): gli eventi restano
      expect((await archivio.tutti()).map((x) => x.id)).toEqual([e.id]);
      accedi('u2');
      await coda.avvia();
      http.expectNone(URL_EVENTI);
      expect(coda.miei()).toEqual([]);
      expect(coda.daInviare()).toBe(0);
      expect(coda.diAltriUtenti()).toBe(1);
      await coda.scartaDiAltriUtenti();
      expect(coda.diAltriUtenti()).toBe(0);
      expect(await archivio.tutti()).toEqual([]);
    });

    it('quando il primo utente rientra, i suoi eventi partono', async () => {
      accedi('u1');
      const e = await coda.registra(eseguito());
      await rispondi(senzaRete);
      sessione.pulisci();
      accedi('u2');
      await coda.avvia();
      sessione.pulisci();
      accedi('u1');
      await coda.avvia();
      const req = http.expectOne(URL_EVENTI);
      expect(req.request.body.id).toBe(e.id);
      req.flush(ok(e.id));
      await flush();
      expect(coda.daInviare()).toBe(0);
    });

    it('a fine sessione i soli CONFERMATI spariscono (contengono note), i DA_INVIARE restano', async () => {
      accedi('u1');
      const a = await coda.registra(eseguito('r1'));
      await rispondi((r) => r.flush(ok(a.id)));
      const b = await coda.registra(eseguito('r2'));
      await rispondi(senzaRete);
      sessione.pulisci();
      await flush();
      expect((await archivio.tutti()).map((x) => x.id)).toEqual([b.id]);
    });
  });

  it('senza sessione non si registra nulla', async () => {
    await expect(coda.registra(eseguito())).rejects.toThrow();
    expect(await archivio.tutti()).toEqual([]);
  });

  it('archivio non scrivibile: l evento resta in memoria e viene segnalato', async () => {
    accedi('u1');
    vi.spyOn(archivio, 'salva').mockRejectedValue(new Error('IndexedDB non disponibile'));
    const e = await coda.registra(eseguito());
    expect(coda.nonSalvato()).toBe(true);
    expect(coda.miei().map((x) => x.id)).toEqual([e.id]);
    await rispondi((r) => r.flush(ok(e.id)));
  });

  it('all avvio i promemoria CONFERMATI di un giorno passato vengono tolti, il resto resta', async () => {
    accedi('u1');
    const base = {
      utenteId: 'u1',
      ritiroId: 'r9',
      tipo: 'RITIRO_ESEGUITO' as const,
      versioneVista: 1,
      dati: {},
      tentativi: 0,
      errore: null,
      esito: 'APPLICATO' as const,
      motivoConflitto: null,
    };
    await archivio.salva({
      ...base,
      id: 'vecchio',
      rilevatoIl: '2020-01-01T10:00:00.000Z',
      stato: 'CONFERMATO',
    });
    await archivio.salva({
      ...base,
      id: 'pendente',
      rilevatoIl: '2020-01-01T10:00:00.000Z',
      stato: 'DA_INVIARE',
      esito: null,
    });
    await archivio.salva({
      ...base,
      id: 'oggi',
      rilevatoIl: new Date().toISOString(),
      stato: 'CONFERMATO',
    });
    await coda.avvia();
    const req = http.expectOne(URL_EVENTI);
    expect(req.request.body.id).toBe('pendente');
    req.flush(ok('pendente'));
    await flush();
    expect((await archivio.tutti()).map((e) => e.id).sort()).toEqual(['oggi', 'pendente']);
  });

  it('perRitiro dice se un esito e gia stato dato (anche rifiutato non conta)', async () => {
    accedi('u1');
    expect(coda.perRitiro('r1')).toBeNull();
    const e = await coda.registra(eseguito());
    expect(coda.perRitiro('r1')?.id).toBe(e.id);
    await rispondi((r) => r.flush({ message: 'no' }, { status: 409, statusText: 'x' }));
    expect(coda.perRitiro('r1')).toBeNull();
  });
});
