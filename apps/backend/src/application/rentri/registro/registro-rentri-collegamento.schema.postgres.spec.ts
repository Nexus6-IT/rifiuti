/**
 * Schema M1 dell'eREGI E2: colonne di collegamento del registro a RENTRI (attivita', prenotazione
 * dell'apertura, chiusura, sincronizzazione) e i loro CHECK, contro un Postgres reale.
 * Il proprietario prepara e legge; la pulizia toglie solo le aziende create qui.
 */
import { PrismaClient } from '@prisma/client'
import { partitaIvaUnica } from '../../../test-support/anagrafiche-di-test'

const urlProprietario =
  process.env.DATABASE_URL ??
  'postgresql://wasteflow:wasteflow_ci@127.0.0.1:55438/wasteflow_ci?schema=public'

describe('Registro: colonne di collegamento a RENTRI (M1) — Postgres reale', () => {
  const owner = new PrismaClient({ datasourceUrl: urlProprietario })
  const tenantCreati: string[] = []
  let n = 0

  async function registro(extra: Record<string, unknown> = {}) {
    const t = await owner.tenant.create({
      data: { partitaIva: partitaIvaUnica(), ragioneSociale: 'Collegamento SRL', country: 'IT' },
    })
    tenantCreati.push(t.id)
    return owner.registroRifiuti.create({
      data: {
        tenantId: t.id,
        descrizione: `Registro ${++n}`,
        ...extra,
      },
    })
  }

  afterAll(async () => {
    await owner.tenant.deleteMany({ where: { id: { in: tenantCreati } } })
    await owner.$disconnect()
  })

  it('un registro nuovo ha liste vuote e nessuna data', async () => {
    const r = await registro()
    expect(r.rentriAttivita).toEqual([])
    expect(r.rentriAttivitaRecSmalt).toEqual([])
    expect(r.rentriAperturaRichiestaIl).toBeNull()
    expect(r.rentriAperturaDescrizione).toBeNull()
    expect(r.rentriChiusoIl).toBeNull()
    expect(r.rentriSincronizzatoIl).toBeNull()
  })

  it('accetta attivita e codici del contratto', async () => {
    const r = await registro({
      identificativoRentri: 'RAB12CD34E5',
      rentriAttivita: ['Produzione', 'Recupero'],
      rentriAttivitaRecSmalt: ['R13', 'D15'],
    })
    expect(r.rentriAttivita).toEqual(['Produzione', 'Recupero'])
  })

  it("rifiuta un'attivita fuori dall'elenco del contratto", async () => {
    await expect(registro({ rentriAttivita: ['Pirotecnica'] })).rejects.toThrow(
      /registri_rifiuti_rentri_attivita_check/
    )
  })

  it('rifiuta un codice di recupero o smaltimento inesistente', async () => {
    await expect(
      registro({ rentriAttivita: ['Recupero'], rentriAttivitaRecSmalt: ['R14'] })
    ).rejects.toThrow(/registri_rifiuti_rentri_attivita_rec_smalt_check/)
    await expect(
      registro({ rentriAttivita: ['Smaltimento'], rentriAttivitaRecSmalt: ['D16'] })
    ).rejects.toThrow(/registri_rifiuti_rentri_attivita_rec_smalt_check/)
  })

  it("Recupero o Smaltimento senza codici e' rifiutato", async () => {
    await expect(registro({ rentriAttivita: ['Recupero'] })).rejects.toThrow(
      /registri_rifiuti_rentri_rec_smalt_richiesti_check/
    )
    await expect(registro({ rentriAttivita: ['Produzione', 'Smaltimento'] })).rejects.toThrow(
      /registri_rifiuti_rentri_rec_smalt_richiesti_check/
    )
  })

  it('senza Recupero/Smaltimento i codici non servono (registro collegato ma senza dettaglio)', async () => {
    await expect(registro({ rentriAttivita: ['Trasporto'] })).resolves.toBeDefined()
  })

  it("un registro chiuso su RENTRI deve avere l'identificativo", async () => {
    await expect(registro({ rentriChiusoIl: new Date() })).rejects.toThrow(
      /registri_rifiuti_chiuso_con_identificativo_check/
    )
    await expect(
      registro({ rentriChiusoIl: new Date(), identificativoRentri: 'RZZ99ZZ99Z9' })
    ).resolves.toBeDefined()
  })

  it("la descrizione di apertura e' limitata a 250 caratteri", async () => {
    await expect(registro({ rentriAperturaDescrizione: 'x'.repeat(251) })).rejects.toThrow()
  })
})
