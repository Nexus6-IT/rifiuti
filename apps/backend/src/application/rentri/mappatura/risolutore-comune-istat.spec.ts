import { RisolutoreComuneIstat } from './risolutore-comune-istat'

/**
 * Il risolutore traduce (nome comune + sigla provincia) nel `comune_id` che
 * RENTRI si aspetta. Il contratto delle codifiche dichiara `comune_id` come
 * «Codice ISTAT comune» e `provincia_id` come «Codice ISTAT provincia»: sono
 * gli stessi codici che teniamo gia' nella tabella `istat_comuni`, quindi la
 * risoluzione non richiede una chiamata a RENTRI.
 */

function prismaConComuni(righe: Array<{ code: string; name: string; provinciaSigla: string }>) {
  return {
    db: {
      istatComune: {
        findFirst: jest.fn(async ({ where }: { where: Record<string, unknown> }) => {
          const nome = String(
            (where.name as { equals?: string })?.equals ?? where.name ?? ''
          ).toLowerCase()
          const sigla = String(where.provinciaSigla ?? '').toUpperCase()
          return (
            righe.find(r => r.name.toLowerCase() === nome && r.provinciaSigla === sigla) ?? null
          )
        }),
      },
    },
  }
}

const NAPOLI = { code: '063049', name: 'Napoli', provinciaSigla: 'NA' }

describe('RisolutoreComuneIstat', () => {
  it('traduce nome e provincia nel codice ISTAT del comune', async () => {
    const risolutore = new RisolutoreComuneIstat(prismaConComuni([NAPOLI]) as never)

    await expect(risolutore.risolvi('Napoli', 'NA')).resolves.toBe('063049')
  })

  it('tollera maiuscole, minuscole e spazi in eccesso', async () => {
    const risolutore = new RisolutoreComuneIstat(prismaConComuni([NAPOLI]) as never)

    await expect(risolutore.risolvi('  napoli ', 'na')).resolves.toBe('063049')
  })

  it('restituisce null per un comune sconosciuto, cosi il mappatore fallisce in chiaro', async () => {
    const risolutore = new RisolutoreComuneIstat(prismaConComuni([NAPOLI]) as never)

    await expect(risolutore.risolvi('Comune Inesistente', 'NA')).resolves.toBeNull()
  })

  it('non risolve un comune giusto nella provincia sbagliata', async () => {
    const risolutore = new RisolutoreComuneIstat(prismaConComuni([NAPOLI]) as never)

    await expect(risolutore.risolvi('Napoli', 'RM')).resolves.toBeNull()
  })
})
