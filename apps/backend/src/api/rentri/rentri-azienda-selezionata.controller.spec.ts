import { ForbiddenException } from '@nestjs/common'
import { RentriScortaController } from './rentri-scorta.controller'
import { RentriFormulariController } from './rentri-formulari.controller'
import { RentriUnitaLocaleController } from './rentri-unita-locale.controller'
import { RentriCredentialController } from './rentri-credential.controller'
import { RentriSitiController } from './rentri-siti.controller'
import { RentriModalitaLegameController } from './rentri-modalita-legame.controller'
import { RentriDiagnosticaController } from './rentri-diagnostica.controller'
import { RentriCodificheController } from './rentri-codifiche.controller'
import { RentriRegistroController } from './rentri-registro.controller'

/**
 * Switch di azienda: il token resta sul tenant A (`user.tenantId`), l'azienda
 * selezionata (`req.tenantId`, dopo il TenantSwitchInterceptor) è B. Tutti i
 * dati RENTRI (credenziali, unità locali, scorta, formulari...) sono
 * dell'azienda selezionata: un consulente che lavora per il cliente B deve
 * vedere e configurare quelli di B, mai quelli della propria azienda A.
 *
 * Questi controller ricevevano già l'azienda attiva dal `CurrentUser` di `auth/decorators`
 * (o da `@TenantId()`): la suite è una guardia contro regressioni, non la prova di un difetto.
 */
const user = { id: 'u1', email: 'c@example.com', tenantId: 'A', role: 'ADMIN', permissions: [] }
const reqB = { tenantId: 'B', user }
const reqSenza = { user: { ...user, tenantId: undefined } }
const logger = {
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
  setContext: jest.fn(),
}

