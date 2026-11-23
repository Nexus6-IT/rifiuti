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
  dataVista: '2026-12-01',
  sedeVista: '33333333-3333-4333-8333-333333333333',
  dati: {},
});
const nonEseguito = (ritiroId = 'r1') => ({
  ritiroId,
  tipo: 'RITIRO_NON_ESEGUITO' as const,
  versioneVista: 1,
  dataVista: '2026-12-01',
  sedeVista: '33333333-3333-4333-8333-333333333333',
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
      dataVista: '2026-12-01',
      sedeVista: '33333333-3333-4333-8333-333333333333',
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

  it('due esiti nello stesso millisecondo: partono nell ordine di registrazione, qualunque sia lo uuid', async () => {
    accedi('u1');
    // Orologio del telefono fermo: tutti gli esiti hanno lo stesso rilevatoIl.
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-12-01T09:00:00.000Z'));
    // Gli uuid sono in ordine INVERSO rispetto alla registrazione: uno spareggio per id sbaglierebbe.
    vi.spyOn(crypto, 'randomUUID')
      .mockReturnValueOnce('ffffffff-0000-4000-8000-000000000001')
      .mockReturnValueOnce('eeeeeeee-0000-4000-8000-000000000002')
      .mockReturnValueOnce('dddddddd-0000-4000-8000-000000000003');
    const ids: string[] = [];
    try {
      for (const r of ['r1', 'r2', 'r3']) ids.push((await coda.registra(eseguito(r))).id);
    } finally {
      vi.useRealTimers();
    }
    expect(coda.miei().map((e) => e.id)).toEqual(ids);
    // Il primo parte subito alla registrazione; gli altri uno alla volta, in ordine.
    for (const atteso of ids) {
      const req = http.expectOne(URL_EVENTI);
      expect(req.request.body.id).toBe(atteso);
      req.flush(ok(atteso));
      await flush();
    }
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
    // Rete, ripresa, intervallo e nuova registrazione NON ritentano: nessuna richiesta.
    window.dispatchEvent(new Event('online'));
    document.dispatchEvent(new Event('visibilitychange'));
    await coda.registra(eseguito('r2'));
    await flush();
    http.expectNone(URL_EVENTI);
    expect(coda.daInviare()).toBe(2);
    expect(coda.bloccata()).toContain('non collegato');
    // «Invia ora» riprova una volta sola e, se il 403 resta, si ferma di nuovo.
    void coda.invia();
    http.expectOne(URL_EVENTI).flush({ message: 'Ancora no.' }, { status: 403, statusText: 'x' });
    await flush();
    http.expectNone(URL_EVENTI);
    expect(coda.bloccata()).toContain('Ancora no');
    void coda.invia();
    for (let i = 0; i < 2; i++) {
      const req = http.expectOne(URL_EVENTI);
      req.flush(ok(req.request.body.id));
      await flush();
    }
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
      dataVista: '2026-12-01',
      sedeVista: 's',
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
  describe('posizione e foto (P5)', () => {
    const fotoPronta = (n = 1) => ({
      mimeType: 'image/jpeg' as const,
      dimensioneByte: 4,
      sha256: String(n).repeat(64),
      contenuto: new Uint8Array([0xff, 0xd8, 0xff, n]).buffer as ArrayBuffer,
    });
    const urlFoto = (id: string) => `${URL_EVENTI}/${id}/foto`;
    const conFoto = (n: number) => ({
      ...eseguito(),
      foto: Array.from({ length: n }, (_, i) => fotoPronta(i + 1)),
    });

    it('la posizione viaggia nei dati dell evento; senza foto ne posizione il corpo e quello di prima', async () => {
      accedi('u1');
      const pos = { lat: 45.1, lon: 9.2, accuratezza: 8 };
      const e = await coda.registra({ ...eseguito(), dati: { posizione: pos } });
      const req = http.expectOne(URL_EVENTI);
      expect(req.request.body.dati).toEqual({ posizione: pos });
      expect(Object.keys(req.request.body).sort()).toEqual(
        [
          'dataVista',
          'dati',
          'id',
          'ritiroId',
          'rilevatoIl',
          'sedeVista',
          'tipo',
          'versioneVista',
        ].sort(),
      );
      req.flush(ok(e.id));
      await flush();
    });

    it('le foto partono DOPO l evento confermato, una alla volta, in multipart con uuid e impronta', async () => {
      accedi('u1');
      const e = await coda.registra(conFoto(2));
      const [f1, f2] = e.foto!;
      // Prima l evento, nessuna foto.
      http.expectNone(urlFoto(e.id));
      http.expectOne(URL_EVENTI).flush(ok(e.id));
      await flush();
      const r1 = http.expectOne(urlFoto(e.id));
      const corpo = r1.request.body as FormData;
      expect(corpo.get('id')).toBe(f1.id);
      expect(corpo.get('sha256')).toBe('1'.repeat(64));
      expect((corpo.get('foto') as Blob).size).toBe(4);
      http.expectNone(urlFoto(e.id)); // la seconda aspetta la prima
      r1.flush({ id: f1.id });
      await flush();
      const r2 = http.expectOne(urlFoto(e.id));
      expect((r2.request.body as FormData).get('id')).toBe(f2.id);
      r2.flush({ id: f2.id });
      await flush();
      const [x] = coda.miei();
      expect(x.foto?.map((f) => f.stato)).toEqual(['INVIATA', 'INVIATA']);
      expect(x.foto?.every((f) => f.contenuto === null)).toBe(true); // byte liberati
      expect(coda.fotoDaInviare()).toBe(0);
    });

    it('senza rete la foto resta in coda con i suoi byte e riparte con LO STESSO uuid', async () => {
      accedi('u1');
      const e = await coda.registra(conFoto(1));
      http.expectOne(URL_EVENTI).flush(ok(e.id));
      await flush();
      senzaRete(http.expectOne(urlFoto(e.id)));
      await flush();
      expect(coda.fotoDaInviare()).toBe(1);
      expect((await archivio.tutti())[0].foto?.[0]).toMatchObject({
        stato: 'DA_INVIARE',
        tentativi: 1,
      });
      expect((await archivio.tutti())[0].foto?.[0].contenuto).not.toBeNull();
      void coda.invia();
      const r = http.expectOne(urlFoto(e.id));
      expect((r.request.body as FormData).get('id')).toBe(e.foto![0].id);
      r.flush({});
      await flush();
      expect(coda.fotoDaInviare()).toBe(0);
    });

    it.each([
      [413, 'FOTO_TROPPO_GRANDE', 'La foto supera 1 MB.'],
      [415, 'FOTO_TIPO_NON_AMMESSO', 'Solo JPEG o PNG.'],
      [422, 'FOTO_LIMITE_EVENTO', 'Massimo 3 foto.'],
      [409, 'FOTO_GIA_USATA', 'Id gia usato.'],
    ])(
      'rifiuto definitivo %i: la foto e RIFIUTATA col messaggio, le altre proseguono',
      async (status, codice, msg) => {
        accedi('u1');
        const e = await coda.registra(conFoto(2));
        http.expectOne(URL_EVENTI).flush(ok(e.id));
        await flush();
        http
          .expectOne(urlFoto(e.id))
          .flush({ message: msg, error: codice }, { status, statusText: 'x' });
        await flush();
        http.expectOne(urlFoto(e.id)).flush({});
        await flush();
        const [x] = coda.miei();
        expect(x.foto?.map((f) => f.stato)).toEqual(['RIFIUTATA', 'INVIATA']);
        expect(x.foto?.[0]).toMatchObject({ errore: msg, contenuto: null });
        expect(coda.fotoRifiutate()).toBe(1);
        expect(coda.fotoDaInviare()).toBe(0);
      },
    );

    it('impronta non corrispondente: si ritenta (puo essere la rete), alla terza si arrende', async () => {
      accedi('u1');
      const e = await coda.registra(conFoto(1));
      http.expectOne(URL_EVENTI).flush(ok(e.id));
      await flush();
      const hash = { message: 'danneggiato', error: 'FOTO_HASH_NON_CORRISPONDENTE' };
      for (let i = 0; i < 3; i++) {
        http.expectOne(urlFoto(e.id)).flush(hash, { status: 422, statusText: 'x' });
        await flush();
        if (i < 2) {
          expect(coda.miei()[0].foto?.[0].stato).toBe('DA_INVIARE');
          void coda.invia();
        }
      }
      expect(coda.miei()[0].foto?.[0]).toMatchObject({
        stato: 'RIFIUTATA',
        tentativi: 3,
        contenuto: null,
      });
    });

    it('un 403 sulle foto ferma i tentativi automatici', async () => {
      accedi('u1');
      const e = await coda.registra(conFoto(1));
      http.expectOne(URL_EVENTI).flush(ok(e.id));
      await flush();
      http
        .expectOne(urlFoto(e.id))
        .flush({ message: 'Modulo non attivo.' }, { status: 403, statusText: 'x' });
      await flush();
      expect(coda.bloccata()).toContain('Modulo non attivo');
      window.dispatchEvent(new Event('online'));
      await flush();
      http.expectNone(urlFoto(e.id));
    });

    it('evento con foto in attesa: sopravvive a fine sessione e al giorno dopo, finche la foto non parte', async () => {
      accedi('u1');
      const e = await coda.registra(conFoto(1));
      http.expectOne(URL_EVENTI).flush(ok(e.id));
      await flush();
      senzaRete(http.expectOne(urlFoto(e.id)));
      await flush();
      sessione.pulisci(); // logout
      await flush();
      expect((await archivio.tutti()).map((x) => x.id)).toEqual([e.id]);
      // La giornata dopo, rientra lo stesso utente: la foto parte.
      const salvato = (await archivio.tutti())[0];
      await archivio.salva({ ...salvato, rilevatoIl: '2020-01-01T10:00:00.000Z' });
      accedi('u1');
      await coda.avvia();
      const r = http.expectOne(urlFoto(e.id));
      r.flush({});
      await flush();
      expect(coda.fotoDaInviare()).toBe(0);
    });

    it('un evento salvato dalla versione precedente (senza foto) funziona e non ha foto', async () => {
      accedi('u1');
      await archivio.salva({
        ...(await coda.registra(eseguito('r9'))),
        id: 'vecchio',
        foto: undefined,
      });
      http.expectOne(URL_EVENTI).flush(ok('x'));
      await flush();
      await coda.avvia();
      http.expectOne(URL_EVENTI).flush(ok('vecchio'));
      await flush();
      expect(coda.fotoDaInviare()).toBe(0);
    });

    it('le foto di un altro utente non partono col token di chi e entrato e contano come suoi esiti pendenti', async () => {
      accedi('u1');
      const e = await coda.registra(conFoto(1));
      http.expectOne(URL_EVENTI).flush(ok(e.id));
      await flush();
      senzaRete(http.expectOne(urlFoto(e.id)));
      await flush();
      sessione.pulisci();
      accedi('u2');
      await coda.avvia();
      http.expectNone(urlFoto(e.id));
      expect(coda.diAltriUtenti()).toBe(1);
      expect(coda.fotoDaInviare()).toBe(0);
    });
  });
});
