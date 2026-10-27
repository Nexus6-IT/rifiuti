import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common'
import {
  CausaliRegistroService,
  eGiornoValido,
  giornoPiuGiorni,
  validaCoerenza,
} from './causali-registro.service'
import type { PrismaService } from '../../../infrastructure/persistence/prisma.service'

const T = '11111111-1111-4111-8111-111111111111'
const U = '22222222-2222-4222-8222-222222222222'
const ID = '33333333-3333-4333-8333-333333333333'

function giorno(s: string): Date {
  return new Date(`${s}T00:00:00.000Z`)
}

interface Scenario {
  riga?: Record<string, unknown> | null
  uso?: { movimenti: number; ultimo: string | null }
  versioni?: Array<{
    id: string
    validaDal: string
    validaAl: string | null
    descrizione?: string
    ordine?: number
  }>
}

function costruisci(s: Scenario = {}) {
  const riga =
    s.riga === null
      ? null
      : {
          id: ID,
          codice: 'AZ_PROVA',
          verso: 'SCARICO',
          descrizione: 'Prova',
          ruolo_mud: 'AVVIATO',
          codice_rentri: 'aT',
          operazione: 'R',
          ordine: 100,
          valida_dal: giorno('2026-01-01'),
          valida_al: null,
          ...(s.riga ?? {}),
        }
  const tx: any = {
    $executeRaw: jest.fn().mockResolvedValue(1),
    $queryRaw: jest.fn(async (strings: TemplateStringsArray) => {
      const sql = strings.join('?')
      if (sql.includes('FROM causali_registro_azienda c')) {
        return s.uso && riga
          ? [
              {
                id: ID,
                movimenti: s.uso.movimenti,
                ultimo_giorno_uso: s.uso.ultimo ? giorno(s.uso.ultimo) : null,
              },
            ]
          : []
      }
      return riga ? [riga] : []
    }),
    causaleRegistroAzienda: {
      count: jest.fn().mockResolvedValue(0),
      create: jest.fn(async ({ data }: any) => ({ id: 'nuova', ...data })),
      update: jest.fn().mockResolvedValue({}),
      delete: jest.fn().mockResolvedValue({}),
      findMany: jest.fn(async () =>
        (s.versioni ?? []).map(v => ({
          id: v.id,
          descrizione: v.descrizione ?? 'Prova',
          ordine: v.ordine ?? 100,
          validaDal: giorno(v.validaDal),
          validaAl: v.validaAl ? giorno(v.validaAl) : null,
        }))
      ),
    },
    activityLog: { create: jest.fn().mockResolvedValue({}) },
  }
  const prisma = { $transaction: jest.fn(async (fn: any) => fn(tx)) } as unknown as PrismaService
  return { service: new CausaliRegistroService(prisma), tx }
}

const base = {
  codice: 'AZ_PROVA',
  verso: 'SCARICO' as const,
  descrizione: 'Prova',
  ruoloMud: 'AVVIATO' as const,
}

async function esito(p: Promise<unknown>): Promise<any> {
  try {
    await p
    return null
  } catch (e) {
    return e
  }
}

