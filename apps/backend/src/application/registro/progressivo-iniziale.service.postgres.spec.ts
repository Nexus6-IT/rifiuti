import { ConflictException } from '@nestjs/common'
import { PrismaClient } from '@prisma/client'
import { ProgressivoInizialeService } from './progressivo-iniziale.service'
import { RegistraMovimentoUseCase } from './use-cases/registra-movimento.use-case'
import { RegistraMovimentoCommand } from './commands/registra-movimento.command'
import { annoSolareItaliano } from '../../core/time/anno-italiano'

/**
 * Progressivo iniziale del registro contro un Postgres reale: la tabella creata dalla
 * migration, il numero preso dal primo movimento e la serializzazione con la numerazione
 * (stesso advisory lock `<tenant>-<anno>`) si vedono solo con un database vero.
 */
describe('ProgressivoInizialeService — Postgres reale', () => {
  const CER = '99 99 02'
  const loggerStub = { setContext() {}, info() {}, warn() {}, error() {}, debug() {} }
  const ANNO = annoSolareItaliano(new Date())
  let prisma: PrismaClient
  let service: ProgressivoInizialeService
  let useCase: RegistraMovimentoUseCase
  let userId: string
  let cerCreato = false
  const tenantCreati: string[] = []

  async function nuovoTenant(): Promise<string> {
    const suffisso = `${Date.now()}${Math.floor(Math.random() * 1000)}`.slice(-9)
    const t = await prisma.tenant.create({
      data: { partitaIva: `PI${suffisso}`, ragioneSociale: 'Progressivo SRL', country: 'IT' },
    })
    tenantCreati.push(t.id)
    return t.id
  }

  beforeAll(async () => {
    prisma = new PrismaClient()
    await prisma.$connect()
    service = new ProgressivoInizialeService(prisma as any)
    useCase = new RegistraMovimentoUseCase(prisma as any, loggerStub as any)
    const tenantUtente = await nuovoTenant()
    const user = await prisma.user.create({
      data: {
        tenantId: tenantUtente,
        keycloakId: `keycloak-progressivo-${Date.now()}`,
        fiscalCode: 'RSSMRA80A01H501U',
        firstName: 'Mario',
        lastName: 'Rossi',
        email: `progressivo-${Date.now()}@example.com`,
        role: 'ADMIN',
      },
    })
    userId = user.id
    cerCreato = (await prisma.cERCode.count({ where: { code: CER } })) === 0
    await prisma.cERCode.upsert({
      where: { code: CER },
      create: { code: CER, description: 'CER di test', category: '99', subcategory: '' },
      update: {},
    })
  })

  afterAll(async () => {
    await prisma.activityLog.deleteMany({ where: { tenantId: { in: tenantCreati } } })
    await prisma.wasteMovement.deleteMany({ where: { tenantId: { in: tenantCreati } } })
    // senza id deleteMany non avrebbe filtro e cancellerebbe tutti gli utenti
    if (userId) await prisma.user.deleteMany({ where: { id: userId } })
    await prisma.tenant.deleteMany({ where: { id: { in: tenantCreati } } })
    if (cerCreato) await prisma.cERCode.deleteMany({ where: { code: CER } })
    await prisma.$disconnect()
  })

  function carico(tenantId: string): RegistraMovimentoCommand {
    const adesso = new Date()
    return new RegistraMovimentoCommand(
      tenantId,
      undefined as unknown as string,
      'CARICO',
      adesso,
      adesso,
      'PRODUZIONE_INTERNA',
      CER,
      undefined,
      10,
      'KG',
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined
    )
  }

  describe('migration', () => {
    it('crea la tabella con le colonne NOT NULL attese', async () => {
      const colonne = await prisma.$queryRaw<
        Array<{ column_name: string; is_nullable: string; data_type: string }>
      >`
        SELECT column_name, is_nullable, data_type
        FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'registro_progressivi_iniziali'
        ORDER BY column_name
      `
      expect(colonne.map(c => [c.column_name, c.is_nullable])).toEqual([
        ['anno', 'NO'],
        ['id', 'NO'],
        ['impostato_da', 'NO'],
        ['impostato_il', 'NO'],
        ['motivo', 'NO'],
        ['primo_progressivo', 'NO'],
        ['tenant_id', 'NO'],
      ])
    })

    it('ha un indice unico su (tenant_id, anno)', async () => {
      const indici = await prisma.$queryRaw<Array<{ indexdef: string }>>`
        SELECT indexdef FROM pg_indexes
        WHERE schemaname = 'public' AND tablename = 'registro_progressivi_iniziali'
      `
      expect(indici.some(i => /CREATE UNIQUE INDEX .*\(tenant_id, anno\)/.test(i.indexdef))).toBe(
        true
      )
    })

    it('ha il CHECK primo_progressivo >= 1 e la FK verso tenants con ON DELETE CASCADE', async () => {
      const vincoli = await prisma.$queryRaw<Array<{ contype: string; definizione: string }>>`
        SELECT contype::text AS contype, pg_get_constraintdef(oid) AS definizione
        FROM pg_constraint
        WHERE conrelid = 'public.registro_progressivi_iniziali'::regclass
      `
      expect(
        vincoli.some(v => v.contype === 'c' && /primo_progressivo >= 1/.test(v.definizione))
      ).toBe(true)
      expect(
        vincoli.some(
          v =>
            v.contype === 'f' &&
            /REFERENCES tenants\(id\)/.test(v.definizione) &&
            /ON DELETE CASCADE/.test(v.definizione)
        )
      ).toBe(true)
    })

    it('il database rifiuta un progressivo iniziale minore di 1', async () => {
      const tenantId = await nuovoTenant()
      await expect(
        prisma.$executeRaw`
          INSERT INTO registro_progressivi_iniziali
            (tenant_id, anno, primo_progressivo, motivo, impostato_da)
          VALUES (${tenantId}::uuid, ${ANNO}, 0, 'prova', ${userId}::uuid)
        `
      ).rejects.toThrow(/check constraint/i)
    })
  })

  it("primo movimento dopo l'impostazione prende il numero iniziale", async () => {
    const tenantId = await nuovoTenant()
    await service.imposta(tenantId, ANNO, 812, 'Migrazione da WinWaste', userId)

    const primo = await useCase.execute(carico(tenantId))
    const secondo = await useCase.execute(carico(tenantId))

    expect(primo.isSuccess).toBe(true)
    expect(secondo.isSuccess).toBe(true)
    expect(primo.value.progressiveNumber).toBe(812)
    expect(secondo.value.progressiveNumber).toBe(813)

    const log = await prisma.activityLog.findFirst({
      where: { tenantId, action: 'REGISTRO_PROGRESSIVO_INIZIALE' },
    })
    expect(log?.description).toBe(
      `Progressivo iniziale del registro ${ANNO} impostato a 812: Migrazione da WinWaste`
    )
    await expect(service.leggi(tenantId, ANNO)).resolves.toMatchObject({
      primoProgressivo: 812,
      haMovimenti: true,
    })
  })

  /**
   * Interleaving deterministico fra impostazione e primo movimento. Un client "con pausa"
   * esegue la callback della transaction (quindi prende il lock e scrive) e poi aspetta
   * il via prima del commit: l'altra operazione parte mentre la prima tiene il lock
   * `<tenant>-<anno>` con la scrittura non ancora visibile. Senza quel lock la seconda
   * operazione non aspetterebbe e leggerebbe lo stato di prima: i test diventano rossi.
   * Un tenant nuovo per test: imposta accetta solo l'anno in corso e il prossimo (F16).
   */
  describe('impostazione e primo movimento concorrenti', () => {
    function clientConPausa() {
      let segnalaArrivo!: () => void
      const arrivata = new Promise<void>(r => (segnalaArrivo = r))
      let rilascia!: () => void
      const via = new Promise<void>(r => (rilascia = r))
      const client = new Proxy(prisma, {
        get(target, prop) {
          if (prop === '$transaction') {
            return (fn: (tx: unknown) => Promise<unknown>, opzioni?: any) =>
              target.$transaction(async tx => {
                const risultato = await fn(tx)
                segnalaArrivo()
                await via
                return risultato
              }, opzioni)
          }
          const valore = Reflect.get(target, prop)
          return typeof valore === 'function' ? valore.bind(target) : valore
        },
      })
      return { client, arrivata, rilascia }
    }

    /** Vero se entro `ms` una sessione aspetta un advisory lock (l'operazione è ferma lì). */
    async function qualcunoAspettaIlLock(ms = 3000): Promise<boolean> {
      const fine = Date.now() + ms
      while (Date.now() < fine) {
        const [r] = await prisma.$queryRaw<Array<{ n: number }>>`
          SELECT count(*)::int AS n FROM pg_locks WHERE locktype = 'advisory' AND NOT granted
        `
        if (r.n > 0) return true
        await new Promise(res => setTimeout(res, 25))
      }
      return false
    }

    it("un movimento che tiene il lock fa rifiutare l'impostazione che lo aspetta", async () => {
      const tenantId = await nuovoTenant()
      const pausa = clientConPausa()
      const movimentoInPausa = new RegistraMovimentoUseCase(pausa.client as any, loggerStub as any)

      const movimento = movimentoInPausa.execute(carico(tenantId))
      await pausa.arrivata // movimento scritto, lock tenuto, commit non ancora fatto
      const impostazione = service.imposta(tenantId, ANNO, 500, 'Migrazione', userId).then(
        v => ({ ok: true as const, v }),
        e => ({ ok: false as const, e })
      )
      const inAttesa = await qualcunoAspettaIlLock()
      pausa.rilascia()

      const esitoMovimento = await movimento
      const esitoImpostazione = await impostazione
      expect(esitoMovimento.isSuccess).toBe(true)
      expect(esitoMovimento.value.progressiveNumber).toBe(1)
      expect(esitoImpostazione.ok).toBe(false)
      expect(!esitoImpostazione.ok && esitoImpostazione.e).toBeInstanceOf(ConflictException)
      expect(await prisma.registroProgressivoIniziale.count({ where: { tenantId } })).toBe(0)
      expect(inAttesa).toBe(true)
    })

    it("un'impostazione che tiene il lock dà il suo numero al movimento che la aspetta", async () => {
      const tenantId = await nuovoTenant()
      const pausa = clientConPausa()
      const impostazioneInPausa = new ProgressivoInizialeService(pausa.client as any)

      const impostazione = impostazioneInPausa.imposta(tenantId, ANNO, 500, 'Migrazione', userId)
      await pausa.arrivata // riga scritta, lock tenuto, commit non ancora fatto
      const movimento = useCase.execute(carico(tenantId))
      const inAttesa = await qualcunoAspettaIlLock()
      pausa.rilascia()

      await expect(impostazione).resolves.toEqual({ anno: ANNO, primoProgressivo: 500 })
      const esitoMovimento = await movimento
      expect(esitoMovimento.isSuccess).toBe(true)
      expect(esitoMovimento.value.progressiveNumber).toBe(500)
      expect(inAttesa).toBe(true)
    })
  })
})
