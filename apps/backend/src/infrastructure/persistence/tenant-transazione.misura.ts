/**
 * Misura del costo del "tenant per transazione" (RLS pezzo 2a). NON e' una spec e
 * non gira in CI: il nome `.misura.ts` non combacia con nessun testRegex di jest
 * (`.spec.ts`, `.postgres.spec.ts`, `.oracolo.spec.ts`, `.redis.spec.ts`).
 *
 * Eseguire con (Postgres di prova su 127.0.0.1:55432):
 *   DATABASE_URL="postgresql://wasteflow:wasteflow_ci@127.0.0.1:55432/wasteflow_ci?schema=public" \
 *     npx ts-node src/infrastructure/persistence/tenant-transazione.misura.ts
 *
 * Confronta N `findFirst` su `fir` (default 500, primo argomento per cambiarlo):
 *   A  client nudo, senza tenant                  (baseline storica)
 *   B  client esteso, senza tenant                (estensione presente ma inattiva)
 *   C  client nudo, dentro un TenantContext       (nessuna transazione aggiunta)
 *   D  client esteso, dentro un TenantContext     (BEGIN + set_config + op + COMMIT)
 */
import { TenantContext } from '../../core/context/tenant-context'
import { creaPrismaServiceApplicativo, PrismaService } from './prisma.service'

const N = Number(process.argv[2] ?? 500)
const RISCALDAMENTO = 50
const TENANT = '00000000-0000-4000-8000-0000000000aa'

type Cliente = { fIR: { findFirst: (a: { where: { tenantId: string } }) => Promise<unknown> } }

async function misura(cliente: Cliente, conTenant: boolean): Promise<number[]> {
  const una = () => cliente.fIR.findFirst({ where: { tenantId: TENANT } })
  const giro = async (): Promise<number> => {
    const t0 = process.hrtime.bigint()
    if (conTenant) {
      await TenantContext.run({ tenantId: TENANT }, una)
    } else {
      await una()
    }
    return Number(process.hrtime.bigint() - t0) / 1e6
  }
  for (let i = 0; i < RISCALDAMENTO; i++) await giro()
  const tempi: number[] = []
  for (let i = 0; i < N; i++) tempi.push(await giro())
  return tempi
}

function riassunto(tempi: number[]) {
  const ord = [...tempi].sort((a, b) => a - b)
  const media = tempi.reduce((s, t) => s + t, 0) / tempi.length
  return { media, p95: ord[Math.floor(ord.length * 0.95) - 1] }
}

async function main() {
  const nudo = new PrismaService()
  const esteso = creaPrismaServiceApplicativo()
  await nudo.$connect()
  await esteso.onModuleInit()
  try {
    const righe: Array<[string, { media: number; p95: number }]> = []
    righe.push(['A nudo, senza tenant     ', riassunto(await misura(nudo as never, false))])
    righe.push(['B esteso, senza tenant   ', riassunto(await misura(esteso as never, false))])
    righe.push(['C nudo, con tenant       ', riassunto(await misura(nudo as never, true))])
    righe.push(['D esteso, con tenant     ', riassunto(await misura(esteso as never, true))])
    console.log(`findFirst su fir, ${N} operazioni per scenario (ms)`)
    for (const [nome, r] of righe) {
      console.log(`${nome} media ${r.media.toFixed(2)}  p95 ${r.p95.toFixed(2)}`)
    }
    console.log(
      `D - C: +${(righe[3][1].media - righe[2][1].media).toFixed(2)} ms medi per operazione`
    )
  } finally {
    await esteso.onModuleDestroy()
    await nudo.$disconnect()
  }
}

main().catch(e => {
  console.error(e)
  process.exit(1)
})