describe('regole pure', () => {
  it('eGiornoValido riconosce solo giorni che esistono', () => {
    expect(eGiornoValido('2026-02-28')).toBe(true)
    expect(eGiornoValido('2026-02-31')).toBe(false)
    expect(eGiornoValido('2026-2-1')).toBe(false)
    expect(eGiornoValido(20260101)).toBe(false)
  })

  it('giornoPiuGiorni passa il confine di mese e anno', () => {
    expect(giornoPiuGiorni('2026-03-01', -1)).toBe('2026-02-28')
    expect(giornoPiuGiorni('2026-12-31', 1)).toBe('2027-01-01')
  })

  it('validaCoerenza: ruolo, RENTRI e operazione per verso', () => {
    const ok = {
      verso: 'SCARICO',
      ruoloMud: 'AVVIATO',
      codiceRentri: 'aT',
      operazione: 'R',
    } as const
    expect(() => validaCoerenza(ok)).not.toThrow()
    expect(() => validaCoerenza({ ...ok, verso: 'CARICO', operazione: null })).toThrow(
      BadRequestException
    )
    expect(() => validaCoerenza({ ...ok, codiceRentri: 'DT' })).toThrow(/RENTRI/)
    expect(() => validaCoerenza({ ...ok, codiceRentri: 'TR' })).toThrow(/RENTRI/)
    expect(() => validaCoerenza({ ...ok, ruoloMud: 'ESCLUSO' })).toThrow(/R\/D/)
    expect(() => validaCoerenza({ ...ok, operazione: 'X' })).toThrow(/R\/D/)
    expect(() =>
      validaCoerenza({ verso: 'CARICO', ruoloMud: 'PRODOTTO', codiceRentri: 'DT', operazione: 'R' })
    ).toThrow(/R\/D/)
  })
})

describe('CausaliRegistroService.crea: validazione', () => {
  it.each([
    ['senza prefisso', { codice: 'PROVA' }],
    ['prefisso solo', { codice: 'AZ_' }],
    ['minuscole', { codice: 'AZ_prova' }],
    ['un solo carattere dopo il prefisso', { codice: 'AZ_A' }],
    ['troppo lungo', { codice: 'AZ_' + 'A'.repeat(41) }],
    ['verso sbagliato', { verso: 'ALTRO' as never }],
    ['descrizione vuota', { descrizione: '  ' }],
    ['descrizione lunga', { descrizione: 'x'.repeat(201) }],
    ['ruolo incoerente col verso', { ruoloMud: 'PRODOTTO' as const }],
    ['codice RENTRI di un altro verso', { codiceRentri: 'DT' }],
    ['operazione senza AVVIATO', { ruoloMud: 'ESCLUSO' as const, operazione: 'R' }],
    ['ordine non intero', { ordine: 1.5 }],
    ['data inesistente', { validaDal: '2026-02-31' }],
    ['data oltre i 365 giorni', { validaDal: '2099-01-01' }],
  ])('400: %s', async (_nome, variante) => {
    const { service, tx } = costruisci()
    const e = await esito(service.crea(T, U, { ...base, ...variante }))
    expect(e).toBeInstanceOf(BadRequestException)
    expect(tx.causaleRegistroAzienda.create).not.toHaveBeenCalled()
  })

  it('una causale gia presente per la coppia -> 409 CAUSALE_ESISTENTE', async () => {
    const { service, tx } = costruisci()
    tx.causaleRegistroAzienda.count.mockResolvedValue(1)
    const e = await esito(service.crea(T, U, base))
    expect(e).toBeInstanceOf(ConflictException)
    expect(e.getResponse().error).toBe('CAUSALE_ESISTENTE')
  })

  it('crea con default: ordine 100, validaDal oggi, RENTRI e operazione null; audit e lock', async () => {
    const { service, tx } = costruisci()
    const v = await service.crea(T, U, { ...base, ruoloMud: 'ESCLUSO' })
    expect(v.ordine).toBe(100)
    expect(v.codiceRentri).toBeNull()
    expect(v.operazione).toBeNull()
    expect(v.validaAl).toBeNull()
    expect(eGiornoValido(v.validaDal)).toBe(true)
    expect(tx.$executeRaw).toHaveBeenCalledTimes(1)
    expect(tx.activityLog.create.mock.calls[0][0].data.action).toBe('REGISTRO_CAUSALE_CREATA')
  })
})

