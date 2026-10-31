import { TenantContext } from '../../../core/context/tenant-context'
import {
  DatiControparteNonValidiError,
  DittaIdentificativiInConflittoError,
  DittaNonTrovataError,
  IdentificativoNonCorrispondenteError,
  SedeNonModificabileError,
} from '../../../core/domain/errors'
import { Ditta } from '../../../domain/registry/entities/ditta'
import { SedeDitta } from '../../../domain/registry/entities/sede-ditta'
import { IdentificativoFiscale } from '../../../domain/registry/value-objects/identificativo-fiscale'
import { Indirizzo } from '../../../domain/registry/value-objects/indirizzo'
import {
  CF_PERSONA_ALTRO,
  CF_PERSONA_VALIDO,
  PIVA_CHECKSUM_ERRATO,
  PIVA_VALIDA,
  partitaIvaValida,
} from '../../../test-support/anagrafiche-di-test'
import { DitteService } from './ditte.service'

const INDIRIZZO = { via: 'Via Roma', civico: '1', cap: '00100', citta: 'Roma', provincia: 'RM' }

function repoFinto() {
  return {
    bloccaIdentificativi: jest.fn().mockResolvedValue(undefined),
    bloccaSedi: jest.fn().mockResolvedValue(undefined),
    cercaPerIdentificativi: jest.fn().mockResolvedValue([]),
    trovaPerId: jest.fn().mockResolvedValue(null),
    trovaSede: jest.fn().mockResolvedValue(null),
    sedi: jest.fn().mockResolvedValue([]),
    crea: jest.fn().mockResolvedValue(undefined),
    aggiorna: jest.fn().mockResolvedValue(undefined),
    creaSede: jest.fn().mockResolvedValue(undefined),
    aggiornaSede: jest.fn().mockResolvedValue(undefined),
    impostaPrincipale: jest.fn().mockResolvedValue(undefined),
    ruoliDellaDitta: jest.fn().mockResolvedValue([]),
  }
}

