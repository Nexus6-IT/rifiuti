/**
 * Fase 3 (3.1), Task 3: colonne di provenienza immutabili su registro, FIR, anagrafiche e giacenze iniziali contro un
 * Postgres reale. Una sola descrizione parametrica su nove tabelle. Il proprietario (`wasteflow`)
 * prepara e prova anche gli UPDATE (i trigger fermano pure lui). Un movimento importato nasce con la
 * sua riga di blocco (D3, Task 4) nella stessa transazione: il helper lo fa gia' ora, cosi' la spec
 * resta valida dopo la migration del blocco. La pulizia cancella SOLO le aziende create qui.
 */
import { PrismaClient } from '@prisma/client'
import { partitaIvaUnica, partitaIvaValida } from '../../test-support/anagrafiche-di-test'

import { cancellaAziendeDiProva } from '../../test-support/cancella-azienda-di-prova'
type Prov = { importSource: string; legacyKey: string; lottoImportId: string }

interface Contesto {
  t: string
  user: string
  registro: string
}

interface Tabella {
  nome: string
  /** Crea una riga (con o senza provenienza) e ne restituisce l'id. */
  crea: (c: Contesto, prov?: Partial<Prov>) => Promise<string>
  /** Una colonna qualunque che si puo' sempre aggiornare. */
  aggiorna: string
}

