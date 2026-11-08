import { Pipe, PipeTransform } from '@angular/core'

/** Voce del vocabolario: verbo all'infinito e oggetto con l'articolo («i FIR», «le notifiche»). */
type Voce = readonly [verbo: string, oggetto: string]

/**
 * PermissionFormatPipe
 * Trasforma un permesso tecnico (`risorsa:azione:ambito`) in una frase italiana breve.
 *
 * Uso:
 * ```
 * {{ 'analytics:view-dashboard:all' | permissionFormat }}   // «Vedere le analisi della dashboard»
 * {{ 'fir:create:facility' | permissionFormat }}            // «Creare i FIR delle sedi assegnate»
 * {{ 'fir:create:facility' | permissionFormat:'short' }}    // «Creare i FIR»
 * {{ '*' | permissionFormat }}                              // «Tutti i permessi»
 * ```
 *
 * Il vocabolario è chiuso sui permessi dei ruoli di sistema del backend
 * (`application/admin/system-roles.ts`): niente stringhe inglesi per quelli noti. Un permesso non
 * censito si compone da azione e risorsa generiche, sempre in italiano.
 *
 * Termini tecnici (FIR, report, backup, log, tenant, KPI) restano nella forma originale.
 */
@Pipe({
  name: 'permissionFormat',
  standalone: true,
})
export class PermissionFormatPipe implements PipeTransform {
  /** `risorsa:azione` -> frase (l'ambito si aggiunge dopo). */
  private readonly vocabolario: Record<string, Voce> = {
    'fir:create': ['Creare', 'i FIR'],
    'fir:read': ['Vedere', 'i FIR'],
    'fir:update': ['Modificare', 'i FIR'],
    'fir:delete': ['Eliminare', 'i FIR'],
    'fir:sign': ['Firmare', 'i FIR'],
    'fir:export': ['Esportare', 'i FIR'],
    'facility:create': ['Creare', 'le sedi'],
    'facility:read': ['Vedere', 'le sedi'],
    'facility:update': ['Modificare', 'le sedi'],
    'facility:delete': ['Eliminare', 'le sedi'],
    'facility:manage-registry': ['Gestire', 'il registro della sede'],
    'facility:assign-users': ['Assegnare', 'gli utenti alle sedi'],
    'facility:view-analytics': ['Vedere', 'le analisi delle sedi'],
    'facility:configure': ['Configurare', 'le sedi'],
    'user:create': ['Creare', 'gli utenti'],
    'user:read': ['Vedere', 'gli utenti'],
    'user:update': ['Modificare', 'gli utenti'],
    'user:delete': ['Eliminare', 'gli utenti'],
    'user:manage-roles': ['Gestire', 'i ruoli degli utenti'],
    'user:view-activity': ['Vedere', "l'attività degli utenti"],
    'user:impersonate': ['Impersonare', 'gli utenti'],
    'report:create': ['Creare', 'i report'],
    'report:read': ['Vedere', 'i report'],
    'report:export': ['Esportare', 'i report'],
    'report:schedule': ['Programmare', 'i report'],
    'report:share': ['Condividere', 'i report'],
    'analytics:view-dashboard': ['Vedere', 'le analisi della dashboard'],
    'analytics:view-kpis': ['Vedere', 'gli indicatori (KPI)'],
    'analytics:export-data': ['Esportare', 'i dati delle analisi'],
    'analytics:configure-metrics': ['Configurare', 'le metriche'],
    'notification:read': ['Vedere', 'le notifiche'],
    'notification:manage': ['Gestire', 'le notifiche'],
    'notification:send': ['Inviare', 'le notifiche'],
    'admin:view-audit-log': ['Vedere', 'il registro delle attività'],
    'admin:manage-roles': ['Gestire', 'i ruoli'],
    'admin:manage-permissions': ['Gestire', 'i permessi'],
    'admin:configure-tenant': ['Configurare', "l'azienda"],
    'admin:manage-subscriptions': ['Gestire', 'gli abbonamenti'],
    'admin:view-system-health': ['Vedere', 'lo stato del sistema'],
    'system:manage-integrations': ['Gestire', 'le integrazioni'],
    'system:manage-backups': ['Gestire', 'i backup'],
    'system:view-logs': ['Vedere', 'i log'],
    'role:create': ['Creare', 'i ruoli'],
    'role:update': ['Modificare', 'i ruoli'],
    'role:delete': ['Eliminare', 'i ruoli'],
    'audit:read': ['Vedere', "l'audit dei permessi"],
    'audit:export': ['Esportare', "l'audit dei permessi"],
    'consultant:manage': ['Gestire', "l'accesso dei consulenti"],
  }

  /** Per i permessi non censiti: verbo e risorsa generici. */
  private readonly verbi: Record<string, string> = {
    create: 'Creare',
    read: 'Vedere',
    update: 'Modificare',
    delete: 'Eliminare',
    assign: 'Assegnare',
    revoke: 'Revocare',
    export: 'Esportare',
    sign: 'Firmare',
    manage: 'Gestire',
    send: 'Inviare',
    configure: 'Configurare',
    impersonate: 'Impersonare',
    view: 'Vedere',
  }
  private readonly risorse: Record<string, string> = {
    fir: 'i FIR',
    user: 'gli utenti',
    role: 'i ruoli',
    permission: 'i permessi',
    tenant: 'le aziende',
    analytics: 'le analisi',
    mud: 'il MUD',
    backup: 'i backup',
  }

  /** Articolo -> forma con «propri» (`own`). */
  private readonly proprio: Record<string, string> = {
    i: 'i propri',
    le: 'le proprie',
    gli: 'i propri',
    il: 'il proprio',
    la: 'la propria',
  }

  /**
   * @param permission Permesso (es. «fir:create:facility»)
   * @param mode «long» (con l'ambito, default) o «short» (solo azione e oggetto)
   */
  transform(permission: string, mode: 'long' | 'short' = 'long'): string {
    if (permission === '*' || permission === '*:*:*') {
      return 'Tutti i permessi'
    }
    if (!permission || typeof permission !== 'string') {
      return 'Permesso non valido'
    }
    const parti = permission.split(':')
    if (parti.length !== 3) {
      return 'Permesso non valido'
    }
    const [risorsa, azione, ambito] = parti

    const [verbo, oggetto] = this.vocabolario[`${risorsa}:${azione}`] ?? [
      this.verbi[azione] ?? this.maiuscolaIniziale(azione.replace(/-/g, ' ')),
      this.risorse[risorsa] ?? risorsa,
    ]

    if (mode === 'short') {
      return `${verbo} ${oggetto}`
    }
    return this.conAmbito(verbo, oggetto, ambito)
  }

  /** «own» = i propri, «facility» = delle sedi assegnate, «all» = nessuna precisazione. */
  private conAmbito(verbo: string, oggetto: string, ambito: string): string {
    if (ambito === 'facility') {
      return `${verbo} ${oggetto} delle sedi assegnate`
    }
    if (ambito === 'own') {
      const m = /^(i|le|gli|il|la) (.+)$/.exec(oggetto)
      if (m) {
        return `${verbo} ${this.proprio[m[1]]} ${m[2]}`
      }
      return `${verbo} ${oggetto} (solo i propri)`
    }
    return `${verbo} ${oggetto}`
  }

  private maiuscolaIniziale(testo: string): string {
    return testo.charAt(0).toUpperCase() + testo.slice(1)
  }
}
