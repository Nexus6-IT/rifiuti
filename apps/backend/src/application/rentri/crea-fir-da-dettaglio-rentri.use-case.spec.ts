import { CreaFIRDaDettaglioRENTRIUseCase } from './crea-fir-da-dettaglio-rentri.use-case'
import { DomainException } from '../../domain/shared/domain-exception'
import { TipoTratta } from '../../domain/fir/aggregates/fir.aggregate'
import { UnitaMisura } from '../../domain/fir/value-objects/quantita'
import { FormularioModel } from '../../infrastructure/rentri/rentri-api.client'

/**
 * CreaFIRDaDettaglioRENTRIUseCase — TDD (R2 Task 5)
 *
 * Copre le due decisioni di prodotto del brief:
 * 1. snapshot immutabile (v. decisione PO 2026-06-09, stessa di CreateFIRUseCase);
 * 2. campo obbligatorio locale assente nel dettaglio RENTRI → errore di
 *    dominio leggibile, MAI un FIR a metà creato silenziosamente.
 *
 * Verifica anche che il codice CER non venga validato contro il catalogo
 * (un formulario acquisito può legittimamente portare un CER storico
 * ritirato: v. commento di classe del use case) e che `rentriNumeroFir`
 * resti `null` (lo valorizza il chiamante, Task 4, con `agganciaFormularioAcquisito`).
 */
