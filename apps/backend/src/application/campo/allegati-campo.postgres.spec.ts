/**
 * App campo P5 contro un Postgres reale, collegato COME `wasteflow_app`: foto dell'evento
 * (`allegati_campo`) con impronta verificata, tetti per foto e per evento, idempotenza, append-only,
 * RLS, e visibilita' d'ufficio (foto e posizione sull'esito).
 */
import { PrismaClient } from '@prisma/client'
import { createHash, randomBytes } from 'crypto'
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
import {
  PrismaService,
  creaPrismaServiceApplicativo,
} from '../../infrastructure/persistence/prisma.service'
import { RitiriRepository } from '../../infrastructure/persistence/ritiri.repository'
import { cancellaAziendeDiProva } from '../../test-support/cancella-azienda-di-prova'
import {
  creaAziendaCampo,
  creaRitiroCampo,
  type AziendaCampo,
} from '../../test-support/campo-di-test'
import { AllegatiCampoService } from './allegati-campo.service'
import { MAX_BYTE_FOTO_CAMPO, MAX_FOTO_PER_EVENTO } from './allegati-campo.input'
import {
  EventoCampoDiAltroUtenteError,
  EventoCampoNonTrovatoError,
  FotoCampoGiaUsataError,
  FotoCampoHashNonCorrispondenteError,
  FotoCampoLimiteEventoError,
  FotoCampoNonTrovataError,
  FotoCampoNonValidaError,
  FotoCampoTipoNonAmmessoError,
  FotoCampoTroppoGrandeError,
} from './errori-campo'
import { EventiCampoService } from './eventi-campo.service'

const jpeg = (byte = 2000) =>
  Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), randomBytes(byte)])
const sha = (b: Buffer) => createHash('sha256').update(b).digest('hex')