describe('CausaliRegistroService.modifica: assente contro null', () => {
  it('null su descrizione, ruoloMud, ordine, validaDal -> 400', async () => {
    for (const patch of [
      { descrizione: null },
      { ruoloMud: null },
      { ordine: null },
      { validaDal: null },
    ]) {
      const { service } = costruisci()
      const e = await esito(service.modifica(T, U, ID, patch as never))
      expect(e).toBeInstanceOf(BadRequestException)
    }
  })

  it('codiceRentri: null azzera, campo assente lascia invariato', async () => {
    const a = costruisci()
    const azzera = await a.service.modifica(T, U, ID, { codiceRentri: null })
    expect(azzera.codiceRentri).toBeNull()
    expect(a.tx.causaleRegistroAzienda.update.mock.calls[0][0].data.codiceRentri).toBeNull()

    const b = costruisci()
    const invariato = await b.service.modifica(T, U, ID, { descrizione: 'Nuova' })
    expect(invariato.codiceRentri).toBe('aT')
    expect(invariato.operazione).toBe('R')
    expect(invariato.descrizione).toBe('Nuova')
  })

  it('il record risultante deve essere coerente (ruolo ESCLUSO con operazione R rimasta) -> 400', async () => {
    const { service, tx } = costruisci()
    const e = await esito(service.modifica(T, U, ID, { ruoloMud: 'ESCLUSO' }))
    expect(e).toBeInstanceOf(BadRequestException)
    expect(e.message).toBe(
      "L'operazione R/D vale solo per gli scarichi avviati a recupero o smaltimento."
    )
    expect(tx.causaleRegistroAzienda.update).not.toHaveBeenCalled()
  })

  it('ruolo ESCLUSO insieme a operazione null e RENTRI null e coerente', async () => {
    const { service } = costruisci()
    const v = await service.modifica(T, U, ID, {
      ruoloMud: 'ESCLUSO',
      operazione: null,
      codiceRentri: null,
    })
    expect(v.ruoloMud).toBe('ESCLUSO')
  })

  it('versione usata: cambiare il ruolo -> 409 CAUSALE_USATA_NUOVA_VERSIONE; la descrizione si', async () => {
    const a = costruisci({ uso: { movimenti: 2, ultimo: '2026-05-01' } })
    const e = await esito(a.service.modifica(T, U, ID, { ruoloMud: 'ESCLUSO', operazione: null }))
    expect(e).toBeInstanceOf(ConflictException)
    expect(e.getResponse().error).toBe('CAUSALE_USATA_NUOVA_VERSIONE')

    const b = costruisci({ uso: { movimenti: 2, ultimo: '2026-05-01' } })
    await expect(
      b.service.modifica(T, U, ID, { descrizione: 'Solo testo', ordine: 5 })
    ).resolves.toBeDefined()
    // un valore uguale all'attuale non e' un cambiamento
    const c = costruisci({ uso: { movimenti: 2, ultimo: '2026-05-01' } })
    await expect(c.service.modifica(T, U, ID, { ruoloMud: 'AVVIATO' })).resolves.toBeDefined()
  })

  it('id inesistente o di un altro tenant -> 404', async () => {
    const { service } = costruisci({ riga: null })
    expect(await esito(service.modifica(T, U, ID, { descrizione: 'x' }))).toBeInstanceOf(
      NotFoundException
    )
  })

  it('data di inizio dopo la fine -> 400', async () => {
    const { service } = costruisci({ riga: { valida_al: giorno('2026-03-01') } })
    const e = await esito(service.modifica(T, U, ID, { validaDal: '2026-04-01' }))
    expect(e).toBeInstanceOf(BadRequestException)
  })
})