describe('CreaFIRDaDettaglioRENTRIUseCase', () => {
  const TENANT_ID = 'tenant-1'
  const USER_ID = 'user-1'
  const NUMERO_FIR = 'RENTRI-000999'

  let useCase: CreaFIRDaDettaglioRENTRIUseCase

  beforeEach(() => {
    useCase = new CreaFIRDaDettaglioRENTRIUseCase()
  })

  function dettaglioCompleto(overrides: Partial<FormularioModel> = {}): FormularioModel {
    return {
      stato_formulario: 'InserimentoTrasportoSuccessivo',
      dati_partenza: {
        produttore: {
          denominazione: 'Produttore di Prova S.r.l.',
          codice_fiscale: '01234567890',
          indirizzo: {
            citta: { comune_id: '058091' },
            indirizzo: 'Via Roma',
            civico: '10',
            cap: '00100',
          },
        },
        destinatario: {
          denominazione: 'Destinatario di Prova S.p.A.',
          codice_fiscale: '09876543210',
          indirizzo: {
            citta: { nazione_id: 'FR', nome_citta: 'Lione' },
            indirizzo: 'Rue de Test',
          },
          attivita: 'R13',
        },
        trasportatori: [
          {
            denominazione: 'Trasportatore Primo S.r.l.',
            codice_fiscale: '11122233344',
            tipo_trasporto: 'Terrestre',
            numero_iscrizione_albo: 'RM/012345',
          },
          {
            denominazione: 'Trasportatore Secondo S.r.l.',
            codice_fiscale: '55566677788',
            tipo_trasporto: 'Ferroviario',
          },
        ],
        rifiuto: {
          codice_eer: '130208*',
          descrizione: 'Olio esausto',
          stato_fisico: 'L',
          caratteristiche_pericolo: ['HP03', 'HP14'],
          numero_colli: '5',
          quantita: { valore: 120, unita_misura: 'kg' },
        },
        annotazioni: 'Trasporto in due tratte per guasto al mezzo iniziale',
      },
      ...overrides,
    }
  }

  // --- Caso positivo: dettaglio completo → FIR coerente ---

  it('mappa un dettaglio completo in un FIR locale coerente (snapshot immutabile)', async () => {
    const fir = await useCase.creaDaDettaglio(TENANT_ID, USER_ID, dettaglioCompleto(), NUMERO_FIR)

    expect(fir.tenantId).toBe(TENANT_ID)
    expect(fir.creatoDaUserId).toBe(USER_ID)

    expect(fir.produttore).toEqual(
      expect.objectContaining({
        ragioneSociale: 'Produttore di Prova S.r.l.',
        partitaIva: '01234567890',
      })
    )
    expect(fir.produttore?.indirizzo).toContain('Via Roma')
    expect(fir.produttore?.indirizzo).toContain('ISTAT 058091')

    expect(fir.destinatario).toEqual(
      expect.objectContaining({
        ragioneSociale: 'Destinatario di Prova S.p.A.',
        partitaIva: '09876543210',
      })
    )
    expect(fir.destinatario?.indirizzo).toContain('Lione')
    expect(fir.destinatario?.indirizzo).toContain('FR')

    expect(fir.trasportatore).toEqual(
      expect.objectContaining({
        ragioneSociale: 'Trasportatore Primo S.r.l.',
        partitaIva: '11122233344',
      })
    )

    expect(fir.rifiuto.cerCode).toBe('13 02 08*')
    expect(fir.rifiuto.quantita.valore).toBe(120)
    expect(fir.rifiuto.quantita.unitaMisura).toBe(UnitaMisura.KG)
    expect(fir.rifiuto.statoFisico).toBe('Liquido')
    expect(fir.rifiuto.caratteristichePericolo).toBe('HP03,HP14')
    expect(fir.rifiuto.numeroColli).toBe(5)
    expect(fir.rifiuto.descrizione).toBe('Olio esausto')
    expect(fir.rifiuto.tipoOperazione).toBe('RECOVERY')
    expect(fir.rifiuto.codiceOperazione).toBe('R13')

    expect(fir.annotazioni).toBe('Trasporto in due tratte per guasto al mezzo iniziale')

    expect(fir.trasportatoriAggiuntivi).toHaveLength(1)
    expect(fir.trasportatoriAggiuntivi[0]).toEqual(
      expect.objectContaining({
        ordine: 2,
        tipoTratta: TipoTratta.FERROVIARIA,
        denominazione: 'Trasportatore Secondo S.r.l.',
      })
    )

    // Il legame RENTRI lo imposta il chiamante (Task 4) con
    // agganciaFormularioAcquisito DOPO la creazione: qui deve restare vuoto,
    // altrimenti la successiva chiamata del chiamante fallirebbe
    // (assertNonGiaLegatoRENTRI — v. fir.aggregate.ts).
    expect(fir.rentriNumeroFir).toBeNull()
    expect(fir.rentriOrigineLegame).toBeNull()
  })

  // --- Il punto delicato: CER storico ritirato ---

  it('NON rifiuta un codice CER ritirato dal registro dell’ente: il formulario acquisito è storico, esiste già presso RENTRI', async () => {
    const dettaglio = dettaglioCompleto()
    dettaglio.dati_partenza!.rifiuto!.codice_eer = '999999'

    const fir = await useCase.creaDaDettaglio(TENANT_ID, USER_ID, dettaglio, NUMERO_FIR)

    expect(fir.rifiuto.cerCode).toBe('99 99 99')
  })

  // --- Campo obbligatorio locale mancante nel dettaglio → errore di dominio leggibile ---

  it('rifiuta se manca dati_partenza (nessun FIR incompleto creato silenziosamente)', async () => {
    await expect(
      useCase.creaDaDettaglio(
        TENANT_ID,
        USER_ID,
        { stato_formulario: 'InserimentoQuantita' },
        NUMERO_FIR
      )
    ).rejects.toThrow(DomainException)
  })

  it('rifiuta se manca il produttore', async () => {
    const dettaglio = dettaglioCompleto()
    dettaglio.dati_partenza!.produttore = null

    await expect(
      useCase.creaDaDettaglio(TENANT_ID, USER_ID, dettaglio, NUMERO_FIR)
    ).rejects.toThrow(/dati_partenza\.produttore/)
  })

  it('rifiuta se manca la denominazione del produttore', async () => {
    const dettaglio = dettaglioCompleto()
    dettaglio.dati_partenza!.produttore!.denominazione = ''

    await expect(
      useCase.creaDaDettaglio(TENANT_ID, USER_ID, dettaglio, NUMERO_FIR)
    ).rejects.toThrow(/denominazione/)
  })

  it('rifiuta se manca il destinatario', async () => {
    const dettaglio = dettaglioCompleto()
    dettaglio.dati_partenza!.destinatario = null

    await expect(
      useCase.creaDaDettaglio(TENANT_ID, USER_ID, dettaglio, NUMERO_FIR)
    ).rejects.toThrow(/dati_partenza\.destinatario/)
  })

  it('rifiuta se non c’è alcun trasportatore', async () => {
    const dettaglio = dettaglioCompleto()
    dettaglio.dati_partenza!.trasportatori = []

    await expect(
      useCase.creaDaDettaglio(TENANT_ID, USER_ID, dettaglio, NUMERO_FIR)
    ).rejects.toThrow(/trasportatori/)
  })

  it('rifiuta se manca il codice_fiscale del trasportatore principale', async () => {
    const dettaglio = dettaglioCompleto()
    dettaglio.dati_partenza!.trasportatori![0].codice_fiscale = ''

    await expect(
      useCase.creaDaDettaglio(TENANT_ID, USER_ID, dettaglio, NUMERO_FIR)
    ).rejects.toThrow(/codice_fiscale/)
  })

  it('rifiuta se manca il rifiuto', async () => {
    const dettaglio = dettaglioCompleto()
    dettaglio.dati_partenza!.rifiuto = null

    await expect(
      useCase.creaDaDettaglio(TENANT_ID, USER_ID, dettaglio, NUMERO_FIR)
    ).rejects.toThrow(/dati_partenza\.rifiuto/)
  })

  it('rifiuta se manca il codice EER', async () => {
    const dettaglio = dettaglioCompleto()
    dettaglio.dati_partenza!.rifiuto!.codice_eer = ''

    await expect(
      useCase.creaDaDettaglio(TENANT_ID, USER_ID, dettaglio, NUMERO_FIR)
    ).rejects.toThrow(/codice_eer/)
  })

  it('rifiuta se manca la quantità (il modello locale la richiede sempre > 0)', async () => {
    const dettaglio = dettaglioCompleto()
    dettaglio.dati_partenza!.rifiuto!.quantita = null

    await expect(
      useCase.creaDaDettaglio(TENANT_ID, USER_ID, dettaglio, NUMERO_FIR)
    ).rejects.toThrow(/quantita/)
  })

  it('il messaggio di errore segue il formato leggibile del brief', async () => {
    const dettaglio = dettaglioCompleto()
    dettaglio.dati_partenza!.rifiuto!.codice_eer = ''

    await expect(
      useCase.creaDaDettaglio(TENANT_ID, USER_ID, dettaglio, NUMERO_FIR)
    ).rejects.toThrow(/formulario RENTRI non contiene .*necessario per registrarlo nel gestionale/)
  })

  // --- Campi RENTRI senza corrispondente locale (opzionali) non bloccano la creazione ---

  it('non fallisce se lo stato fisico RENTRI non ha un corrispondente locale esatto (conserva il codice originale)', async () => {
    const dettaglio = dettaglioCompleto()
    dettaglio.dati_partenza!.rifiuto!.stato_fisico = 'VS'

    const fir = await useCase.creaDaDettaglio(TENANT_ID, USER_ID, dettaglio, NUMERO_FIR)

    expect(fir.rifiuto.statoFisico).toBe('VS')
  })

  it('mappa unità di misura "l" in LITRI', async () => {
    const dettaglio = dettaglioCompleto()
    dettaglio.dati_partenza!.rifiuto!.quantita = { valore: 50, unita_misura: 'l' }

    const fir = await useCase.creaDaDettaglio(TENANT_ID, USER_ID, dettaglio, NUMERO_FIR)

    expect(fir.rifiuto.quantita.unitaMisura).toBe(UnitaMisura.LITRI)
  })
})