describe('DitteService', () => {
  let repo: ReturnType<typeof repoFinto>
  let tx: { activityLog: { create: jest.Mock } }
  let service: DitteService

  const nelTenant = <R>(fn: () => Promise<R>) => TenantContext.run({ tenantId: 't1' }, fn)

  beforeEach(() => {
    repo = repoFinto()
    tx = { activityLog: { create: jest.fn().mockResolvedValue(undefined) } }
    const prisma = { $transaction: jest.fn(async (fn: (t: unknown) => unknown) => fn(tx)) }
    service = new DitteService(prisma as never, repo as never)
  })

  const dittaEsistente = (piva: string | null, cf: string | null = null) =>
    Ditta.ripristina({
      id: 'd1',
      ragioneSociale: 'Rossi S.r.l.',
      partitaIva: piva,
      codiceFiscale: cf,
      createdAt: new Date(),
      updatedAt: new Date(),
    })

  const sedeEsistente = (principale: boolean, over: Partial<typeof INDIRIZZO> = {}) =>
    SedeDitta.crea({
      dittaId: 'd1',
      indirizzo: Indirizzo.create({ ...INDIRIZZO, ...over }),
      principale,
    })

  describe('risolviPerRuolo', () => {
    const dati = (over: object = {}) => ({
      ragioneSociale: 'Rossi S.r.l.',
      partitaIva: PIVA_VALIDA,
      indirizzo: INDIRIZZO,
      ...over,
    })

    it('crea ditta e sede principale quando non esiste, dopo il lock', async () => {
      const r = await nelTenant(() => service.risolviPerRuolo(tx as never, 'PRODUTTORE', dati()))
      expect(r.dittaEsistente).toBe(false)
      // gli identificativi della ditta dopo la risoluzione (servono a chi costruisce la riga di ruolo)
      expect(r.partitaIva).toBe(PIVA_VALIDA)
      expect(r.codiceFiscale).toBeNull()
      expect(repo.bloccaIdentificativi).toHaveBeenCalledWith(tx, [PIVA_VALIDA])
      expect(repo.crea).toHaveBeenCalledTimes(1)
      const sede = repo.creaSede.mock.calls[0][1] as SedeDitta
      expect(sede.principale).toBe(true)
      expect(r.sedeId).toBe(sede.id)
      expect(repo.bloccaIdentificativi.mock.invocationCallOrder[0]).toBeLessThan(
        repo.cercaPerIdentificativi.mock.invocationCallOrder[0]
      )
    })

    it('riusa la ditta e la sede attiva con lo stesso indirizzo normalizzato', async () => {
      const sede = sedeEsistente(true)
      repo.cercaPerIdentificativi.mockResolvedValue([dittaEsistente(PIVA_VALIDA)])
      repo.sedi.mockResolvedValue([sede])
      const r = await nelTenant(() =>
        service.risolviPerRuolo(
          tx as never,
          'DESTINATARIO',
          dati({ indirizzo: { ...INDIRIZZO, via: '  VIA  ROMA ' } })
        )
      )
      expect(r).toMatchObject({ dittaId: 'd1', sedeId: sede.id, dittaEsistente: true, avvisi: [] })
      expect(repo.crea).not.toHaveBeenCalled()
      expect(repo.creaSede).not.toHaveBeenCalled()
    })

    it('con un indirizzo diverso crea una sede NON principale', async () => {
      repo.cercaPerIdentificativi.mockResolvedValue([dittaEsistente(PIVA_VALIDA)])
      repo.sedi.mockResolvedValue([sedeEsistente(true)])
      await nelTenant(() =>
        service.risolviPerRuolo(
          tx as never,
          'DESTINATARIO',
          dati({ indirizzo: { ...INDIRIZZO, civico: '9' } })
        )
      )
      expect((repo.creaSede.mock.calls[0][1] as SedeDitta).principale).toBe(false)
    })

    it('una sede disattivata non viene riusata', async () => {
      const spenta = sedeEsistente(false)
      spenta.disattiva([])
      repo.cercaPerIdentificativi.mockResolvedValue([dittaEsistente(PIVA_VALIDA)])
      repo.sedi.mockResolvedValue([sedeEsistente(true, { civico: '5' }), spenta])
      await nelTenant(() => service.risolviPerRuolo(tx as never, 'PRODUTTORE', dati()))
      expect(repo.creaSede).toHaveBeenCalledTimes(1)
    })

    it('avvisa quando la ragione sociale registrata e diversa, e la mantiene', async () => {
      repo.cercaPerIdentificativi.mockResolvedValue([dittaEsistente(PIVA_VALIDA)])
      repo.sedi.mockResolvedValue([sedeEsistente(true)])
      const r = await nelTenant(() =>
        service.risolviPerRuolo(tx as never, 'PRODUTTORE', dati({ ragioneSociale: 'ROSSI SPA' }))
      )
      expect(r.ragioneSocialeDitta).toBe('Rossi S.r.l.')
      expect(r.avvisi).toEqual([
        'La ragione sociale registrata per questa ditta è «Rossi S.r.l.»: è stata mantenuta.',
      ])
    })

    it('aggiunge il CF mancante alla ditta esistente', async () => {
      repo.cercaPerIdentificativi.mockResolvedValue([dittaEsistente(PIVA_VALIDA)])
      repo.sedi.mockResolvedValue([sedeEsistente(true)])
      await nelTenant(() =>
        service.risolviPerRuolo(
          tx as never,
          'PRODUTTORE',
          dati({ codiceFiscale: CF_PERSONA_VALIDO })
        )
      )
      expect(repo.aggiorna).toHaveBeenCalledTimes(1)
      expect((repo.aggiorna.mock.calls[0][1] as Ditta).codiceFiscale).toBe(CF_PERSONA_VALIDO)
    })

    it('CF contraddittorio: 400 senza il valore', async () => {
      repo.cercaPerIdentificativi.mockResolvedValue([
        dittaEsistente(PIVA_VALIDA, CF_PERSONA_VALIDO),
      ])
      const p = nelTenant(() =>
        service.risolviPerRuolo(
          tx as never,
          'PRODUTTORE',
          dati({ codiceFiscale: CF_PERSONA_ALTRO })
        )
      )
      await expect(p).rejects.toBeInstanceOf(IdentificativoNonCorrispondenteError)
      await p.catch(e => {
        expect(e.message).not.toContain(CF_PERSONA_ALTRO)
        expect(e.message).not.toContain(CF_PERSONA_VALIDO)
      })
    })

    it('P.IVA e CF di due ditte diverse: 409', async () => {
      repo.cercaPerIdentificativi.mockResolvedValue([
        dittaEsistente(PIVA_VALIDA),
        Ditta.ripristina({
          id: 'd2',
          ragioneSociale: 'Altra',
          partitaIva: null,
          codiceFiscale: CF_PERSONA_VALIDO,
          createdAt: new Date(),
          updatedAt: new Date(),
        }),
      ])
      await expect(
        nelTenant(() =>
          service.risolviPerRuolo(
            tx as never,
            'PRODUTTORE',
            dati({ codiceFiscale: CF_PERSONA_VALIDO })
          )
        )
      ).rejects.toBeInstanceOf(DittaIdentificativiInConflittoError)
    })

    it('un privato come trasportatore o destinatario: errore, prima di ogni lock', async () => {
      for (const ruolo of ['TRASPORTATORE', 'DESTINATARIO'] as const) {
        await expect(
          nelTenant(() =>
            service.risolviPerRuolo(
              tx as never,
              ruolo,
              dati({ partitaIva: undefined, codiceFiscale: CF_PERSONA_VALIDO })
            )
          )
        ).rejects.toThrow('solo produttore')
      }
      expect(repo.bloccaIdentificativi).not.toHaveBeenCalled()
    })

    it('un privato come produttore e ammesso', async () => {
      const r = await nelTenant(() =>
        service.risolviPerRuolo(
          tx as never,
          'PRODUTTORE',
          dati({ partitaIva: undefined, codiceFiscale: CF_PERSONA_VALIDO })
        )
      )
      expect(r.dittaEsistente).toBe(false)
    })

    it('identificativo non valido: errore di dati, nessun accesso al database', async () => {
      await expect(
        nelTenant(() =>
          service.risolviPerRuolo(
            tx as never,
            'PRODUTTORE',
            dati({ partitaIva: PIVA_CHECKSUM_ERRATO })
          )
        )
      ).rejects.toBeInstanceOf(DatiControparteNonValidiError)
      expect(repo.bloccaIdentificativi).not.toHaveBeenCalled()
    })
  })

  describe('cerca', () => {
    it('trova per P.IVA anche se non passa il checksum (dato migrato) e non da errori sul formato', async () => {
      repo.cercaPerIdentificativi.mockResolvedValue([dittaEsistente(PIVA_CHECKSUM_ERRATO)])
      const dto = await nelTenant(() => service.cerca(` it${PIVA_CHECKSUM_ERRATO} `))
      expect(repo.cercaPerIdentificativi).toHaveBeenCalledWith(tx, [PIVA_CHECKSUM_ERRATO])
      expect(dto?.partitaIvaDaVerificare).toBe(true)
      await expect(nelTenant(() => service.cerca('abc'))).rejects.toBeInstanceOf(
        DatiControparteNonValidiError
      )
    })

    it('nessuna ditta: null', async () => {
      expect(await nelTenant(() => service.cerca(PIVA_VALIDA))).toBeNull()
    })
  })

  describe('aggiornaDitta', () => {
    it('ditta di un altro tenant o inesistente: 404', async () => {
      await expect(
        nelTenant(() => service.aggiornaDitta('x', { ragioneSociale: 'A' }))
      ).rejects.toBeInstanceOf(DittaNonTrovataError)
    })

    it('sostituisce la P.IVA sbagliata con lock su ENTRAMBI i valori e audit senza valori', async () => {
      repo.trovaPerId.mockImplementation(async () => dittaEsistente(PIVA_CHECKSUM_ERRATO))
      const nuova = partitaIvaValida(42)
      await nelTenant(() => service.aggiornaDitta('d1', { partitaIva: nuova }, { userId: 'u1' }))
      expect(repo.bloccaIdentificativi).toHaveBeenCalledWith(
        tx,
        expect.arrayContaining([PIVA_CHECKSUM_ERRATO, nuova])
      )
      expect((repo.aggiorna.mock.calls[0][1] as Ditta).partitaIva).toBe(nuova)
      const audit = tx.activityLog.create.mock.calls[0][0].data
      expect(audit).toMatchObject({
        tenantId: 't1',
        userId: 'u1',
        action: 'DITTA_PARTITA_IVA_CORRETTA',
        metadata: { dittaId: 'd1' },
      })
      expect(JSON.stringify(audit)).not.toContain(nuova)
      expect(JSON.stringify(audit)).not.toContain(PIVA_CHECKSUM_ERRATO)
    })

    it('P.IVA attuale valida: rifiutata, nessun audit', async () => {
      repo.trovaPerId.mockImplementation(async () => dittaEsistente(PIVA_VALIDA))
      await expect(
        nelTenant(() => service.aggiornaDitta('d1', { partitaIva: partitaIvaValida(42) }))
      ).rejects.toBeInstanceOf(IdentificativoNonCorrispondenteError)
      expect(tx.activityLog.create).not.toHaveBeenCalled()
    })

    it('nuova P.IVA gia di un altra ditta: 409', async () => {
      repo.trovaPerId.mockImplementation(async () => dittaEsistente(PIVA_CHECKSUM_ERRATO))
      repo.cercaPerIdentificativi.mockResolvedValue([
        Ditta.crea({
          ragioneSociale: 'Altra',
          identificativo: IdentificativoFiscale.crea({ partitaIva: partitaIvaValida(42) }),
        }),
      ])
      await expect(
        nelTenant(() => service.aggiornaDitta('d1', { partitaIva: partitaIvaValida(42) }))
      ).rejects.toBeInstanceOf(DittaIdentificativiInConflittoError)
    })

    it('aggiunge il CF mancante senza audit', async () => {
      repo.trovaPerId.mockImplementation(async () => dittaEsistente(PIVA_VALIDA))
      await nelTenant(() => service.aggiornaDitta('d1', { codiceFiscale: CF_PERSONA_VALIDO }))
      expect((repo.aggiorna.mock.calls[0][1] as Ditta).codiceFiscale).toBe(CF_PERSONA_VALIDO)
      expect(tx.activityLog.create).not.toHaveBeenCalled()
    })
  })

  describe('sedi', () => {
    beforeEach(() => repo.trovaPerId.mockImplementation(async () => dittaEsistente(PIVA_VALIDA)))

    it('aggiungiSede rifiuta un indirizzo gia presente fra le sedi attive', async () => {
      repo.sedi.mockResolvedValue([sedeEsistente(true)])
      await expect(
        nelTenant(() => service.aggiungiSede('d1', { indirizzo: INDIRIZZO }))
      ).rejects.toBeInstanceOf(SedeNonModificabileError)
    })

    it('aggiungiSede crea una sede non principale se ce ne sono altre', async () => {
      repo.sedi.mockResolvedValue([sedeEsistente(true)])
      const s = await nelTenant(() =>
        service.aggiungiSede('d1', { indirizzo: { ...INDIRIZZO, civico: '2' } })
      )
      expect(s.principale).toBe(false)
    })

    it('aggiornaSede: cambio d indirizzo uguale a quello di un altra sede attiva: 409', async () => {
      const a = sedeEsistente(true)
      const b = sedeEsistente(false, { civico: '2' })
      repo.trovaSede.mockResolvedValue(b)
      repo.sedi.mockResolvedValue([a, b])
      await expect(
        nelTenant(() => service.aggiornaSede('d1', b.id, { indirizzo: INDIRIZZO }))
      ).rejects.toBeInstanceOf(SedeNonModificabileError)
      expect(repo.aggiornaSede).not.toHaveBeenCalled()
    })

    it('aggiornaSede: riattivare una sede con l indirizzo di una attiva: 409', async () => {
      const a = sedeEsistente(true)
      const spenta = sedeEsistente(false)
      spenta.disattiva([])
      repo.trovaSede.mockResolvedValue(spenta)
      repo.sedi.mockResolvedValue([a, spenta])
      await expect(
        nelTenant(() => service.aggiornaSede('d1', spenta.id, { attiva: true }))
      ).rejects.toBeInstanceOf(SedeNonModificabileError)
      expect(repo.aggiornaSede).not.toHaveBeenCalled()
    })

    it('aggiornaSede: una sede che resta disattivata non e controllata', async () => {
      const a = sedeEsistente(true)
      const spenta = sedeEsistente(false)
      spenta.disattiva([])
      repo.trovaSede.mockResolvedValue(spenta)
      repo.sedi.mockResolvedValue([a, spenta])
      await nelTenant(() => service.aggiornaSede('d1', spenta.id, { referente: 'Mario' }))
      expect(repo.aggiornaSede).toHaveBeenCalledTimes(1)
    })

    it('aggiornaSede non disattiva la principale', async () => {
      const principale = sedeEsistente(true)
      repo.trovaSede.mockResolvedValue(principale)
      await expect(
        nelTenant(() => service.aggiornaSede('d1', principale.id, { attiva: false }))
      ).rejects.toBeInstanceOf(SedeNonModificabileError)
    })

    it('aggiornaSede non disattiva la predefinita di un ruolo', async () => {
      const sede = sedeEsistente(false)
      repo.trovaSede.mockResolvedValue(sede)
      repo.ruoliDellaDitta.mockResolvedValue([{ ruolo: 'DESTINATARIO', id: 'r1', sedeId: sede.id }])
      await expect(
        nelTenant(() => service.aggiornaSede('d1', sede.id, { attiva: false }))
      ).rejects.toThrow('predefinita del destinatario')
      expect(repo.aggiornaSede).not.toHaveBeenCalled()
    })

    it('aggiornaSede disattiva una sede libera', async () => {
      const sede = sedeEsistente(false)
      repo.trovaSede.mockResolvedValue(sede)
      const dto = await nelTenant(() => service.aggiornaSede('d1', sede.id, { attiva: false }))
      expect(dto.attiva).toBe(false)
      expect(repo.aggiornaSede).toHaveBeenCalledTimes(1)
    })

    it('impostaPrincipale rifiuta una sede disattivata e chiama il repository per una attiva', async () => {
      const spenta = sedeEsistente(false)
      spenta.disattiva([])
      repo.trovaSede.mockResolvedValue(spenta)
      await expect(
        nelTenant(() => service.impostaPrincipale('d1', spenta.id))
      ).rejects.toBeInstanceOf(SedeNonModificabileError)

      const viva = sedeEsistente(false)
      repo.trovaSede.mockResolvedValue(viva)
      await nelTenant(() => service.impostaPrincipale('d1', viva.id))
      expect(repo.impostaPrincipale).toHaveBeenCalledWith(tx, 'd1', viva.id)
    })
  })
})
