import 'reflect-metadata'
import { ForbiddenException } from '@nestjs/common'
import { plainToInstance } from 'class-transformer'
import { validate } from 'class-validator'
import { MudController } from './mud.controller'
import { ROLES_KEY } from '../../auth/decorators/roles.decorator'
import { IntegrazioniMudDto } from './dtos/integrazioni-mud.dto'
import { INTEGRAZIONI_VUOTE } from '../../application/mud/aggregazione/mud-integrazioni'

describe('MudController integrazioni del MUD', () => {
  const controllerCon = (ruolo: string, integrazioni: any) =>
    new MudController(
      {} as any,
      {} as any,
      { ruoloEffettivo: jest.fn().mockResolvedValue(ruolo) } as any,
      {} as any,
      {} as any,
      integrazioni
    )
  const vuoto = { destinatari: [], pesiSpecifici: [], destinatariMovimento: [], trasportatori: [] }

  // (confutazione dopo l'esecuzione, A-C-06): ruolo effettivo nell'azienda selezionata
  it('solo chi è ADMIN o SUPER_ADMIN nell azienda selezionata può modificare le integrazioni', async () => {
    const membership = { ruoloEffettivo: jest.fn().mockResolvedValue('OPERATOR') }
    const integrazioni = {
      salva: jest.fn(),
      leggi: jest.fn().mockResolvedValue(INTEGRAZIONI_VUOTE),
      codiciAzienda: jest.fn().mockResolvedValue(['01234567897']),
      etichetteRegistri: jest.fn().mockResolvedValue({ r1: 'Sede A', r2: 'Sede B' }),
      etichetteUnitaLocali: jest.fn().mockResolvedValue({}),
    }
    const controller = new MudController(
      {} as any,
      {} as any,
      membership as any,
      {} as any,
      {} as any,
      integrazioni as any
    )
    const req = { user: { id: 'u1', tenantId: 't1', role: 'ADMIN' } } as any // ADMIN globale, OPERATOR qui

    const errore = await controller.salvaIntegrazioni(req, 2025, vuoto).catch(e => e)
    expect(errore).toBeInstanceOf(ForbiddenException)
    expect(errore.getResponse()).toEqual({
      message: "Solo un amministratore dell'azienda può modificare le integrazioni del MUD.",
      error: 'MUD_INTEGRAZIONI_RISERVATE_AMMINISTRATORI',
    })
    expect(membership.ruoloEffettivo).toHaveBeenCalledWith(req.user, 't1')
    expect(integrazioni.salva).not.toHaveBeenCalled()
    // lettura aperta, con i codici dell'azienda per la conferma della pagina (A-W-13)
    await expect(controller.leggiIntegrazioni(req, 2025)).resolves.toEqual({
      ...INTEGRAZIONI_VUOTE,
      codiciAzienda: ['01234567897'],
      registri: { r1: 'Sede A', r2: 'Sede B' },
      unitaLocali: {},
    })
    expect(integrazioni.leggi).toHaveBeenCalledWith('t1', 2025)
    expect(integrazioni.codiciAzienda).toHaveBeenCalledWith('t1')
    expect(
      Reflect.getMetadata(ROLES_KEY, MudController.prototype.salvaIntegrazioni)
    ).toBeUndefined()
  })

  it('il GET restituisce le unità locali', async () => {
    const integrazioni = {
      leggi: jest.fn().mockResolvedValue(INTEGRAZIONI_VUOTE),
      codiciAzienda: jest.fn().mockResolvedValue([]),
      etichetteRegistri: jest.fn().mockResolvedValue({}),
      etichetteUnitaLocali: jest.fn().mockResolvedValue({ 'ul-1': 'Sede di Milano' }),
    }
    const controller = controllerCon('VIEWER', integrazioni)
    const r = await controller.leggiIntegrazioni(
      { user: { id: 'u1', tenantId: 't1' } } as any,
      2025
    )
    expect(r.unitaLocali).toEqual({ 'ul-1': 'Sede di Milano' })
    expect(integrazioni.etichetteUnitaLocali).toHaveBeenCalledWith('t1')
  })

  it('un VIEWER nell azienda selezionata non salva le integrazioni (403)', async () => {
    const integrazioni = { salva: jest.fn() }
    const controller = controllerCon('VIEWER', integrazioni)

    const errore = await controller
      .salvaIntegrazioni({ user: { id: 'u1', tenantId: 't1' } } as any, 2025, vuoto)
      .catch(e => e)

    expect(errore).toBeInstanceOf(ForbiddenException)
    expect(errore.getResponse().error).toBe('MUD_INTEGRAZIONI_RISERVATE_AMMINISTRATORI')
    expect(integrazioni.salva).not.toHaveBeenCalled()
  })

  it.each(['ADMIN', 'SUPER_ADMIN'])(
    '%s nell azienda selezionata salva con tenant e utente',
    async ruolo => {
      const integrazioni = { salva: jest.fn().mockResolvedValue(INTEGRAZIONI_VUOTE) }
      const controller = controllerCon(ruolo, integrazioni)

      await controller.salvaIntegrazioni({ user: { id: 'u1', tenantId: 't1' } } as any, 2025, vuoto)

      expect(integrazioni.salva).toHaveBeenCalledWith('t1', 2025, 'u1', vuoto)
    }
  )

  describe('IntegrazioniMudDto', () => {
    const errori = async (corpo: unknown) => {
      const dto = plainToInstance(IntegrazioniMudDto, corpo)
      return { dto, errori: await validate(dto) }
    }
    const proprietaConErrore = (e: any[]): string[] =>
      e.flatMap(x => (x.children?.length ? proprietaConErrore(x.children) : [x.property]))

    it('rifiuta un CF di 10 cifre e un peso specifico negativo', async () => {
      const { errori: e } = await errori({
        destinatari: [{ ragioneSociale: 'Ecologia Srl', codiceFiscale: '1234567890' }],
        pesiSpecifici: [{ cerCode: '170405', unita: 'litri', kgPerUnita: -1 }],
      })
      expect(proprietaConErrore(e).sort()).toEqual(['codiceFiscale', 'kgPerUnita'])
    })

    it('normalizza il CF: maiuscolo, senza spazi e senza il prefisso IT', async () => {
      const { dto, errori: e } = await errori({
        destinatari: [{ ragioneSociale: 'Ecologia Srl', codiceFiscale: 'rssmra80a01h501u' }],
        pesiSpecifici: [],
        trasportatori: [{ ragioneSociale: 'Trasporti Srl', codiceFiscale: 'IT 12345678903' }],
      })
      expect(e).toEqual([])
      expect(dto.destinatari[0].codiceFiscale).toBe('RSSMRA80A01H501U')
      expect(dto.trasportatori![0].codiceFiscale).toBe('12345678903')
    })

    // preflight F32: le liste nuove sono facoltative
    it('destinatari dei movimenti e trasportatori sono facoltativi', async () => {
      const { errori: e } = await errori({ destinatari: [], pesiSpecifici: [] })
      expect(e).toEqual([])
    })

    // (confutazione dopo l'esecuzione, A-W-05)
    it('con la nazione il CF può mancare', async () => {
      const { errori: e } = await errori({
        destinatari: [{ ragioneSociale: 'Recycling GmbH', codiceFiscale: '', nazione: 'Germania' }],
        pesiSpecifici: [],
      })
      expect(e).toEqual([])
    })

    it('il destinatario del movimento richiede la ragione sociale e un numero valido', async () => {
      const { errori: e } = await errori({
        destinatari: [],
        pesiSpecifici: [],
        destinatariMovimento: [
          { anno: 2025, numero: 0, ragioneSociale: '', codiceFiscale: '12345678903' },
        ],
      })
      expect(proprietaConErrore(e).sort()).toEqual(['numero', 'ragioneSociale'])
    })

    // preflight F36: nessuna regex di cifre sul CER nel DTO
    it('il CER del peso specifico non si controlla nel DTO', async () => {
      const { errori: e } = await errori({
        destinatari: [],
        pesiSpecifici: [{ cerCode: '17 04 05*', unita: 'litri', kgPerUnita: 1.1 }],
      })
      expect(e).toEqual([])
    })
  })
})
