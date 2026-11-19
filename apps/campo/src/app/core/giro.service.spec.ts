import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { GiroService, dataLocaleIso } from './giro.service';
import type { GiroVista, RitiroVista } from './modelli';

const ritiro = (id: string): RitiroVista =>
  ({
    id,
    dataPrevista: '2026-11-19',
    fascia: 'MATTINA',
    ordineGiro: 1,
    produttore: { id: 'p', nome: 'Rossi Srl', sedeId: 's', indirizzo: 'Via Roma 1, Bari' },
    destinatario: { id: 'd', nome: 'Impianto', sedeId: 'sd' },
    trasportatore: { id: 't', nome: 'Trasp' },
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
    serieId: null,
    versione: 1,
  }) as RitiroVista;

const giro: GiroVista = {
  data: '2026-11-19',
  autista: { id: 'a', nome: 'Mario', cognome: 'Bianchi' },
  ritiri: [ritiro('r1'), ritiro('r2')],
};

describe('GiroService', () => {
  let servizio: GiroService;
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    servizio = TestBed.inject(GiroService);
    http = TestBed.inject(HttpTestingController);
  });
  afterEach(() => http.verify());

  it('carica il giro del giorno e lo tiene in memoria', () => {
    servizio.carica('2026-11-19').subscribe();
    const req = http.expectOne((r) => r.url === '/api/v1/campo/giro');
    expect(req.request.params.get('data')).toBe('2026-11-19');
    req.flush(giro);
    expect(servizio.corrente()).toEqual(giro);
    expect(servizio.ritiro('r2')?.id).toBe('r2');
    expect(servizio.ritiro('xx')).toBeUndefined();
  });

  it('un errore non sostituisce il giro già in memoria', () => {
    servizio.carica('2026-11-19').subscribe();
    http.expectOne((r) => r.url === '/api/v1/campo/giro').flush(giro);
    servizio.carica('2026-11-20').subscribe({ error: () => undefined });
    http
      .expectOne((r) => r.url === '/api/v1/campo/giro')
      .flush({ message: 'no' }, { status: 500, statusText: 'KO' });
    expect(servizio.corrente()?.data).toBe('2026-11-19');
  });

  it('svuota la memoria', () => {
    servizio.carica('2026-11-19').subscribe();
    http.expectOne((r) => r.url === '/api/v1/campo/giro').flush(giro);
    servizio.svuota();
    expect(servizio.corrente()).toBeNull();
  });

  it('dataLocaleIso usa la data locale, non UTC', () => {
    expect(dataLocaleIso(new Date(2026, 0, 5, 0, 30))).toBe('2026-01-05');
    expect(dataLocaleIso(new Date(2026, 10, 19, 23, 59))).toBe('2026-11-19');
  });
});