describe('controller RENTRI — azienda selezionata (≠ azienda del token)', () => {
  it('scorta: tutte le letture/azioni usano B', async () => {
    const elenca = { execute: jest.fn().mockResolvedValue({ blocchi: [] }) }
    const scorta = { execute: jest.fn().mockResolvedValue({}) }
    const vidima = {
      verificaBlocco: jest.fn().mockResolvedValue(undefined),
      execute: jest.fn().mockResolvedValue({}),
    }
    const predefinito = { execute: jest.fn().mockResolvedValue({}) }
    const emissione = { execute: jest.fn().mockResolvedValue({}) }
    const c = new RentriScortaController(
      elenca as any,
      scorta as any,
      vidima as any,
      predefinito as any,
      emissione as any,
      logger as any
    )

    await c.getBlocchi(reqB)
    await c.getScortaCorrente(reqB)
    await c.vidimaLotto({ codiceBlocco: 'BLK', quantita: 2 }, reqB)
    await c.impostaPredefinito('BLK', reqB)
    await c.getEmissionePossibile(reqB, 'SITO')

    expect(elenca.execute).toHaveBeenCalledWith('B')
    expect(scorta.execute).toHaveBeenCalledWith('B')
    expect(vidima.verificaBlocco).toHaveBeenCalledWith('B', 'BLK')
    expect(vidima.execute).toHaveBeenCalledWith('B', 'BLK', 2)
    expect(predefinito.execute).toHaveBeenCalledWith('B', 'BLK')
    expect(emissione.execute).toHaveBeenCalledWith('B', 'SITO')
  })

  it('formulari: ricerca, aggancio e rilascio usano B (sede principale inclusa)', async () => {
    const cerca = { execute: jest.fn().mockResolvedValue({}) }
    const acquisisci = { execute: jest.fn().mockResolvedValue({}) }
    const rilascia = { execute: jest.fn().mockResolvedValue({}) }
    const unita = { getPrincipale: jest.fn().mockResolvedValue({ numIscrSito: 'SITO-B' }) }
    const c = new RentriFormulariController(
      cerca as any,
      acquisisci as any,
      rilascia as any,
      unita as any,
      logger as any
    )

    await c.cerca(reqB)
    await c.aggancia('TV1', { modalita: 'NUOVO' } as any, user as any, reqB)
    await c.rilascia('fir-1', {} as any, user as any, reqB)

    expect(cerca.execute).toHaveBeenCalledWith('B')
    expect(unita.getPrincipale).toHaveBeenCalledTimes(2)
    expect(unita.getPrincipale).toHaveBeenCalledWith('B')
    expect(acquisisci.execute).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId: 'B', userId: 'u1', numIscrSito: 'SITO-B' })
    )
    expect(rilascia.execute).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId: 'B', userId: 'u1', numIscrSito: 'SITO-B' })
    )
  })

  it('unità locali: elenco e CRUD su B', async () => {
    const service = {
      listForTenant: jest.fn().mockResolvedValue([]),
      create: jest.fn().mockResolvedValue({}),
      update: jest.fn().mockResolvedValue({}),
      setPrincipale: jest.fn().mockResolvedValue({}),
      remove: jest.fn().mockResolvedValue(undefined),
    }
    const c = new RentriUnitaLocaleController(service as any)

    await c.list(reqB)
    await c.create({ numIscrSito: 'X' } as any, reqB)
    await c.update('ul', {} as any, reqB)
    await c.setPrincipale('ul', reqB)
    await c.remove('ul', reqB)

    expect(service.listForTenant).toHaveBeenCalledWith('B')
    expect(service.create).toHaveBeenCalledWith('B', expect.anything())
    expect(service.update).toHaveBeenCalledWith('B', 'ul', expect.anything())
    expect(service.setPrincipale).toHaveBeenCalledWith('B', 'ul')
    expect(service.remove).toHaveBeenCalledWith('B', 'ul')
  })

  it('credenziale: stato, rimozione e caricamento su B', async () => {
    const service = {
      getForTenant: jest.fn().mockResolvedValue(null),
      removeForTenant: jest.fn().mockResolvedValue(undefined),
      upsertForTenant: jest.fn().mockResolvedValue([]),
    }
    const modalita = { getForTenant: jest.fn().mockResolvedValue({ modalitaLegame: 'IBRIDA' }) }
    const c = new RentriCredentialController(service as any, modalita as any, {} as any)

    await c.status(reqB)
    await c.remove(reqB)
    // il PEM finto può essere rifiutato a monte: conta solo l'azienda usata se arriva al service
    await c
      .set({ clientId: 'c', certificatePem: 'x', privateKeyPem: 'k' } as any, reqB)
      .catch(() => undefined)

    expect(service.getForTenant).toHaveBeenCalledWith('B')
    expect(service.removeForTenant).toHaveBeenCalledWith('B')
    for (const call of service.upsertForTenant.mock.calls) expect(call[0]).toBe('B')
  })

  it('siti, modalità legame, diagnostica e allineamento codifiche usano B', async () => {
    const siti = { esegui: jest.fn().mockResolvedValue([]) }
    const modalita = {
      getForTenant: jest.fn().mockResolvedValue({}),
      setForTenant: jest.fn().mockResolvedValue({}),
    }
    const diagnostica = { execute: jest.fn().mockResolvedValue({}) }
    const sync = { allineaTutto: jest.fn().mockResolvedValue(undefined) }

    const cs = new RentriSitiController(siti as any)
    await cs.list(reqB)
    await cs.aggiorna(reqB)
    const m = new RentriModalitaLegameController(modalita as any)
    await m.get(reqB)
    await m.set({ modalitaLegame: 'IBRIDA' } as any, reqB)
    await new RentriDiagnosticaController(diagnostica as any).diagnostica(reqB)
    await new RentriCodificheController(sync as any, {} as any).allinea(reqB)

    expect(siti.esegui).toHaveBeenNthCalledWith(1, 'B')
    expect(siti.esegui).toHaveBeenNthCalledWith(2, 'B', { forza: true })
    expect(modalita.getForTenant).toHaveBeenCalledWith('B')
    expect(modalita.setForTenant).toHaveBeenCalledWith('B', 'IBRIDA')
    expect(diagnostica.execute).toHaveBeenCalledWith('B')
    expect(sync.allineaTutto).toHaveBeenCalledWith('B')
  })

  it('registro: tutte le azioni usano B e il ruolo effettivo in B (non quello del token)', async () => {
    const R = '7e7e7e7e-0000-4000-8000-000000000004'
    const M = '3b3b3b3b-0000-4000-8000-000000000006'
    const esitoAccodamento = {
      accodate: 1,
      riaccodate: 0,
      predecessori: 0,
      saltate: 0,
      saltatePerStato: {},
    }
    const accoda = {
      accoda: jest.fn().mockResolvedValue(esitoAccodamento),
      accodaStorico: jest.fn().mockResolvedValue(esitoAccodamento),
      togliDallaCoda: jest.fn().mockResolvedValue(undefined),
      dichiaraGiaSuRentri: jest.fn().mockResolvedValue({}),
    }
    const trasmetti = { trasmettiRegistro: jest.fn().mockResolvedValue({ esito: 'NIENTE' }) }
    const verifica = { verifica: jest.fn().mockResolvedValue({}) }
    const impostazioni = {
      leggi: jest.fn().mockResolvedValue([]),
      imposta: jest.fn().mockResolvedValue({}),
      allineamento: jest.fn().mockResolvedValue({}),
    }
    const dettaglio = { dettaglio: jest.fn().mockResolvedValue({}) }
    const credenziali = { haCredenziale: jest.fn().mockResolvedValue(true) }
    // Il token dice ADMIN nell'azienda A, ma in B l'utente ha un altro ruolo effettivo.
    const membership = { ruoloEffettivo: jest.fn().mockResolvedValue('ADMIN') }
    const c = new RentriRegistroController(
      accoda as any,
      trasmetti as any,
      verifica as any,
      impostazioni as any,
      dettaglio as any,
      credenziali as any,
      membership as any,
      logger as any
    )

    await c.registri(reqB)
    await c.imposta(R, { invioAutomatico: false }, reqB)
    await c.allineamento(R, { anno: 2026 }, reqB)
    await c.trasmettiOra({ registroId: R, movimentoIds: [M] }, reqB)
    await c.trasmettiStorico({ registroId: R, anno: 2025, conferma: true }, reqB)
    await c.togliDallaCoda(M, reqB)
    await c.verificaAnnotazione(M, reqB)
    await c.dichiara(
      { registroId: R, anno: 2026, daProgressivo: 1, aProgressivo: 2, motivo: 'm' },
      reqB
    )
    await c.dettaglioAnnotazione(M, reqB)

    for (const call of membership.ruoloEffettivo.mock.calls) expect(call[1]).toBe('B')
    expect(impostazioni.leggi).toHaveBeenCalledWith('B')
    expect(impostazioni.imposta).toHaveBeenCalledWith('B', 'u1', 'ADMIN', R, {
      invioAutomatico: false,
    })
    expect(impostazioni.allineamento).toHaveBeenCalledWith('B', R, 2026)
    expect(accoda.accoda).toHaveBeenCalledWith('B', 'u1', R, [M])
    expect(accoda.accodaStorico).toHaveBeenCalledWith('B', 'u1', R, 2025, true)
    expect(accoda.togliDallaCoda).toHaveBeenCalledWith('B', 'u1', M)
    expect(verifica.verifica).toHaveBeenCalledWith('B', 'u1', M)
    expect(accoda.dichiaraGiaSuRentri).toHaveBeenCalledWith('B', 'u1', 'ADMIN', R, 2026, 1, 2, 'm')
    expect(dettaglio.dettaglio).toHaveBeenCalledWith('B', M)
    expect(credenziali.haCredenziale).toHaveBeenCalledWith('B')
    expect(trasmetti.trasmettiRegistro).toHaveBeenCalledWith('B', R)

    // Senza azienda determinabile: 403 e nessuna azione.
    accoda.accoda.mockClear()
    await expect(
      c.trasmettiOra({ registroId: R, movimentoIds: [M] }, reqSenza)
    ).rejects.toBeInstanceOf(ForbiddenException)
    expect(accoda.accoda).not.toHaveBeenCalled()
  })

  it('senza azienda determinabile: 403 e nessuna lettura', async () => {
    const service = { listForTenant: jest.fn() }
    const c = new RentriUnitaLocaleController(service as any)

    await expect(c.list(reqSenza)).rejects.toBeInstanceOf(ForbiddenException)
    expect(service.listForTenant).not.toHaveBeenCalled()

    const sync = { allineaTutto: jest.fn() }
    await expect(
      new RentriCodificheController(sync as any, {} as any).allinea(reqSenza)
    ).rejects.toBeInstanceOf(ForbiddenException)
    expect(sync.allineaTutto).not.toHaveBeenCalled()
  })
})