describe('CausaliRegistroService.nuovaVersione', () => {
  const dati = { validaDal: '2026-06-01', ruoloMud: 'ESCLUSO' as const }

  it('da una versione che non e l ultima -> 409 CAUSALE_NON_ULTIMA_VERSIONE', async () => {
    const { service } = costruisci({
      versioni: [
        { id: ID, validaDal: '2026-01-01', validaAl: '2026-05-31' },
        { id: 'altra', validaDal: '2026-06-01', validaAl: null },
      ],
    })
    const e = await esito(service.nuovaVersione(T, U, ID, { ...dati, validaDal: '2026-09-01' }))
    expect(e.getResponse().error).toBe('CAUSALE_NON_ULTIMA_VERSIONE')
  })

  it('prima l UPDATE di chiusura a validaDal-1, poi l INSERT; RENTRI e operazione NULL, descrizione e ordine copiati', async () => {
    const { service, tx } = costruisci({
      versioni: [
        { id: ID, validaDal: '2026-01-01', validaAl: null, descrizione: 'Vecchia', ordine: 7 },
      ],
      uso: { movimenti: 1, ultimo: '2026-03-10' },
    })
    const v = await service.nuovaVersione(T, U, ID, dati)
    expect(tx.causaleRegistroAzienda.update.mock.calls[0][0].data.validaAl).toEqual(
      giorno('2026-05-31')
    )
    const ordineUpdate = tx.causaleRegistroAzienda.update.mock.invocationCallOrder[0]
    const ordineCreate = tx.causaleRegistroAzienda.create.mock.invocationCallOrder[0]
    expect(ordineUpdate).toBeLessThan(ordineCreate)
    expect(v.codiceRentri).toBeNull()
    expect(v.operazione).toBeNull()
    expect(v.descrizione).toBe('Vecchia')
    expect(v.ordine).toBe(7)
    expect(tx.activityLog.create.mock.calls[0][0].data.action).toBe('REGISTRO_CAUSALE_VERSIONATA')
  })

  it('chiusura prima dell ultimo uso -> 409 con la prima data ammessa', async () => {
    const { service, tx } = costruisci({
      versioni: [{ id: ID, validaDal: '2026-01-01', validaAl: null }],
      uso: { movimenti: 1, ultimo: '2026-06-10' },
    })
    const e = await esito(service.nuovaVersione(T, U, ID, dati))
    expect(e.getResponse().error).toBe('CAUSALE_DATA_PRIMA_DELL_ULTIMO_USO')
    expect(e.getResponse().message).toContain('11/06/2026')
    expect(tx.causaleRegistroAzienda.update).not.toHaveBeenCalled()
  })

  it('data non dopo l inizio della versione attuale -> 400', async () => {
    const { service } = costruisci({
      versioni: [{ id: ID, validaDal: '2026-06-01', validaAl: null }],
    })
    expect(await esito(service.nuovaVersione(T, U, ID, dati))).toBeInstanceOf(BadRequestException)
  })

  it('precedente gia chiusa: la nuova deve iniziare dopo la fine, altrimenti 409 CAUSALE_SOVRAPPOSTA', async () => {
    const { service, tx } = costruisci({
      versioni: [{ id: ID, validaDal: '2026-01-01', validaAl: '2026-07-31' }],
    })
    const e = await esito(service.nuovaVersione(T, U, ID, { ...dati, validaDal: '2026-07-31' }))
    expect(e.getResponse().error).toBe('CAUSALE_SOVRAPPOSTA')
    await service.nuovaVersione(T, U, ID, { ...dati, validaDal: '2026-08-01' })
    expect(tx.causaleRegistroAzienda.update).not.toHaveBeenCalled()
  })

  it('ruolo obbligatorio e coerente', async () => {
    const { service } = costruisci({
      versioni: [{ id: ID, validaDal: '2026-01-01', validaAl: null }],
    })
    expect(
      await esito(service.nuovaVersione(T, U, ID, { validaDal: '2026-06-01' } as never))
    ).toBeInstanceOf(BadRequestException)
    expect(
      await esito(service.nuovaVersione(T, U, ID, { ...dati, ruoloMud: 'PRODOTTO' }))
    ).toBeInstanceOf(BadRequestException)
  })
})