describe('Fase 3 (3.1): provenienza di import su nove tabelle (Postgres reale)', () => {
  const owner = new PrismaClient()
  const tenantCreati: string[] = []
  let n = 0
  const seme = 8_000_000 + (Date.now() % 1_000_000)
  const righeConProvenienzaAllInizio: Record<string, number> = {}

  const TABELLE_SQL = [
    'waste_movements',
    'firs',
    'ditte',
    'sedi_ditte',
    'produttori',
    'trasportatori',
    'destinatari',
    'automezzi',
    'giacenze_iniziali',
  ]

  async function contesto(): Promise<Contesto> {
    n++
    const t = (
      await owner.tenant.create({
        data: {
          partitaIva: partitaIvaValida(seme + n * 23),
          ragioneSociale: 'Provenienza SRL',
          country: 'IT',
        },
      })
    ).id
    tenantCreati.push(t)
    const user = (
      await owner.user.create({
        data: {
          tenantId: t,
          keycloakId: `kc-prov-${seme}-${n}`,
          fiscalCode: `PROV${seme}${n}`.slice(0, 16),
          firstName: 'Prova',
          lastName: 'Provenienza',
          email: `prov-${seme}-${n}@example.test`,
        },
      })
    ).id
    const registro = (
      await owner.registroRifiuti.create({ data: { tenantId: t, descrizione: 'Registro A' } })
    ).id
    return { t, user, registro }
  }

  async function lotto(t: string): Promise<string> {
    n++
    return (
      await owner.lottoImport.create({
        data: {
          tenantId: t,
          importSource: 'WINWASTE',
          archivio: 'WW00012026',
          ambito: 'ANAGRAFICHE',
          formatoStaging: 'winwaste-staging/1',
          hashStaging: 'a'.repeat(64),
          // un lotto per chiamata: per non violare l'unico degli IN_CORSO
          stato: 'COMPLETATO',
        },
      })
    ).id
  }

  async function dittaConSede(t: string, prov: Partial<Prov> = {}) {
    n++
    const d = await owner.ditta.create({
      data: {
        tenantId: t,
        ragioneSociale: `Ditta prov ${n}`,
        partitaIva: partitaIvaUnica(),
        ...prov,
      },
    })
    const s = await owner.sedeDitta.create({
      data: {
        tenantId: t,
        dittaId: d.id,
        via: 'Via Roma',
        civico: '1',
        cap: '00100',
        comune: 'Roma',
        provincia: 'RM',
        principale: true,
      },
    })
    return { dittaId: d.id, sedeId: s.id }
  }

  const TABELLE: Tabella[] = [
    {
      nome: 'waste_movements',
      aggiorna: `causale = 'PRODUZIONE_INTERNA'`,
      crea: async (c, prov = {}) => {
        n++
        const dati = {
          tenantId: c.t,
          registroId: c.registro,
          progressiveYear: 2026,
          progressiveNumber: n,
          type: 'CARICO' as const,
          movementDate: new Date('2026-03-01T10:00:00Z'),
          registrationDate: new Date('2026-03-01T10:00:00Z'),
          causale: 'PRODUZIONE_INTERNA',
          cerCode: '15 01 01',
          quantity: 10,
          unit: 'KG' as const,
          tipoAnnotazione: 'ORDINARIA' as const,
          ...prov,
        }
        if (!prov.importSource) return (await owner.wasteMovement.create({ data: dati })).id
        // Un movimento importato nasce con la sua riga di blocco, nella stessa transazione (D3).
        return owner.$transaction(async tx => {
          const m = await tx.wasteMovement.create({ data: dati })
          await tx.movimentoTrasmissioneRentri.create({
            data: {
              tenantId: c.t,
              movimentoId: m.id,
              registroId: c.registro,
              tipo: 'CARICO',
              origine: 'IMPORTAZIONE',
              stato: 'DA_RICONCILIARE',
              bloccatoInvio: true,
              motivoBlocco: 'Importato: in attesa di riconciliazione',
            },
          })
          return m.id
        })
      },
    },
    {
      nome: 'firs',
      aggiorna: `waste_description = 'altro'`,
      crea: async (c, prov = {}) => {
        n++
        return (
          await owner.fIR.create({
            data: {
              tenantId: c.t,
              producerUserId: c.user,
              producerPartitaIva: '00000000000',
              producerName: 'Produttore',
              producerAddress: 'Via Roma 1',
              carrierPartitaIva: '00000000001',
              carrierName: 'Trasportatore',
              carrierVehiclePlate: 'AB123CD',
              receiverPartitaIva: '00000000002',
              receiverName: 'Destinatario',
              receiverAddress: 'Via Roma 2',
              cerCode: '15 01 01',
              wasteDescription: 'Imballaggi',
              wasteCategory: 'Non pericoloso',
              quantity: 5,
              transportDate: new Date('2026-03-05T08:00:00Z'),
              provenienza: 'SPECIALE',
              firNumber: `FIR/PROV/${seme}/${n}`,
              // I FIR importati nascono bloccati all'invio (D4, Task 5).
              ...(prov.importSource
                ? { bloccatoInvio: true, motivoBloccoInvio: 'Importato: invio bloccato' }
                : {}),
              ...prov,
            },
          })
        ).id
      },
    },
    {
      nome: 'ditte',
      aggiorna: `ragione_sociale = 'Altra SRL'`,
      crea: async (c, prov = {}) => (await dittaConSede(c.t, prov)).dittaId,
    },
    {
      nome: 'sedi_ditte',
      aggiorna: `via = 'Via Altra'`,
      crea: async (c, prov = {}) => {
        const d = await dittaConSede(c.t)
        return (
          await owner.sedeDitta.create({
            data: {
              tenantId: c.t,
              dittaId: d.dittaId,
              via: 'Via Roma',
              civico: '2',
              cap: '00100',
              comune: 'Roma',
              provincia: 'RM',
              ...prov,
            },
          })
        ).id
      },
    },
    {
      nome: 'produttori',
      aggiorna: `telefono = '0612345678'`,
      crea: async (c, prov = {}) => {
        const d = await dittaConSede(c.t)
        return (await owner.produttore.create({ data: { tenantId: c.t, ...d, ...prov } })).id
      },
    },
    {
      nome: 'trasportatori',
      aggiorna: `numero_iscrizione = 'ALBO-X'`,
      crea: async (c, prov = {}) => {
        const d = await dittaConSede(c.t)
        n++
        return (
          await owner.trasportatore.create({
            data: { tenantId: c.t, ...d, numeroIscrizione: `ALBO-${n}`, ...prov },
          })
        ).id
      },
    },
    {
      nome: 'destinatari',
      aggiorna: `numero_autorizzazione = 'AUT-X'`,
      crea: async (c, prov = {}) => {
        const d = await dittaConSede(c.t)
        n++
        return (
          await owner.destinatario.create({
            data: { tenantId: c.t, ...d, numeroAutorizzazione: `AUT-${n}`, ...prov },
          })
        ).id
      },
    },
    {
      // Pezzo I4: provenienza anche sugli automezzi (migration 20261122110000).
      nome: 'automezzi',
      aggiorna: `note = 'revisione 2027'`,
      crea: async (c, prov = {}) => {
        n++
        return (
          await owner.automezzo.create({
            data: { tenantId: c.t, targa: `PV${seme}${n}`.slice(0, 15), creatoDa: c.user, ...prov },
          })
        ).id
      },
    },
    {
      // Pezzo I6: provenienza anche sulle giacenze iniziali (migration 20261123120000). Ogni riga ha un
      // CER diverso: l'unico (registro, CER, stato fisico, unita') non deve scattare fra le prove.
      nome: 'giacenze_iniziali',
      aggiorna: `note = 'controllata'`,
      crea: async (c, prov = {}) => {
        n++
        const cer = `${10 + (n % 80)} ${10 + (Math.floor(n / 80) % 80)} ${10 + (Math.floor(n / 6400) % 80)}`
        return (
          await owner.giacenzaIniziale.create({
            data: {
              tenantId: c.t,
              registroId: c.registro,
              cerCode: cer,
              quantita: 10,
              unita: 'KG',
              dataRiferimento: new Date('2026-12-31T00:00:00.000Z'),
              impostatoDa: c.user,
              provenienza: prov.importSource ? 'IMPORTAZIONE' : 'MANUALE',
              ...prov,
            },
          })
        ).id
      },
    },
  ]

  beforeAll(async () => {
    // Le righe esistenti (create dal seed o da altre suite) non hanno provenienza: si conta PRIMA
    // di creare qualunque riga di prova.
    for (const t of TABELLE_SQL) {
      const [r] = await owner.$queryRawUnsafe<{ c: bigint }[]>(
        `SELECT count(*) AS c FROM ${t} WHERE import_source IS NOT NULL OR legacy_key IS NOT NULL OR lotto_import_id IS NOT NULL`
      )
      righeConProvenienzaAllInizio[t] = Number(r.c)
    }
  })

  afterAll(async () => {
    for (const t of tenantCreati) await cancellaAziendeDiProva(owner, t)
    await owner.$disconnect()
  })

  it('le righe esistenti prima della migration non hanno provenienza', () => {
    expect(righeConProvenienzaAllInizio).toEqual(Object.fromEntries(TABELLE_SQL.map(t => [t, 0])))
  })

  describe.each(TABELLE)('$nome', tab => {
    const chiave = () => `0001|2026|PROVA|${++n}`

    it('una riga con provenienza completa si inserisce; senza provenienza resta non importata', async () => {
      const c = await contesto()
      const l = await lotto(c.t)
      const id = await tab.crea(c, {
        importSource: 'WINWASTE',
        legacyKey: chiave(),
        lottoImportId: l,
      })
      const normale = await tab.crea(c)
      const righe = await owner.$queryRawUnsafe<{ id: string; import_source: string | null }[]>(
        `SELECT id::text AS id, import_source FROM ${tab.nome} WHERE id IN ('${id}', '${normale}')`
      )
      expect(righe.find(r => r.id === id)?.import_source).toBe('WINWASTE')
      expect(righe.find(r => r.id === normale)?.import_source).toBeNull()
    })

    it('con una sola delle tre colonne: CHECK', async () => {
      const c = await contesto()
      const l = await lotto(c.t)
      const casi: Partial<Prov>[] = [
        { importSource: 'WINWASTE' },
        { legacyKey: chiave() },
        { lottoImportId: l },
        { importSource: 'WINWASTE', legacyKey: chiave() },
        { importSource: 'WINWASTE', lottoImportId: l },
      ]
      for (const prov of casi) {
        await expect(tab.crea(c, prov)).rejects.toThrow(new RegExp(`${tab.nome}_provenienza_check`))
      }
    })

    it('import_source fuori elenco o chiave fuori formato: CHECK', async () => {
      const c = await contesto()
      const l = await lotto(c.t)
      await expect(
        tab.crea(c, { importSource: 'ALTRO', legacyKey: chiave(), lottoImportId: l })
      ).rejects.toThrow(/provenienza_check|import_source/)
      for (const legacyKey of [
        'senza-forma',
        '001|2026|X|1',
        '0001|',
        '0001||x',
        `0001|${'x'.repeat(200)}`,
      ]) {
        await expect(
          tab.crea(c, { importSource: 'WINWASTE', legacyKey, lottoImportId: l })
        ).rejects.toThrow(/provenienza_check|legacy_key|too long/)
      }
    })

    it('stessa chiave nello stesso tenant: unico; in un altro tenant: ammessa', async () => {
      const a = await contesto()
      const b = await contesto()
      const la = await lotto(a.t)
      const lb = await lotto(b.t)
      const k = chiave()
      await tab.crea(a, { importSource: 'WINWASTE', legacyKey: k, lottoImportId: la })
      await expect(
        tab.crea(a, { importSource: 'WINWASTE', legacyKey: k, lottoImportId: la })
      ).rejects.toThrow(/tenant_import_legacy_key|Unique constraint|unique/i)
      await tab.crea(b, { importSource: 'WINWASTE', legacyKey: k, lottoImportId: lb })
    })

    it('lotto di un altro tenant: FK composta', async () => {
      const a = await contesto()
      const b = await contesto()
      const lb = await lotto(b.t)
      await expect(
        tab.crea(a, { importSource: 'WINWASTE', legacyKey: chiave(), lottoImportId: lb })
      ).rejects.toThrow(/lotto_import_fkey|Foreign key/i)
    })

    it('le tre colonne non si modificano mai, nemmeno da NULL a valore, nemmeno dal proprietario', async () => {
      const c = await contesto()
      const l = await lotto(c.t)
      const l2 = await lotto(c.t)
      const importata = await tab.crea(c, {
        importSource: 'WINWASTE',
        legacyKey: chiave(),
        lottoImportId: l,
      })
      const normale = await tab.crea(c)
      const MSG = /non si modifica mai/
      // Cambi che il CHECK ammetterebbe: li ferma il trigger di immutabilita'.
      for (const set of [
        `import_source = NULL, legacy_key = NULL, lotto_import_id = NULL`,
        `legacy_key = '0001|2026|PROVA|999999'`,
        `lotto_import_id = '${l2}'`,
      ]) {
        await expect(
          owner.$executeRawUnsafe(`UPDATE ${tab.nome} SET ${set} WHERE id = '${importata}'`)
        ).rejects.toThrow(MSG)
      }
      // Cambi che lasciano la provenienza a meta': rifiutati comunque (CHECK o trigger).
      for (const set of [`lotto_import_id = NULL`, `import_source = import_source || 'X'`]) {
        await expect(
          owner.$executeRawUnsafe(`UPDATE ${tab.nome} SET ${set} WHERE id = '${importata}'`)
        ).rejects.toThrow(/provenienza_check|non si modifica mai/)
      }
      // un record nato in WasteFlow non diventa «importato»
      await expect(
        owner.$executeRawUnsafe(
          `UPDATE ${tab.nome} SET import_source = 'WINWASTE', legacy_key = '0001|2026|PROVA|888888', lotto_import_id = '${l}' WHERE id = '${normale}'`
        )
      ).rejects.toThrow(MSG)
      await expect(
        owner.$executeRawUnsafe(
          `UPDATE ${tab.nome} SET lotto_import_id = '${l}' WHERE id = '${normale}'`
        )
      ).rejects.toThrow(/provenienza_check|non si modifica mai/)
    })

    it("un'altra colonna di una riga importata si aggiorna normalmente", async () => {
      const c = await contesto()
      const l = await lotto(c.t)
      const id = await tab.crea(c, {
        importSource: 'WINWASTE',
        legacyKey: chiave(),
        lottoImportId: l,
      })
      await expect(
        owner.$executeRawUnsafe(`UPDATE ${tab.nome} SET ${tab.aggiorna} WHERE id = '${id}'`)
      ).resolves.toBe(1)
    })
  })
})
