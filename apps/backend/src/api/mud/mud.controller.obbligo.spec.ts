import { ForbiddenException } from '@nestjs/common'
import { MudController } from './mud.controller'

/** Risoluzione del ruolo effettivo finta: restituisce sempre il ruolo indicato. */
const ruoli = (ruolo: string) => ({ ruoloEffettivo: jest.fn().mockResolvedValue(ruolo) })

const OBBLIGO = {
  mudNonDovuto: true,
  motivo: 'Meno di 10 dipendenti',
  impostatoIl: new Date('2026-03-02T09:00:00Z'),
  impostatoDa: 'u1',
}

describe('MudController obbligo del MUD (A-W-10)', () => {
  let obbligo: any

  beforeEach(() => {
    obbligo = {
      leggi: jest.fn().mockResolvedValue(OBBLIGO),
      imposta: jest.fn().mockResolvedValue(OBBLIGO),
    }
  })

  const controller = (ruolo: string, membership = ruoli(ruolo)) =>
    new MudController({} as any, {} as any, membership as any, obbligo)

  it("GET aperto a tutti: anche un VIEWER legge il flag dell'azienda selezionata", async () => {
    const membership = ruoli('VIEWER')
    const req = { tenantId: 'cliente', user: { id: 'u9', tenantId: 'studio', role: 'VIEWER' } }

    const r = await controller('VIEWER', membership).leggiObbligo(req as any)

    expect(obbligo.leggi).toHaveBeenCalledWith('cliente')
    expect(r).toEqual(OBBLIGO)
  })

  it('un ADMIN imposta il flag', async () => {
    const membership = ruoli('ADMIN')
    const req = { tenantId: 'cliente', user: { id: 'u1', tenantId: 'cliente', role: 'ADMIN' } }

    const r = await controller('ADMIN', membership).impostaObbligo(
      { mudNonDovuto: true, motivo: 'Meno di 10 dipendenti' },
      req as any
    )

    expect(membership.ruoloEffettivo).toHaveBeenCalledWith(req.user, 'cliente')
    expect(obbligo.imposta).toHaveBeenCalledWith('cliente', 'u1', true, 'Meno di 10 dipendenti')
    expect(r).toEqual(OBBLIGO)
  })

  it('senza motivo passa null al servizio', async () => {
    const req = { tenantId: 'cliente', user: { id: 'u1', tenantId: 'cliente', role: 'ADMIN' } }

    await controller('SUPER_ADMIN').impostaObbligo({ mudNonDovuto: false }, req as any)

    expect(obbligo.imposta).toHaveBeenCalledWith('cliente', 'u1', false, null)
  })

  it.each(['OPERATOR', 'VIEWER'])('un %s riceve 403', async ruolo => {
    const req = { tenantId: 'cliente', user: { id: 'u2', tenantId: 'cliente', role: ruolo } }

    const errore = await controller(ruolo)
      .impostaObbligo({ mudNonDovuto: true, motivo: 'Meno di 10 dipendenti' }, req as any)
      .catch(e => e)

    expect(errore).toBeInstanceOf(ForbiddenException)
    expect(errore.getResponse()).toEqual({
      message: "Solo un amministratore dell'azienda può modificare l'obbligo del MUD.",
      error: 'MUD_OBBLIGO_RISERVATO_AMMINISTRATORI',
    })
    expect(obbligo.imposta).not.toHaveBeenCalled()
  })

  it("decide sul ruolo nell'azienda selezionata, non su quello del token", async () => {
    // ADMIN del proprio studio, ma nell'azienda del cliente solo consultazione
    const membership = ruoli('VIEWER')
    const req = { tenantId: 'cliente', user: { id: 'u1', tenantId: 'studio', role: 'ADMIN' } }

    const errore = await controller('VIEWER', membership)
      .impostaObbligo({ mudNonDovuto: true, motivo: 'Meno di 10 dipendenti' }, req as any)
      .catch(e => e)

    expect(membership.ruoloEffettivo).toHaveBeenCalledWith(req.user, 'cliente')
    expect(errore).toBeInstanceOf(ForbiddenException)
    expect(obbligo.imposta).not.toHaveBeenCalled()
  })
})