describe('CausaliRegistroService.chiudi ed elimina', () => {
  it('chiusura prima dell inizio -> 400; prima dell ultimo uso -> 409', async () => {
    const a = costruisci()
    expect(await esito(a.service.chiudi(T, U, ID, '2025-12-31'))).toBeInstanceOf(
      BadRequestException
    )
    const b = costruisci({ uso: { movimenti: 3, ultimo: '2026-05-10' } })
    const e = await esito(b.service.chiudi(T, U, ID, '2026-05-09'))
    expect(e.getResponse().error).toBe('CAUSALE_DATA_PRIMA_DELL_ULTIMO_USO')
    await expect(b.service.chiudi(T, U, ID, '2026-05-10')).resolves.toMatchObject({
      validaAl: '2026-05-10',
    })
  })

  it('data di fine non valida -> 400', async () => {
    const { service } = costruisci()
    expect(await esito(service.chiudi(T, U, ID, '2026-13-01'))).toBeInstanceOf(BadRequestException)
  })

  it('elimina: usata -> 409 CAUSALE_USATA_NON_ELIMINABILE, non usata -> ok con audit', async () => {
    const a = costruisci({ uso: { movimenti: 1, ultimo: '2026-02-01' } })
    const e = await esito(a.service.elimina(T, U, ID))
    expect(e.getResponse().error).toBe('CAUSALE_USATA_NON_ELIMINABILE')
    expect(a.tx.causaleRegistroAzienda.delete).not.toHaveBeenCalled()

    const b = costruisci()
    await b.service.elimina(T, U, ID)
    expect(b.tx.causaleRegistroAzienda.delete).toHaveBeenCalledWith({ where: { id: ID } })
    expect(b.tx.activityLog.create.mock.calls[0][0].data.action).toBe('REGISTRO_CAUSALE_ELIMINATA')
  })
})

describe('CausaliRegistroService: errori del database', () => {
  it('una violazione del trigger non espone il testo del database', async () => {
    const { Prisma } = jest.requireActual('@prisma/client')
    const { service, tx } = costruisci()
    tx.causaleRegistroAzienda.update.mockRejectedValue(
      new Prisma.PrismaClientUnknownRequestError('causali_registro_azienda: testo interno', {
        clientVersion: 'x',
      })
    )
    const e = await esito(service.chiudi(T, U, ID, '2026-12-31'))
    expect(e).toBeInstanceOf(BadRequestException)
    expect(e.message).toBe('I dati della causale non sono validi.')
  })

  it('un errore qualunque non riconosciuto passa invariato', async () => {
    const { service, tx } = costruisci()
    tx.causaleRegistroAzienda.update.mockRejectedValue(new Error('boom'))
    expect((await esito(service.chiudi(T, U, ID, '2026-12-31'))).message).toBe('boom')
  })
})

describe('CausaliRegistroService: disattivazione', () => {
  function conSistema(esistente: unknown) {
    const c = costruisci()
    c.tx.causaleRegistro = { findFirst: jest.fn() }
    c.tx.causaleRegistroAzienda.findFirst = jest.fn().mockResolvedValue(esistente)
    c.tx.causaleRegistroAzienda.deleteMany = jest
      .fn()
      .mockResolvedValue({ count: esistente ? 1 : 0 })
    return c
  }

  it('codice di sistema inesistente -> 404', async () => {
    const c = conSistema(null)
    c.tx.causaleRegistro.findFirst.mockResolvedValue(null)
    expect(await esito(c.service.disattiva(T, U, 'SCARICO', 'NON_ESISTE'))).toBeInstanceOf(
      NotFoundException
    )
  })

  it('gia disattivata: nessuna scrittura (idempotente)', async () => {
    const c = conSistema({ id: 'x' })
    c.tx.causaleRegistro.findFirst.mockResolvedValue({ codice: 'CESSIONE' })
    await c.service.disattiva(T, U, 'SCARICO', 'CESSIONE')
    expect(c.tx.causaleRegistroAzienda.create).not.toHaveBeenCalled()
  })

  it('riattiva senza disattivazione: nessun audit', async () => {
    const c = conSistema(null)
    c.tx.causaleRegistro.findFirst.mockResolvedValue({ codice: 'CESSIONE' })
    await c.service.riattiva(T, U, 'SCARICO', 'CESSIONE')
    expect(c.tx.activityLog.create).not.toHaveBeenCalled()
  })
})
