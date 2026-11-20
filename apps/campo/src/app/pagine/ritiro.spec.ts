import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideRouter } from '@angular/router';
import { ArchivioCoda } from '../core/archivio-coda';
import { ArchivioCodaMemoria } from '../core/archivio-coda.memoria';
import { ArchivioGiro } from '../core/archivio-giro';
import { ArchivioGiroMemoria } from '../core/archivio-giro.memoria';
import { CodaEventi } from '../core/coda-eventi';
import { ElaboratoreFoto, type FotoPronta } from '../core/foto';
import { PosizioneNonDisponibile, RilevatorePosizione } from '../core/posizione';
import { GiroService } from '../core/giro.service';
import type { GiroVista } from '../core/modelli';
import { SessioneService } from '../core/sessione.service';
import { RitiroPagina } from './ritiro';

const jwt = (sub: string) =>
  `h.${btoa(JSON.stringify({ sub })).replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_')}.s`;

const giro: GiroVista = {
  data: '2026-12-01',
  autista: { id: 'a1', nome: 'Mario', cognome: 'Bianchi' },
  ritiri: [
    {
      id: 'r1',
      dataPrevista: '2026-12-01',
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
      versione: 1,
    },
  ],
};

const fotoFinta = (n: number): FotoPronta => ({
  mimeType: 'image/jpeg',
  dimensioneByte: 2048,
  sha256: String(n).repeat(64),
  contenuto: new Uint8Array([0xff, 0xd8, 0xff, n]).buffer as ArrayBuffer,
});

