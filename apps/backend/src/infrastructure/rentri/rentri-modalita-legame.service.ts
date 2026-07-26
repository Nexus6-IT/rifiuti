import { Injectable, BadRequestException } from '@nestjs/common'
import { RentriModalitaLegame } from '@prisma/client'
import { PrismaService } from '../persistence/prisma.service'
import { RentriCredentialService } from './rentri-credential.service'

/** Stato della modalità di legame RENTRI del tenant. */
export interface RentriModalitaLegameStatus {
  modalitaLegame: RentriModalitaLegame
  /** Se il tenant ha una credenziale RENTRI configurata (vedi RentriCredentialService). */
  certificatoConfigurato: boolean
}

/**
 * Modalità che richiedono una trasmissione automatica (parziale o totale)
 * verso RENTRI, quindi un certificato valido già configurato: senza, si
 * produrrebbe solo una fila di trasmissioni fallite (RENTRI risponde 423 e
 * banda il client che insiste con richieste non valide).
 */
const MODALITA_CHE_RICHIEDONO_CERTIFICATO: RentriModalitaLegame[] = ['AUTOMATICA', 'IBRIDA']

/**
 * Gestisce la modalità con cui il tenant lega i FIR ai formulari RENTRI
 * (Tenant.rentriModalitaLegame). Cambiare modalità è un'operazione che vale
 * solo per il futuro: non modifica in alcun modo i FIR già trasmessi/agganciati
 * (rentriNumeroFir/rentriOrigineLegame), che restano quelli che erano.
 */
@Injectable()
export class RentriModalitaLegameService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly credentialService: RentriCredentialService
  ) {}

  /** Ritorna la modalità corrente del tenant e se ha un certificato configurato. */
  async getForTenant(tenantId: string): Promise<RentriModalitaLegameStatus> {
    const tenant = await this.prisma.tenant.findUniqueOrThrow({
      where: { id: tenantId },
      select: { rentriModalitaLegame: true },
    })
    const certificatoConfigurato = await this.credentialService.hasForTenant(tenantId)

    return { modalitaLegame: tenant.rentriModalitaLegame, certificatoConfigurato }
  }

  /**
   * Imposta la modalità del tenant. AUTOMATICA e IBRIDA sono rifiutate (400)
   * se il tenant non ha un certificato RENTRI valido configurato. L'update
   * tocca SOLO la riga del tenant: nessun FIR esistente viene modificato.
   */
  async setForTenant(
    tenantId: string,
    modalitaLegame: RentriModalitaLegame
  ): Promise<RentriModalitaLegameStatus> {
    const certificatoConfigurato = await this.credentialService.hasForTenant(tenantId)

    if (MODALITA_CHE_RICHIEDONO_CERTIFICATO.includes(modalitaLegame) && !certificatoConfigurato) {
      throw new BadRequestException(
        'Per selezionare questa modalità serve prima un certificato RENTRI valido configurato per il tenant.'
      )
    }

    const tenant = await this.prisma.tenant.update({
      where: { id: tenantId },
      data: { rentriModalitaLegame: modalitaLegame },
      select: { rentriModalitaLegame: true },
    })

    return { modalitaLegame: tenant.rentriModalitaLegame, certificatoConfigurato }
  }
}
