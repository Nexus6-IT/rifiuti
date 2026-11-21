/**
 * Avviso push «giro modificato» agganciato al servizio dei ritiri (app campo, P7), contro un
 * Postgres reale COME `wasteflow_app`. La porta e' finta: qui si prova QUANDO si avvisa e chi,
 * l'invio vero e' in `application/campo/push-campo.postgres.spec.ts`.
 */
import { PrismaClient } from '@prisma/client'
import { urlComeRuolo } from '../../infrastructure/database/client-come-ruolo'

const urlProprietario =
  process.env.DATABASE_URL ??
  'postgresql://wasteflow:wasteflow_ci@127.0.0.1:55438/wasteflow_ci?schema=public'
process.env.DATABASE_URL = urlComeRuolo(
  'wasteflow_app',
  process.env.DB_APP_PASSWORD ?? 'wasteflow_app_dev',
  urlProprietario
)

import { TenantContext } from '../../core/context/tenant-context'
import { ICERRepository } from '../../domain/cer/repositories/cer-repository.interface'
import {
  PrismaService,
  creaPrismaServiceApplicativo,
} from '../../infrastructure/persistence/prisma.service'
import { RitiriRepository } from '../../infrastructure/persistence/ritiri.repository'
import { cancellaAziendeDiProva } from '../../test-support/cancella-azienda-di-prova'
import { creaAziendaCampo, type AziendaCampo } from '../../test-support/campo-di-test'
import type { NotificaGiroPorta } from './notifica-giro.porta'
import { RitiriService } from './ritiri.service'
import type { NuovoRitiro } from './ritiri.tipi'

const giornoRoma = (spostamentoGiorni: number): string => {
  const d = new Date(Date.now() + spostamentoGiorni * 86_400_000)
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Rome',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(d)
}