describe('RitiroPagina: esito', () => {
  let prossimaFoto = 1;
  let fallisciFoto: string | null = null;
  let posizioneDi: 'ok' | 'negata' = 'ok';
  let letturePosizione = 0;
  let http: HttpTestingController;
  let archivio: ArchivioCodaMemoria;
  const flush = () => new Promise<void>((r) => setTimeout(r, 0));

  const apri = async (cambia?: (g: GiroVista) => void) => {
    const g = structuredClone(giro);
    cambia?.(g);
    TestBed.inject(GiroService).impostaFresco(g, '2026-12-01T07:00:00.000Z');
    const f = TestBed.createComponent(RitiroPagina);
    f.componentRef.setInput('id', 'r1');
    f.detectChanges();
    await f.whenStable();
    return f;
  };
  const el = (f: { nativeElement: unknown }) => f.nativeElement as HTMLElement;
  const clic = async (f: Awaited<ReturnType<typeof apri>>, testid: string) => {
    (el(f).querySelector(`[data-testid="${testid}"]`) as HTMLElement).click();
    f.detectChanges();
    await f.whenStable();
    await flush();
    f.detectChanges();
  };
  const scrivi = (f: Awaited<ReturnType<typeof apri>>, testo: string) => {
    const t = el(f).querySelector('[data-testid="testo-esito"]') as HTMLTextAreaElement;
    t.value = testo;
    t.dispatchEvent(new Event('input'));
    f.detectChanges();
  };

  beforeEach(() => {
    prossimaFoto = 1;
    fallisciFoto = null;
    posizioneDi = 'ok';
    letturePosizione = 0;
    localStorage.clear();
    archivio = new ArchivioCodaMemoria();
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: ArchivioCoda, useValue: archivio },
        { provide: ArchivioGiro, useValue: new ArchivioGiroMemoria() },
        {
          provide: ElaboratoreFoto,
          useValue: {
            prepara: async () => {
              if (fallisciFoto) throw new Error(fallisciFoto);
              return fotoFinta(prossimaFoto++);
            },
          },
        },
        {
          provide: RilevatorePosizione,
          useValue: {
            rileva: async () => {
              letturePosizione++;
              if (posizioneDi === 'negata') {
                throw new PosizioneNonDisponibile(
                  'Permesso di posizione negato: puoi inviare l’esito senza.',
                );
              }
              return { lat: 45.1, lon: 9.2, accuratezza: 8 };
            },
          },
        },
      ],
    });
    http = TestBed.inject(HttpTestingController);
    TestBed.inject(SessioneService).salvaDaFragment(`#accessToken=${jwt('u1')}&refreshToken=r`);
  });

  afterEach(() => {
    TestBed.inject(CodaEventi).ferma();
  });

  it('«Ritiro eseguito» con nota facoltativa: va in coda e parte l invio', async () => {
    const f = await apri();
    await clic(f, 'eseguito');
    scrivi(f, ' tutto ritirato ');
    await clic(f, 'conferma-esito');
    const req = http.expectOne('/api/v1/campo/eventi');
    expect(req.request.body).toMatchObject({
      ritiroId: 'r1',
      tipo: 'RITIRO_ESEGUITO',
      versioneVista: 1,
      dataVista: '2026-12-01',
      sedeVista: 's',
      dati: { nota: 'tutto ritirato' },
    });
    expect(el(f).querySelector('[data-testid="esito-stato"]')?.textContent).toContain(
      'in attesa di invio',
    );
    req.flush({ id: req.request.body.id, esito: 'APPLICATO', motivoConflitto: null });
    await flush();
    f.detectChanges();
    expect(el(f).querySelector('[data-testid="esito-stato"]')?.textContent).toContain(
      "inviato all'ufficio",
    );
    // Esito dato: i pulsanti non ci sono piu, niente doppio invio.
    expect(el(f).querySelector('[data-testid="eseguito"]')).toBeNull();
  });

  it('«Non eseguito» senza motivo: errore, nulla in coda', async () => {
    const f = await apri();
    await clic(f, 'non-eseguito');
    await clic(f, 'conferma-esito');
    expect(el(f).querySelector('[data-testid="esito-errore-form"]')?.textContent).toContain(
      'motivo',
    );
    http.expectNone('/api/v1/campo/eventi');
    expect(await archivio.tutti()).toEqual([]);
  });

  it('«Non eseguito» col motivo: invia il motivo e la versione vista', async () => {
    const f = await apri((g) => (g.ritiri[0] = { ...g.ritiri[0], ...{ id: 'r1' } }));
    await clic(f, 'non-eseguito');
    scrivi(f, 'Cliente assente');
    await clic(f, 'conferma-esito');
    const req = http.expectOne('/api/v1/campo/eventi');
    expect(req.request.body).toMatchObject({
      tipo: 'RITIRO_NON_ESEGUITO',
      dati: { motivo: 'Cliente assente' },
    });
    req.flush({
      id: req.request.body.id,
      esito: 'DA_RICONCILIARE',
      motivoConflitto: 'RITIRO_ANNULLATO',
    });
    await flush();
    f.detectChanges();
    const testo = el(f).querySelector('[data-testid="esito-stato"]')?.textContent ?? '';
    expect(testo).toContain("L'ufficio deve verificarlo");
    expect(testo).toContain('annullato in ufficio');
  });

  it('senza rete l esito resta «in attesa di invio» e l evento e salvato sul telefono', async () => {
    const f = await apri();
    await clic(f, 'eseguito');
    await clic(f, 'conferma-esito');
    http.expectOne('/api/v1/campo/eventi').error(new ProgressEvent('error'), { status: 0 });
    await flush();
    f.detectChanges();
    expect(el(f).querySelector('[data-testid="esito-stato"]')?.textContent).toContain(
      'in attesa di invio',
    );
    expect((await archivio.tutti()).map((e) => e.stato)).toEqual(['DA_INVIARE']);
    expect(el(f).querySelector('[data-testid="da-inviare"]')?.textContent).toContain(
      '1 esito da inviare',
    );
  });

  it('ritiro non piu programmato: nessun pulsante di esito', async () => {
    const f = await apri((g) => (g.ritiri[0].stato = 'NON_ESEGUITO'));
    expect(el(f).querySelector('[data-testid="eseguito"]')).toBeNull();
    expect(el(f).querySelector('[data-testid="esito"]')?.textContent).toContain(
      'non è più da fare',
    );
  });

  it('esito rifiutato dal server: il motivo e visibile e si puo scartare per riprovare', async () => {
    const f = await apri();
    await clic(f, 'eseguito');
    await clic(f, 'conferma-esito');
    http
      .expectOne('/api/v1/campo/eventi')
      .flush({ message: 'Ritiro non trovato.' }, { status: 404, statusText: 'x' });
    await flush();
    f.detectChanges();
    expect(el(f).querySelector('[data-testid="esito-rifiutato"]')?.textContent).toContain(
      'Ritiro non trovato.',
    );
    (el(f).querySelector('[data-testid="esito-rifiutato"] button') as HTMLElement).click();
    await flush();
    f.detectChanges();
    expect(el(f).querySelector('[data-testid="eseguito"]')).not.toBeNull();
  });
  describe('foto e posizione (P5)', () => {
    const aggiungiFoto = async (f: Awaited<ReturnType<typeof apri>>) => {
      const input = el(f).querySelector('[data-testid="file-foto"]') as HTMLInputElement;
      Object.defineProperty(input, 'files', {
        value: [new File(['x'], 'f.jpg', { type: 'image/jpeg' })],
        configurable: true,
      });
      input.dispatchEvent(new Event('change'));
      await f.whenStable();
      await flush();
      f.detectChanges();
    };

    it('l informativa e i pulsanti si vedono nel modulo dell esito, e niente parte da solo', async () => {
      const f = await apri();
      await clic(f, 'eseguito');
      expect(el(f).querySelector('[data-testid="informativa"]')?.textContent).toContain(
        "l'app non ti segue durante il giro",
      );
      expect(letturePosizione).toBe(0); // nessuna lettura senza il tocco dell autista
      expect(el(f).querySelector('[data-testid="aggiungi-foto"]')).not.toBeNull();
    });

    it('esito con foto e posizione: la posizione e nel corpo dell evento, le foto dopo la conferma', async () => {
      const f = await apri();
      await clic(f, 'eseguito');
      await aggiungiFoto(f);
      await aggiungiFoto(f);
      expect(el(f).querySelectorAll('[data-testid="foto-pronta"]')).toHaveLength(2);
      await clic(f, 'aggiungi-posizione');
      expect(letturePosizione).toBe(1);
      expect(el(f).querySelector('[data-testid="posizione-pronta"]')?.textContent).toContain(
        '± 8 m',
      );
      await clic(f, 'conferma-esito');
      const req = http.expectOne('/api/v1/campo/eventi');
      expect(req.request.body.dati).toEqual({ posizione: { lat: 45.1, lon: 9.2, accuratezza: 8 } });
      req.flush({ id: req.request.body.id, esito: 'APPLICATO', motivoConflitto: null });
      await flush();
      const r1 = http.expectOne(`/api/v1/campo/eventi/${req.request.body.id}/foto`);
      r1.flush({});
      await flush();
      f.detectChanges();
      expect(el(f).querySelector('[data-testid="esito-posizione"]')?.textContent).toContain(
        '± 8 m',
      );
      expect(el(f).querySelector('[data-testid="esito-foto"]')?.textContent).toContain(
        '2 foto: 1 inviate, 1 in attesa',
      );
      http.expectOne(`/api/v1/campo/eventi/${req.request.body.id}/foto`).flush({});
      await flush();
      f.detectChanges();
      expect(el(f).querySelector('[data-testid="esito-foto"]')?.textContent).toContain(
        "2 foto inviate all'ufficio",
      );
    });

    it('al massimo 3 foto: il quarto tocco e disabilitato; una foto si puo togliere', async () => {
      const f = await apri();
      await clic(f, 'eseguito');
      for (let i = 0; i < 3; i++) await aggiungiFoto(f);
      const b = el(f).querySelector('[data-testid="aggiungi-foto"]') as HTMLButtonElement;
      expect(b.disabled).toBe(true);
      expect(b.textContent).toContain('3/3');
      (el(f).querySelector('[data-testid="foto-pronta"] button') as HTMLElement).click();
      f.detectChanges();
      expect(el(f).querySelectorAll('[data-testid="foto-pronta"]')).toHaveLength(2);
    });

    it('posizione negata: messaggio chiaro e l esito parte lo stesso, senza posizione', async () => {
      posizioneDi = 'negata';
      const f = await apri();
      await clic(f, 'eseguito');
      await clic(f, 'aggiungi-posizione');
      expect(el(f).querySelector('[data-testid="errore-allegati"]')?.textContent).toContain(
        'negato',
      );
      await clic(f, 'conferma-esito');
      const req = http.expectOne('/api/v1/campo/eventi');
      expect(req.request.body.dati).toEqual({});
      req.flush({ id: req.request.body.id, esito: 'APPLICATO', motivoConflitto: null });
      await flush();
    });

    it('foto non preparabile: errore sotto i pulsanti, l esito si puo dare lo stesso', async () => {
      fallisciFoto = 'La foto è troppo pesante anche dopo la compressione.';
      const f = await apri();
      await clic(f, 'eseguito');
      await aggiungiFoto(f);
      expect(el(f).querySelector('[data-testid="errore-allegati"]')?.textContent).toContain(
        'troppo pesante',
      );
      expect(el(f).querySelectorAll('[data-testid="foto-pronta"]')).toHaveLength(0);
      await clic(f, 'conferma-esito');
      http
        .expectOne('/api/v1/campo/eventi')
        .flush({ id: 'x', esito: 'APPLICATO', motivoConflitto: null });
      await flush();
    });

    it('tornare indietro scarta foto e posizione: non restano per il prossimo esito', async () => {
      const f = await apri();
      await clic(f, 'eseguito');
      await aggiungiFoto(f);
      await clic(f, 'aggiungi-posizione');
      await clic(f, 'indietro-esito');
      await clic(f, 'non-eseguito');
      expect(el(f).querySelectorAll('[data-testid="foto-pronta"]')).toHaveLength(0);
      expect(el(f).querySelector('[data-testid="posizione-pronta"]')).toBeNull();
    });

    it('solo foto in attesa (esito gia confermato): il riepilogo le conta e «Invia ora» le fa ripartire dopo un 403', async () => {
      const f = await apri();
      await clic(f, 'eseguito');
      await aggiungiFoto(f);
      await clic(f, 'conferma-esito');
      const req = http.expectOne('/api/v1/campo/eventi');
      req.flush({ id: req.request.body.id, esito: 'APPLICATO', motivoConflitto: null });
      await flush();
      http
        .expectOne(`/api/v1/campo/eventi/${req.request.body.id}/foto`)
        .flush(
          { message: 'Modulo non attivo.', error: 'MODULO_NON_ATTIVO' },
          { status: 403, statusText: 'x' },
        );
      await flush();
      f.detectChanges();
      expect(el(f).querySelector('[data-testid="bloccata"]')).not.toBeNull();
      expect(el(f).querySelector('[data-testid="da-inviare"]')?.textContent).toContain(
        '1 foto da inviare',
      );
      await clic(f, 'invia-ora');
      http.expectOne(`/api/v1/campo/eventi/${req.request.body.id}/foto`).flush({});
      await flush();
      f.detectChanges();
      expect(el(f).querySelector('[data-testid="da-inviare"]')).toBeNull();
    });

    it('una foto rifiutata dal server si vede col motivo', async () => {
      const f = await apri();
      await clic(f, 'eseguito');
      await aggiungiFoto(f);
      await clic(f, 'conferma-esito');
      const req = http.expectOne('/api/v1/campo/eventi');
      req.flush({ id: req.request.body.id, esito: 'APPLICATO', motivoConflitto: null });
      await flush();
      http
        .expectOne(`/api/v1/campo/eventi/${req.request.body.id}/foto`)
        .flush(
          { message: 'La foto supera 1 MB.', error: 'FOTO_TROPPO_GRANDE' },
          { status: 413, statusText: 'x' },
        );
      await flush();
      f.detectChanges();
      expect(el(f).querySelector('[data-testid="foto-rifiutata"]')?.textContent).toContain(
        'supera 1 MB',
      );
    });
  });
});
