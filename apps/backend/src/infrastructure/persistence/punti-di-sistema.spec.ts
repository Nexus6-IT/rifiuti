import { readdirSync, readFileSync, statSync } from 'fs'
import { join, relative, sep } from 'path'

const SRC = join(__dirname, '..', '..')

/**
 * Elenco esplicito dei file sotto src/ che usano il client di sistema
 * (`PrismaSistemaService`, ruolo BYPASSRLS). Una riga di motivo per ciascuno.
 * Criterio: README-tenant-transazione.md, sezione "Quando usare il client di sistema".
 * Aggiungere un file qui e' una decisione da motivare, non una formalita'.
 */
const PUNTI_DI_SISTEMA: Record<string, string> = {
  'api/me/membership.service.ts':
    "aziende possedute, associate e figlie: elenco prima di conoscere l'azienda di destinazione",
  'api/me/ruolo-effettivo.service.ts':
    'azienda di destinazione e associazioni consulente diverse da quella del contesto (anche al refresh)',
  'application/admin/impersonation.service.ts':
    "l'utente da impersonare appartiene a un'altra azienda rispetto al super admin",
  'application/admin/system-health/evidenze-db.service.ts':
    'pagina "Stato del sistema" solo SUPER_ADMIN: letture su tutte le aziende',
  'application/admin/system-health/job-actions.service.ts':
    'storico dei rilanci manuali di tutte le aziende, solo SUPER_ADMIN',
  'application/admin/tenant.service.ts':
    "elenco di tutte le aziende per il super admin e lookup dell'utente chiamante",
  'application/admin/user-admin.service.ts':
    "elenco utenti su tutte le aziende e lookup per id del super admin prima di conoscere l'azienda",
  'application/notifications/deadline-checker.service.ts':
    'scansione di tutte le aziende attive e delle loro scadenze',
  'application/notifications/notification-escalation.service.ts':
    'scansione delle notifiche non lette di tutte le aziende',
  'auth/controllers/auth.controller.ts':
    "callback SPID e refresh: l'utente si cerca prima di conoscerne l'azienda",
  'auth/controllers/dev-auth.controller.ts':
    "login di sviluppo: l'utente si cerca prima di conoscerne l'azienda",
  'auth/strategies/jwt.strategy.ts':
    "il super admin con X-Tenant-ID di un'altra azienda deve trovare comunque il proprio utente",
  'auth/strategies/spid.strategy.ts': 'il codice fiscale si cerca su tutte le aziende al login',
  'infrastructure/jobs/cleanup-old-permission-requests.job.ts':
    'scansione dei permessi temporanei vecchi di tutte le aziende',
  'infrastructure/jobs/rentri-certificato-scadenza.job.ts':
    'scansione di tutte le aziende attive e delle loro credenziali RENTRI',
  'infrastructure/jobs/rentri-riconciliazione.job.ts':
    'elenco di tutte le aziende attive, poi ogni azienda nel suo contesto',
  'infrastructure/jobs/rentri-rifornimento-scorta.job.ts':
    'elenco di tutte le aziende attive, poi ogni azienda nel suo contesto',
  'infrastructure/persistence/fir-prisma.repository.ts':
    'verifica pubblica del FIR (azienda ignota) e recupero dei FIR di tutte le aziende',
  'infrastructure/persistence/temporary-permission-grant.repository.ts':
    "senza azienda e' la scansione di tutte le aziende del job di pulizia",
  'infrastructure/signatures/signature-fir.repository.ts':
    'verifica pubblica del FIR da QR code: azienda ignota prima della lettura',
}

/** Definizione e registrazione del client: infrastruttura, non usi. */
const INFRASTRUTTURA = new Set([
  'infrastructure/persistence/prisma-sistema.service.ts',
  'infrastructure/persistence/prisma.module.ts',
])

function sorgenti(dir: string): string[] {
  return readdirSync(dir).flatMap(nome => {
    const percorso = join(dir, nome)
    if (statSync(percorso).isDirectory()) return sorgenti(percorso)
    return nome.endsWith('.ts') && !nome.endsWith('.spec.ts') ? [percorso] : []
  })
}

function senzaCommenti(testo: string): string {
  return testo.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')
}

function usano(): string[] {
  return sorgenti(SRC)
    .map(f => relative(SRC, f).split(sep).join('/'))
    .filter(rel => !INFRASTRUTTURA.has(rel))
    .filter(rel =>
      /\bPrismaSistemaService\b/.test(senzaCommenti(readFileSync(join(SRC, rel), 'utf8')))
    )
    .sort()
}

describe('punti di sistema', () => {
  it("punti di sistema: i file che usano PrismaSistemaService sono esattamente quelli dell'elenco", () => {
    const trovati = usano()
    const elencati = Object.keys(PUNTI_DI_SISTEMA).sort()
    const nuovi = trovati.filter(f => !elencati.includes(f))
    const obsoleti = elencati.filter(f => !trovati.includes(f))
    expect({ nuovi, obsoleti }).toEqual({ nuovi: [], obsoleti: [] })
  })

  it("ogni voce dell'elenco ha un motivo", () => {
    for (const [file, motivo] of Object.entries(PUNTI_DI_SISTEMA)) {
      expect({ file, ok: motivo.trim().length > 10 }).toEqual({ file, ok: true })
    }
  })
})