describe('Ritiri e avviso push — Postgres reale, ruolo wasteflow_app', () => {
  const owner = new PrismaClient({ datasourceUrl: urlProprietario })
  let app: PrismaService
  const creati: string[] = []
  const cerFinto = {
    exists: async () => true,
    isUtilizzabilePerNuovoFormulario: async () => true,
  } as unknown as ICERRepository

  const azienda = async (): Promise<AziendaCampo> => {
    const a = await creaAziendaCampo(owner)
    creati.push(a.t)
    return a
  }
  const nelTenant = <R>(t: string, fn: () => Promise<R>) =>
    TenantContext.run({ tenantId: t }, async () => await fn())
  const fineCoda = () => new Promise<void>(r => setImmediate(r))

  function porta(esito: 'ok' | 'rifiuta' | 'lancia' = 'ok') {
    const chiamate: Array<{ tenantId: string; autistaIds: string[] }> = []
    const p: NotificaGiroPorta = {
      notificaGiroModificato(tenantId, autistaIds) {
        chiamate.push({ tenantId, autistaIds: [...autistaIds].sort() })
        if (esito === 'lancia') throw new Error('guasto sincrono')
        return esito === 'rifiuta' ? Promise.reject(new Error('guasto')) : Promise.resolve()
      },
    }
    return { p, chiamate }
  }
  const servizio = (p?: NotificaGiroPorta) =>
    new RitiriService(app, new RitiriRepository(), cerFinto, p)

  const nuovo = (a: AziendaCampo, extra: Partial<NuovoRitiro> = {}): NuovoRitiro => ({
    dataPrevista: giornoRoma(0),
    produttoreId: a.produttore,
    produttoreSedeId: a.produttoreSede,
    trasportatoreId: a.trasportatore,
    destinatarioId: a.destinatario,
    destinatarioSedeId: a.destinatarioSede,
    cerCode: '200301',
    descrizione: 'Rifiuti urbani non differenziati',
    quantitaPresunta: '100',
    codiceOperazione: 'R13',
    provenienza: 'SPECIALE' as const,
    tipoTratta: 'TERRESTRE' as const,
    autistaId: a.autista1,
    chiaveIdempotenza: crypto.randomUUID(),
    ...extra,
  })

  beforeAll(async () => {
    app = creaPrismaServiceApplicativo()
    await app.onModuleInit()
  })

  afterAll(async () => {
    for (const t of creati) {
      try {
        await cancellaAziendeDiProva(owner, t)
      } catch (e) {
        console.error(`pulizia notifica giro: azienda ${t} non cancellata`, e)
      }
    }
    await owner.$disconnect()
    await app.$disconnect()
  })

  it('un ritiro creato per oggi avvisa il suo autista; uno per fra un mese o senza autista no', async () => {
    const a = await azienda()
    const { p, chiamate } = porta()
    const s = servizio(p)
    await nelTenant(a.t, () => s.crea(a.t, a.admin, nuovo(a)))
    await fineCoda()
    expect(chiamate).toEqual([{ tenantId: a.t, autistaIds: [a.autista1] }])
    await nelTenant(a.t, () => s.crea(a.t, a.admin, nuovo(a, { dataPrevista: giornoRoma(30) })))
    await nelTenant(a.t, () => s.crea(a.t, a.admin, nuovo(a, { autistaId: undefined })))
    await fineCoda()
    expect(chiamate).toHaveLength(1)
  })

  it('domani si, dopodomani no', async () => {
    const a = await azienda()
    const { p, chiamate } = porta()
    const s = servizio(p)
    await nelTenant(a.t, () => s.crea(a.t, a.admin, nuovo(a, { dataPrevista: giornoRoma(1) })))
    await nelTenant(a.t, () => s.crea(a.t, a.admin, nuovo(a, { dataPrevista: giornoRoma(2) })))
    await fineCoda()
    expect(chiamate).toHaveLength(1)
  })

  it('un reinvio con la stessa chiave (giaRegistrato) non avvisa di nuovo', async () => {
    const a = await azienda()
    const { p, chiamate } = porta()
    const s = servizio(p)
    const dati = nuovo(a)
    await nelTenant(a.t, () => s.crea(a.t, a.admin, dati))
    const bis = await nelTenant(a.t, () => s.crea(a.t, a.admin, dati))
    await fineCoda()
    expect(bis.giaRegistrato).toBe(true)
    expect(chiamate).toHaveLength(1)
  })

  it('modifica che cambia autista avvisa vecchio e nuovo; una modifica fuori dal giro non avvisa', async () => {
    const a = await azienda()
    const { p, chiamate } = porta()
    const s = servizio(p)
    const { ritiri } = await nelTenant(a.t, () => s.crea(a.t, a.admin, nuovo(a)))
    await fineCoda()
    chiamate.length = 0
    const r = ritiri[0]
    await nelTenant(a.t, () =>
      s.modifica(a.t, r.id, { ...nuovo(a, { autistaId: a.autista2 }), versione: r.versione })
    )
    await fineCoda()
    expect(chiamate).toEqual([{ tenantId: a.t, autistaIds: [a.autista1, a.autista2].sort() }])

    // Sposto lontano nel tempo: l'autista di oggi va comunque avvisato (il suo giro e' cambiato).
    chiamate.length = 0
    const r2 = await nelTenant(a.t, () => s.dettaglio(a.t, r.id))
    await nelTenant(a.t, () =>
      s.modifica(a.t, r.id, {
        ...nuovo(a, { autistaId: a.autista2, dataPrevista: giornoRoma(40) }),
        versione: r2.versione,
      })
    )
    await fineCoda()
    expect(chiamate).toEqual([{ tenantId: a.t, autistaIds: [a.autista2] }])

    // Ora e fuori dal giro sia prima sia dopo: nessun avviso.
    chiamate.length = 0
    const r3 = await nelTenant(a.t, () => s.dettaglio(a.t, r.id))
    await nelTenant(a.t, () =>
      s.modifica(a.t, r.id, {
        ...nuovo(a, { autistaId: a.autista2, dataPrevista: giornoRoma(41) }),
        versione: r3.versione,
      })
    )
    await fineCoda()
    expect(chiamate).toHaveLength(0)
  })

  it('una modifica che cambia solo le note interne non avvisa', async () => {
    const a = await azienda()
    const { p, chiamate } = porta()
    const s = servizio(p)
    const { ritiri } = await nelTenant(a.t, () => s.crea(a.t, a.admin, nuovo(a)))
    await fineCoda()
    chiamate.length = 0
    await nelTenant(a.t, () =>
      s.modifica(a.t, ritiri[0].id, {
        ...nuovo(a, { noteInterne: 'telefonare prima' }),
        versione: ritiri[0].versione,
      })
    )
    await fineCoda()
    expect(chiamate).toHaveLength(0)
  })

  it('una porta lenta (promessa mai risolta) non ritarda la risposta del ritiro', async () => {
    const a = await azienda()
    const s = servizio({ notificaGiroModificato: () => new Promise<never>(() => undefined) })
    const r = await Promise.race([
      nelTenant(a.t, () => s.crea(a.t, a.admin, nuovo(a))),
      new Promise<'lento'>(res => setTimeout(() => res('lento'), 5000)),
    ])
    expect(r).not.toBe('lento')
  })

  it('annulla, non eseguito e riprogramma del giro di oggi avvisano', async () => {
    const a = await azienda()
    const { p, chiamate } = porta()
    const s = servizio(p)
    const crea = async () => (await nelTenant(a.t, () => s.crea(a.t, a.admin, nuovo(a)))).ritiri[0]
    const r1 = await crea()
    const r2 = await crea()
    await fineCoda()
    chiamate.length = 0
    await nelTenant(a.t, () => s.annulla(a.t, a.admin, r1.id, 'Cliente chiuso', r1.versione))
    const ne = await nelTenant(a.t, () => s.nonEseguito(a.t, r2.id, 'Mezzo fermo', r2.versione))
    await fineCoda()
    expect(chiamate).toHaveLength(2)
    chiamate.length = 0
    await nelTenant(a.t, () => s.riprogramma(a.t, r2.id, giornoRoma(1), ne.versione))
    await fineCoda()
    expect(chiamate).toEqual([{ tenantId: a.t, autistaIds: [a.autista1] }])
  })

  it('una scrittura rifiutata (versione sbagliata) non avvisa nessuno', async () => {
    const a = await azienda()
    const { p, chiamate } = porta()
    const s = servizio(p)
    const { ritiri } = await nelTenant(a.t, () => s.crea(a.t, a.admin, nuovo(a)))
    await fineCoda()
    chiamate.length = 0
    await expect(
      nelTenant(a.t, () => s.annulla(a.t, a.admin, ritiri[0].id, 'Prova', ritiri[0].versione + 7))
    ).rejects.toThrow()
    await fineCoda()
    expect(chiamate).toHaveLength(0)
  })

  it.each(['rifiuta', 'lancia'] as const)(
    'se l avviso va in errore (%s) la scrittura riesce lo stesso',
    async esito => {
      const a = await azienda()
      const { p, chiamate } = porta(esito)
      const s = servizio(p)
      const { ritiri } = await nelTenant(a.t, () => s.crea(a.t, a.admin, nuovo(a)))
      await fineCoda()
      expect(chiamate).toHaveLength(1)
      const dopo = await nelTenant(a.t, () =>
        s.annulla(a.t, a.admin, ritiri[0].id, 'Prova', ritiri[0].versione)
      )
      expect(dopo.stato).toBe('ANNULLATO')
    }
  )

  it('senza porta (push non configurato nel modulo) tutto funziona come prima', async () => {
    const a = await azienda()
    const { ritiri } = await nelTenant(a.t, () => servizio().crea(a.t, a.admin, nuovo(a)))
    expect(ritiri).toHaveLength(1)
  })
})
