import { Pipe, PipeTransform } from '@angular/core'

/**
 * RoleDescriptionPipe
 * Trasforma il nome (o l'id) di un ruolo nel testo italiano da mostrare.
 *
 * Uso:
 * ```
 * {{ 'OPERATOR' | roleDescription }}           // descrizione lunga
 * {{ 'OPERATOR' | roleDescription:'name' }}    // «Operatore»
 * {{ 'ADMIN' | roleDescription:'short' }}      // «Accesso completo al sistema»
 * ```
 *
 * Regole (restyle giro 2, Task 15):
 * - mai un codice inglese per i ruoli noti (ADMIN, OPERATOR, VIEWER, CONSULTANT,
 *   COMPLIANCE_OFFICER, SUPER_ADMIN e gli alias storici);
 * - i nomi sono in sentence case («Amministratore di sistema»): il maiuscolo continuo non si usa;
 * - un ruolo personalizzato (creato dall'azienda) si legge comunque in italiano.
 */
@Pipe({
  name: 'roleDescription',
  standalone: true,
})
export class RoleDescriptionPipe implements PipeTransform {
  private readonly roleMetadata: Record<
    string,
    {
      displayName: string
      shortDescription: string
      longDescription: string
    }
  > = {
    SUPER_ADMIN: {
      displayName: 'Super amministratore',
      shortDescription: 'Gestione della piattaforma',
      longDescription:
        'Il super amministratore gestisce la piattaforma: aziende, utenti, abbonamenti e stato del sistema.',
    },
    SYSTEM_ADMIN: {
      displayName: 'Amministratore di sistema',
      shortDescription: 'Accesso completo al sistema',
      longDescription:
        "L'amministratore di sistema ha il controllo completo dell'azienda: utenti, ruoli, permessi e tutte le attività operative.",
    },
    FACILITY_MANAGER: {
      displayName: 'Responsabile di sede',
      shortDescription: "Gestisce l'attività della sede",
      longDescription:
        'Il responsabile di sede coordina la gestione dei rifiuti nelle sedi assegnate: crea i FIR, gestisce il personale e consulta le analisi.',
    },
    FIELD_OPERATOR: {
      displayName: 'Operatore',
      shortDescription: 'Crea e gestisce i FIR',
      longDescription:
        'L’operatore lavora sul campo: crea e gestisce i FIR per la raccolta, il trasporto e lo smaltimento dei rifiuti.',
    },
    COMPLIANCE_OFFICER: {
      displayName: 'Responsabile della conformità',
      shortDescription: 'Controlla il registro delle attività',
      longDescription:
        'Il responsabile della conformità controlla il registro delle attività sui permessi, prepara i report per le verifiche degli enti e cura il rispetto delle norme ARPA.',
    },
    ENVIRONMENTAL_CONSULTANT: {
      displayName: 'Consulente ambientale',
      shortDescription: 'Segue più aziende clienti',
      longDescription:
        'Il consulente ambientale offre la sua competenza a più aziende clienti: può passare da un’azienda all’altra e consultare i dati riepilogativi.',
    },
    VIEWER: {
      displayName: 'Visualizzatore',
      shortDescription: 'Accesso in sola lettura',
      longDescription:
        'Il visualizzatore consulta FIR e report delle sedi assegnate, senza poter creare o modificare dati.',
    },
    UNKNOWN: {
      displayName: 'Ruolo non disponibile',
      shortDescription: 'Ruolo non ancora caricato',
      longDescription: 'Il ruolo non è ancora disponibile: riprova tra qualche istante.',
    },
  }

  /** Alias storici e nomi brevi (i ruoli di sistema del backend si chiamano ADMIN, OPERATOR, ...). */
  private readonly nameMap: Record<string, string> = {
    ADMIN: 'SYSTEM_ADMIN',
    ADMINISTRATOR: 'SYSTEM_ADMIN',
    MANAGER: 'FACILITY_MANAGER',
    OPERATOR: 'FIELD_OPERATOR',
    CONSULTANT: 'ENVIRONMENTAL_CONSULTANT',
    AUDITOR: 'COMPLIANCE_OFFICER',
    OFFICER: 'COMPLIANCE_OFFICER',
    'READ-ONLY': 'VIEWER',
    READONLY: 'VIEWER',
  }

  /**
   * @param roleNameOrId Nome del ruolo (es. «OPERATOR») o suo id
   * @param mode «name» (nome), «short» (descrizione breve) o «long» (descrizione estesa, default)
   */
  transform(roleNameOrId: string, mode: 'name' | 'short' | 'long' = 'long'): string {
    if (!roleNameOrId || typeof roleNameOrId !== 'string') {
      return 'Ruolo sconosciuto'
    }

    const metadata = this.roleMetadata[this.normalizeRoleName(roleNameOrId)]
    if (!metadata) {
      return this.formatUnknownRole(roleNameOrId, mode)
    }

    switch (mode) {
      case 'name':
        return metadata.displayName
      case 'short':
        return metadata.shortDescription
      case 'long':
      default:
        return metadata.longDescription
    }
  }

  private normalizeRoleName(roleNameOrId: string): string {
    // Un id (uuid) non si può ricondurre a un nome: resta com'è.
    if (roleNameOrId.includes('-') && roleNameOrId.length > 20) {
      return roleNameOrId
    }
    const normalized = roleNameOrId.toUpperCase().trim()
    return this.nameMap[normalized] || normalized
  }

  /** Ruolo personalizzato: «RESPONSABILE_MAGAZZINO» diventa «Responsabile magazzino». */
  private formatUnknownRole(roleNameOrId: string, mode: 'name' | 'short' | 'long'): string {
    const parole = roleNameOrId.replace(/[_-]/g, ' ').trim().toLowerCase()
    const formatted = parole.charAt(0).toUpperCase() + parole.slice(1)

    switch (mode) {
      case 'name':
        return formatted
      case 'short':
        return `Ruolo personalizzato: ${formatted}`
      case 'long':
      default:
        return `Questo è un ruolo personalizzato chiamato «${formatted}». Per sapere cosa può fare, rivolgiti all'amministratore.`
    }
  }

  /** Tutti i ruoli noti, per i menu a tendina. */
  getAllRoles(): Array<{
    name: string
    displayName: string
    description: string
  }> {
    return Object.entries(this.roleMetadata)
      .filter(([name]) => name !== 'UNKNOWN')
      .map(([name, metadata]) => ({
        name,
        displayName: metadata.displayName,
        description: metadata.shortDescription,
      }))
  }
}