describe('Foto e posizione dal campo P5 — Postgres reale, ruolo wasteflow_app', () => {
  const owner = new PrismaClient({ datasourceUrl: urlProprietario })
  let app: PrismaService
  let eventi: EventiCampoService
  let foto: AllegatiCampoService
  const creati: string[] = []

  const azienda = async (): Promise<AziendaCampo> => {
    const a = await creaAziendaCampo(owner)
    creati.push(a.t)
    return a
  }
  const nelTenant = <R>(t: string, fn: () => Promise<R>) =>
    TenantContext.run({ tenantId: t }, async () => await fn())

  /** Registra un evento eseguito e ne restituisce l'uuid (quello del telefono). */
  async function evento(a: AziendaCampo, dati: Record<string, unknown> = {}) {
    const r = await creaRitiroCampo(owner, a, a.autista1)
    const rit = await owner.ritiro.findUniqueOrThrow({ where: { id: r } })
    const id = crypto.randomUUID()
    await nelTenant(a.t, () =>
      eventi.registra(a.t, a.utente1, {
        id,
        ritiroId: r,
        tipo: 'RITIRO_ESEGUITO',
        versioneVista: 1,
        dataVista: rit.dataPrevista.toISOString().slice(0, 10),
        sedeVista: rit.produttoreSedeId,
        rilevatoIl: '2026-12-01T08:30:00.000Z',
        dati,
      })
    )
    return id
  }
  const invia = (
    a: AziendaCampo,
    eventoUuid: string,
    contenuto: Buffer,
    extra: { id?: string; sha256?: string; utente?: string } = {}
  ) =>
    nelTenant(a.t, () =>
      foto.registra(a.t, extra.utente ?? a.utente1, eventoUuid, {
        id: extra.id ?? crypto.randomUUID(),
        sha256: extra.sha256 ?? sha(contenuto),
        contenuto,
      })
    )
  const righe = (a: AziendaCampo) => owner.allegatoCampo.findMany({ where: { tenantId: a.t } })

  beforeAll(async () => {
    app = creaPrismaServiceApplicativo()
    await app.onModuleInit()
    eventi = new EventiCampoService(app, new RitiriRepository())
    foto = new AllegatiCampoService(app)
  })

  afterAll(async () => {
    for (const t of creati) {
      try {
        await cancellaAziendeDiProva(owner, t)
      } catch (e) {
        console.error(`pulizia foto campo: azienda ${t} non cancellata`, e)
      }
    }
    await owner.$disconnect()
    await app.$disconnect()
  })

  describe('salvataggio e hash', () => {
    it('salva i byte con impronta e tipo riconosciuto dai primi byte', async () => {
      const a = await azienda()
      const ev = await evento(a)
      const b = jpeg()
      const id = crypto.randomUUID()
      const r = await invia(a, ev, b, { id })
      expect(r).toMatchObject({
        id,
        mimeType: 'image/jpeg',
        dimensioneByte: b.length,
        sha256: sha(b),
      })
      const [riga] = await righe(a)
      expect(riga).toMatchObject({ fotoUuid: id, utenteId: a.utente1, sha256: sha(b) })
      expect(Buffer.from(riga.contenuto).equals(b)).toBe(true)
    })

    it('l impronta sbagliata e rifiutata e non lascia nulla', async () => {
      const a = await azienda()
      const ev = await evento(a)
      const b = jpeg()
      await expect(invia(a, ev, b, { sha256: sha(jpeg()) })).rejects.toBeInstanceOf(
        FotoCampoHashNonCorrispondenteError
      )
      expect(await righe(a)).toHaveLength(0)
    })

    it('l impronta mancante o malformata e un errore di validazione', async () => {
      const a = await azienda()
      const ev = await evento(a)
      for (const s of ['', 'abc', 'Z'.repeat(64)]) {
        await expect(invia(a, ev, jpeg(), { sha256: s })).rejects.toBeInstanceOf(
          FotoCampoNonValidaError
        )
      }
    })

    it('maiuscole nell impronta sono accettate (si confronta in minuscolo)', async () => {
      const a = await azienda()
      const ev = await evento(a)
      const b = jpeg()
      await expect(invia(a, ev, b, { sha256: sha(b).toUpperCase() })).resolves.toBeDefined()
    })

    it('rifiuta una foto vuota, un file che non e un immagine e un id non valido', async () => {
      const a = await azienda()
      const ev = await evento(a)
      await expect(invia(a, ev, Buffer.alloc(0))).rejects.toBeInstanceOf(FotoCampoNonValidaError)
      await expect(invia(a, ev, Buffer.from('%PDF-1.4 contenuto'))).rejects.toBeInstanceOf(
        FotoCampoTipoNonAmmessoError
      )
      await expect(invia(a, ev, jpeg(), { id: 'non-un-uuid' })).rejects.toBeInstanceOf(
        FotoCampoNonValidaError
      )
      expect(await righe(a)).toHaveLength(0)
    })
  })

  describe('limiti', () => {
    it('rifiuta una foto oltre il tetto per foto e accetta quella esattamente al tetto', async () => {
      const a = await azienda()
      const ev = await evento(a)
      const alTetto = Buffer.concat([
        Buffer.from([0xff, 0xd8, 0xff]),
        randomBytes(MAX_BYTE_FOTO_CAMPO - 3),
      ])
      await expect(invia(a, ev, alTetto)).resolves.toMatchObject({
        dimensioneByte: MAX_BYTE_FOTO_CAMPO,
      })
      const sopra = Buffer.concat([alTetto, Buffer.from([1])])
      await expect(invia(a, ev, sopra)).rejects.toBeInstanceOf(FotoCampoTroppoGrandeError)
      expect(await righe(a)).toHaveLength(1)
    })

    it(`al massimo ${MAX_FOTO_PER_EVENTO} foto per evento, anche con invii in parallelo`, async () => {
      const a = await azienda()
      const ev = await evento(a)
      const esiti = await Promise.allSettled(
        Array.from({ length: MAX_FOTO_PER_EVENTO + 3 }, () => invia(a, ev, jpeg()))
      )
      expect(esiti.filter(e => e.status === 'fulfilled')).toHaveLength(MAX_FOTO_PER_EVENTO)
      for (const e of esiti.filter(x => x.status === 'rejected')) {
        expect((e as PromiseRejectedResult).reason).toBeInstanceOf(FotoCampoLimiteEventoError)
      }
      expect(await righe(a)).toHaveLength(MAX_FOTO_PER_EVENTO)
    })

    it('il tetto e per evento: un altro evento ha le sue foto', async () => {
      const a = await azienda()
      const ev1 = await evento(a)
      const ev2 = await evento(a)
      for (let i = 0; i < MAX_FOTO_PER_EVENTO; i++) await invia(a, ev1, jpeg())
      await expect(invia(a, ev2, jpeg())).resolves.toBeDefined()
    })
  })

  describe('idempotenza e proprieta', () => {
    it('lo stesso id e lo stesso contenuto due volte: una riga, stessa risposta, non consuma il tetto', async () => {
      const a = await azienda()
      const ev = await evento(a)
      const b = jpeg()
      const id = crypto.randomUUID()
      const r1 = await invia(a, ev, b, { id })
      const r2 = await invia(a, ev, b, { id })
      expect(r2).toEqual(r1)
      expect(await righe(a)).toHaveLength(1)
      // anche a tetto raggiunto il reinvio di una foto gia' accettata risponde come prima
      await invia(a, ev, jpeg())
      await invia(a, ev, jpeg())
      await expect(invia(a, ev, b, { id })).resolves.toEqual(r1)
    })

    it('lo stesso id con contenuto diverso o per un altro evento e rifiutato', async () => {
      const a = await azienda()
      const ev = await evento(a)
      const ev2 = await evento(a)
      const id = crypto.randomUUID()
      await invia(a, ev, jpeg(), { id })
      await expect(invia(a, ev, jpeg(), { id })).rejects.toBeInstanceOf(FotoCampoGiaUsataError)
      await expect(invia(a, ev2, jpeg(), { id })).rejects.toBeInstanceOf(FotoCampoGiaUsataError)
    })

    it('invii concorrenti della stessa foto: una riga sola', async () => {
      const a = await azienda()
      const ev = await evento(a)
      const b = jpeg()
      const id = crypto.randomUUID()
      const esiti = await Promise.all(Array.from({ length: 5 }, () => invia(a, ev, b, { id })))
      expect(new Set(esiti.map(e => e.ricevutoIl)).size).toBe(1)
      expect(await righe(a)).toHaveLength(1)
    })

    it('l evento di un altro autista e rifiutato; un evento inesistente o di un altra azienda e 404', async () => {
      const a = await azienda()
      const b = await azienda()
      const ev = await evento(a)
      await expect(invia(a, ev, jpeg(), { utente: a.utente2 })).rejects.toBeInstanceOf(
        EventoCampoDiAltroUtenteError
      )
      await expect(invia(a, crypto.randomUUID(), jpeg())).rejects.toBeInstanceOf(
        EventoCampoNonTrovatoError
      )
      await expect(invia(b, ev, jpeg(), { utente: b.utente1 })).rejects.toBeInstanceOf(
        EventoCampoNonTrovatoError
      )
      expect(await righe(a)).toHaveLength(0)
      expect(await righe(b)).toHaveLength(0)
    })

    it('anche un evento DA_RICONCILIARE accetta foto (il fatto del campo non si perde)', async () => {
      const a = await azienda()
      const r = await creaRitiroCampo(owner, a, a.autista2) // di un altro autista
      const rit = await owner.ritiro.findUniqueOrThrow({ where: { id: r } })
      const id = crypto.randomUUID()
      const esito = await nelTenant(a.t, () =>
        eventi.registra(a.t, a.utente1, {
          id,
          ritiroId: r,
          tipo: 'RITIRO_ESEGUITO',
          versioneVista: 1,
          dataVista: rit.dataPrevista.toISOString().slice(0, 10),
          sedeVista: rit.produttoreSedeId,
          rilevatoIl: '2026-12-01T08:30:00.000Z',
        })
      )
      expect(esito.esito).toBe('DA_RICONCILIARE')
      await expect(invia(a, id, jpeg())).resolves.toBeDefined()
    })
  })

  describe('schema: append-only e isolamento', () => {
    it('nessuno modifica o cancella una foto, nemmeno il proprietario', async () => {
      const a = await azienda()
      const ev = await evento(a)
      await invia(a, ev, jpeg())
      await expect(
        owner.$executeRawUnsafe(
          `UPDATE allegati_campo SET mime_type = 'image/png' WHERE tenant_id = '${a.t}'`
        )
      ).rejects.toThrow(/immutabile/)
      await expect(
        owner.$executeRawUnsafe(`DELETE FROM allegati_campo WHERE tenant_id = '${a.t}'`)
      ).rejects.toThrow()
      await expect(owner.$executeRawUnsafe(`TRUNCATE allegati_campo`)).rejects.toThrow()
      await expect(
        nelTenant(a.t, () => app.$executeRawUnsafe(`DELETE FROM allegati_campo`))
      ).rejects.toThrow()
      expect(await righe(a)).toHaveLength(1)
    })

    it('CHECK: dimensione dichiarata diversa dai byte, impronta non esadecimale, tipo non ammesso', async () => {
      const a = await azienda()
      const ev = await evento(a)
      const e = await owner.eventoCampo.findFirstOrThrow({
        where: { tenantId: a.t, eventoUuid: ev },
      })
      const ins = (mime: string, dim: number, hash: string) =>
        owner.$executeRawUnsafe(
          `INSERT INTO allegati_campo (tenant_id, foto_uuid, evento_id, utente_id, mime_type, dimensione_byte, sha256, contenuto)
           VALUES ('${a.t}', '${crypto.randomUUID()}', '${e.id}', '${a.utente1}', '${mime}', ${dim}, '${hash}', '\\xffd8ff'::bytea)`
        )
      await expect(ins('image/jpeg', 4, 'a'.repeat(64))).rejects.toThrow()
      await expect(ins('image/jpeg', 3, 'g'.repeat(64))).rejects.toThrow()
      await expect(ins('application/pdf', 3, 'a'.repeat(64))).rejects.toThrow()
      await expect(ins('image/jpeg', 3, 'a'.repeat(64))).resolves.toBeDefined()
    })

    it('RLS: un altra azienda non vede ne scrive foto altrui', async () => {
      const a = await azienda()
      const b = await azienda()
      const ev = await evento(a)
      await invia(a, ev, jpeg())
      const viste = await nelTenant(b.t, () =>
        app.$queryRawUnsafe<unknown[]>(`SELECT id FROM allegati_campo`)
      )
      expect(viste).toHaveLength(0)
      const e = await owner.eventoCampo.findFirstOrThrow({ where: { tenantId: a.t } })
      await expect(
        nelTenant(b.t, () =>
          app.$executeRawUnsafe(
            `INSERT INTO allegati_campo (tenant_id, foto_uuid, evento_id, utente_id, mime_type, dimensione_byte, sha256, contenuto)
             VALUES ('${a.t}', '${crypto.randomUUID()}', '${e.id}', '${a.utente1}', 'image/jpeg', 3, '${'a'.repeat(64)}', '\\xffd8ff'::bytea)`
          )
        )
      ).rejects.toThrow()
    })

    it('la cancellazione dell azienda porta via le foto (cascata ammessa)', async () => {
      const a = await azienda()
      const ev = await evento(a)
      await invia(a, ev, jpeg())
      await cancellaAziendeDiProva(owner, a.t)
      creati.splice(creati.indexOf(a.t), 1)
      expect(await owner.allegatoCampo.count({ where: { tenantId: a.t } })).toBe(0)
    })
  })

  describe('ufficio: foto e posizione sull esito', () => {
    it('l elenco degli esiti porta posizione e foto (senza byte) e la foto si legge per id', async () => {
      const a = await azienda()
      const ev = await evento(a, { posizione: { lat: 45.1, lon: 9.2, accuratezza: 8 } })
      const b1 = jpeg()
      const b2 = jpeg()
      const f1 = crypto.randomUUID()
      const f2 = crypto.randomUUID()
      await invia(a, ev, b1, { id: f1 })
      await invia(a, ev, b2, { id: f2 })
      const { righe: esiti } = await nelTenant(a.t, () => eventi.elenca(a.t, {}))
      expect(esiti).toHaveLength(1)
      expect(esiti[0].dati).toMatchObject({ posizione: { lat: 45.1, lon: 9.2, accuratezza: 8 } })
      expect(esiti[0].foto.map(f => f.id).sort()).toEqual([f1, f2].sort())
      expect(esiti[0].foto[0]).toEqual(
        expect.objectContaining({
          mimeType: 'image/jpeg',
          sha256: expect.stringMatching(/^[0-9a-f]{64}$/),
        })
      )
      expect(JSON.stringify(esiti[0])).not.toContain('contenuto')
      const letta = await nelTenant(a.t, () => foto.leggi(a.t, f1))
      expect(letta.contenuto.equals(b1)).toBe(true)
      expect(letta.mimeType).toBe('image/jpeg')
    })

    it('un evento senza foto ha l elenco vuoto; la foto di un altra azienda e 404', async () => {
      const a = await azienda()
      const b = await azienda()
      const ev = await evento(a)
      const f = crypto.randomUUID()
      await invia(a, ev, jpeg(), { id: f })
      const ev2 = await evento(b)
      void ev2
      const { righe: esiti } = await nelTenant(b.t, () => eventi.elenca(b.t, {}))
      expect(esiti[0].foto).toEqual([])
      await expect(nelTenant(b.t, () => foto.leggi(b.t, f))).rejects.toBeInstanceOf(
        FotoCampoNonTrovataError
      )
    })
  })
})
