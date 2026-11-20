import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ArchivioGiro } from './archivio-giro';
import { ArchivioGiroMemoria } from './archivio-giro.memoria';
import { GiroService } from './giro.service';
import { SessioneService } from './sessione.service';
import type { GiroVista } from './modelli';

const jwt = (sub: string) =>
  `h.${btoa(JSON.stringify({ sub })).replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_')}.s`;

const giro = (data: string): GiroVista => ({
  data,
  autista: { id: 'a1', nome: 'Mario', cognome: 'Bianchi' },
  ritiri: [
    {
      id: 'r1',
      dataPrevista: data,
      fascia: 'MATTINA',
      ordineGiro: 1,
      produttore: { id: 'p', nome: 'Rossi Srl', sedeId: 's', indirizzo: 'Via Roma 1' },
      trasportatore: { id: 't', nome: 'Trasp' },
      destinatario: { id: 'd', nome: 'Impianto', sedeId: 'sd' },
      automezzo: null,
      autista: null,
      cerCode: '150102',
      descrizione: 'Imballaggi',
      quantitaPresunta: '120',
      unita: 'kg',
      stato: 'PROGRAMMATO',
      statoVisibile: 'DA_GENERARE',
      motivo: null,
      fir: null,
    },
  ],
});

describe('GiroService offline', () => {
  let archivio: ArchivioGiroMemoria;
  let http: HttpTestingController;
  let giroSvc: GiroService;

  const accedi = (utente: string) => {
    TestBed.inject(SessioneService).salvaDaFragment(`#accessToken=${jwt(utente)}&refreshToken=r`);
  };
  const caricaSenzaRete = async (data: string, stato = 0) => {
    const esito = new Promise<'ok' | 'errore'>((res) =>
      giroSvc.carica(data).subscribe({ next: () => res('ok'), error: () => res('errore') }),
    );
    await Promise.resolve();
    http
      .expectOne((r) => r.url === '/api/v1/campo/giro')
      .error(new ProgressEvent('error'), { status: stato });
    return esito;
  };

  beforeEach(() => {
    localStorage.clear();
    archivio = new ArchivioGiroMemoria();
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: ArchivioGiro, useValue: archivio },
      ],
    });
    http = TestBed.inject(HttpTestingController);
    giroSvc = TestBed.inject(GiroService);
  });

  it('dopo un caricamento riuscito salva lo snapshot per utente e data, con ora aggiornamento', async () => {
    accedi('u1');
    giroSvc.carica('2026-11-20').subscribe();
    http.expectOne((r) => r.url === '/api/v1/campo/giro').flush(giro('2026-11-20'));
    await vi.waitFor(() => expect(archivio.corrente).not.toBeNull());
    expect(archivio.corrente?.utenteId).toBe('u1');
    expect(archivio.corrente?.data).toBe('2026-11-20');
    expect(archivio.corrente?.giro.ritiri).toHaveLength(1);
    expect(giroSvc.daArchivio()).toBe(false);
    expect(giroSvc.aggiornatoIl()).toBe(archivio.corrente?.aggiornatoIl);
  });

  it('senza rete mostra lo snapshot dello stesso utente e dello stesso giorno', async () => {
    accedi('u1');
    await archivio.salva({
      utenteId: 'u1',
      data: '2026-11-20',
      aggiornatoIl: '2026-11-20T07:30:00.000Z',
      giro: giro('2026-11-20'),
    });
    expect(await caricaSenzaRete('2026-11-20')).toBe('ok');
    expect(giroSvc.corrente()?.ritiri[0].id).toBe('r1');
    expect(giroSvc.daArchivio()).toBe(true);
    expect(giroSvc.aggiornatoIl()).toBe('2026-11-20T07:30:00.000Z');
  });

  it('con il service worker la rete assente arriva come 504: ripiega comunque sullo snapshot', async () => {
    accedi('u1');
    await archivio.salva({
      utenteId: 'u1',
      data: '2026-11-20',
      aggiornatoIl: '2026-11-20T07:30:00.000Z',
      giro: giro('2026-11-20'),
    });
    expect(await caricaSenzaRete('2026-11-20', 504)).toBe('ok');
    expect(giroSvc.daArchivio()).toBe(true);
  });

  it('senza rete NON mostra il giro di un altro autista e lo cancella dal telefono', async () => {
    accedi('u2');
    await archivio.salva({
      utenteId: 'u1',
      data: '2026-11-20',
      aggiornatoIl: '2026-11-20T07:30:00.000Z',
      giro: giro('2026-11-20'),
    });
    expect(await caricaSenzaRete('2026-11-20')).toBe('errore');
    expect(giroSvc.corrente()).toBeNull();
    expect(archivio.corrente).toBeNull();
  });

  it('senza rete NON mostra il giro di un altro giorno (fine giornata) e lo cancella', async () => {
    accedi('u1');
    await archivio.salva({
      utenteId: 'u1',
      data: '2026-11-19',
      aggiornatoIl: '2026-11-19T07:30:00.000Z',
      giro: giro('2026-11-19'),
    });
    expect(await caricaSenzaRete('2026-11-20')).toBe('errore');
    expect(giroSvc.corrente()).toBeNull();
    expect(archivio.corrente).toBeNull();
  });

  it('un errore diverso dalla rete (403) non ripiega sullo snapshot', async () => {
    accedi('u1');
    await archivio.salva({
      utenteId: 'u1',
      data: '2026-11-20',
      aggiornatoIl: 'x',
      giro: giro('2026-11-20'),
    });
    let errore = false;
    giroSvc.carica('2026-11-20').subscribe({ error: () => (errore = true) });
    http
      .expectOne((r) => r.url === '/api/v1/campo/giro')
      .flush({ message: 'no' }, { status: 403, statusText: 'Forbidden' });
    expect(errore).toBe(true);
    expect(giroSvc.corrente()).toBeNull();
  });

  it('senza identita utente nel token non salva nulla', async () => {
    TestBed.inject(SessioneService).salvaDaFragment('#accessToken=aaa&refreshToken=r');
    giroSvc.carica('2026-11-20').subscribe();
    http.expectOne((r) => r.url === '/api/v1/campo/giro').flush(giro('2026-11-20'));
    await Promise.resolve();
    expect(archivio.corrente).toBeNull();
  });

  it('svuota() cancella memoria e archivio (logout)', async () => {
    accedi('u1');
    await archivio.salva({ utenteId: 'u1', data: 'd', aggiornatoIl: 'x', giro: giro('d') });
    giroSvc.svuota();
    await vi.waitFor(() => expect(archivio.corrente).toBeNull());
    expect(giroSvc.corrente()).toBeNull();
  });

  it('pulisciObsoleto cancella lo snapshot di ieri o di un altro utente, tiene quello valido', async () => {
    accedi('u1');
    await archivio.salva({
      utenteId: 'u1',
      data: '2026-11-19',
      aggiornatoIl: 'x',
      giro: giro('a'),
    });
    await giroSvc.pulisciObsoleto('2026-11-20');
    expect(archivio.corrente).toBeNull();

    await archivio.salva({
      utenteId: 'u9',
      data: '2026-11-20',
      aggiornatoIl: 'x',
      giro: giro('a'),
    });
    await giroSvc.pulisciObsoleto('2026-11-20');
    expect(archivio.corrente).toBeNull();

    await archivio.salva({
      utenteId: 'u1',
      data: '2026-11-20',
      aggiornatoIl: 'x',
      giro: giro('a'),
    });
    await giroSvc.pulisciObsoleto('2026-11-20');
    expect(archivio.corrente).not.toBeNull();
  });

  it('un nuovo accesso (cambio utente) e la fine della sessione cancellano lo snapshot', async () => {
    accedi('u1');
    await archivio.salva({ utenteId: 'u1', data: 'd', aggiornatoIl: 'x', giro: giro('d') });
    accedi('u2');
    await vi.waitFor(() => expect(archivio.corrente).toBeNull());

    await archivio.salva({ utenteId: 'u2', data: 'd', aggiornatoIl: 'x', giro: giro('d') });
    TestBed.inject(SessioneService).pulisci();
    await vi.waitFor(() => expect(archivio.corrente).toBeNull());
  });

  it('snapshot: salva solo i campi noti, scarta quelli estranei (anche annidati)', async () => {
    accedi('u1');
    const g = giro('2026-11-20') as unknown as Record<string, unknown>;
    g['telefonoReferente'] = '333';
    const r = (g['ritiri'] as Record<string, unknown>[])[0];
    r['serieId'] = 's';
    (r['produttore'] as Record<string, unknown>)['codiceFiscale'] = 'CF';
    giroSvc.carica('2026-11-20').subscribe();
    http.expectOne((x) => x.url === '/api/v1/campo/giro').flush(g);
    await vi.waitFor(() => expect(archivio.corrente).not.toBeNull());
    const testo = JSON.stringify(archivio.corrente);
    expect(testo).not.toContain('telefonoReferente');
    expect(testo).not.toContain('serieId');
    expect(testo).not.toContain('codiceFiscale');
    expect(testo).toContain('Rossi Srl');
  });

  it('fine sessione (401): la memoria del giro viene azzerata', () => {
    accedi('u1');
    giroSvc.impostaFresco(giro('2026-11-20'), 'x');
    TestBed.inject(SessioneService).pulisci();
    expect(giroSvc.corrente()).toBeNull();
    expect(giroSvc.aggiornatoIl()).toBeNull();
  });

  it('cambio giorno alla ripresa: svuota memoria e snapshot e chiede il ricaricamento', async () => {
    accedi('u1');
    giroSvc.impostaFresco(giro('2026-11-19'), 'x');
    await archivio.salva({
      utenteId: 'u1',
      data: '2026-11-19',
      aggiornatoIl: 'x',
      giro: giro('2026-11-19'),
    });
    const prima = giroSvc.generazione();
    expect(await giroSvc.controllaGiorno('2026-11-20')).toBe(true);
    expect(giroSvc.corrente()).toBeNull();
    expect(archivio.corrente).toBeNull();
    expect(giroSvc.generazione()).toBe(prima + 1);
    // stesso giorno: non tocca nulla
    giroSvc.impostaFresco(giro('2026-11-20'), 'x');
    expect(await giroSvc.controllaGiorno('2026-11-20')).toBe(false);
    expect(giroSvc.corrente()).not.toBeNull();
  });

  it('senza rete e senza copia ma con il giro gia in memoria: resta visibile come salvato', async () => {
    accedi('u1');
    giroSvc.impostaFresco(giro('2026-11-20'), 'x');
    expect(await caricaSenzaRete('2026-11-20')).toBe('ok');
    expect(giroSvc.daArchivio()).toBe(true);
    expect(giroSvc.corrente()).not.toBeNull();
  });
});
