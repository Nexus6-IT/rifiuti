import type { CausaleMovimento, WasteMovementType } from '../../../domain/waste-movement/waste-movement.entity'

/**
 * Command per la registrazione di un movimento nel registro cronologico
 * di carico/scarico (art. 190 D.Lgs 152/2006, DM 59/2023).
 */
export class RegistraMovimentoCommand {
  constructor(
    /** ID del tenant (multi-tenant scoping). */
    public readonly tenantId: string,
    /** ID utente che effettua la registrazione. */
    public readonly userId: string,
    /** Tipo movimento: CARICO (produzione/ingresso) o SCARICO (conferimento/uscita). */
    public readonly type: WasteMovementType,
    /** Data effettiva dell'operazione. */
    public readonly movementDate: Date,
    /** Data di annotazione nel registro (default: ora corrente). */
    public readonly registrationDate: Date,
    /** Causale specifica del movimento. */
    public readonly causale: CausaleMovimento,
    /** Codice CER (formato canonico "NN NN NN"). */
    public readonly cerCode: string,
    /** Descrizione del rifiuto. */
    public readonly wasteDescription: string | undefined,
    /** Quantità (kg o altra unità). */
    public readonly quantity: number,
    /** Unità di misura (default KG). */
    public readonly unit: string,
    /** Stato fisico del rifiuto. */
    public readonly wastePhysicalState: string | undefined,
    /** Caratteristiche di pericolo HP (es. "HP4,HP14"). */
    public readonly wasteHazardClasses: string | undefined,
    /** Codice operazione R/D (es. "R1", "D13"). */
    public readonly operationCode: string | undefined,
    /** Denominazione della controparte. */
    public readonly counterpartName: string | undefined,
    /** Indirizzo impianto/sede della controparte. */
    public readonly counterpartAddress: string | undefined,
    /** ID del FIR collegato (obbligatorio per SCARICO con causale CONFERIMENTO_TRASPORTATORE). */
    public readonly firId: string | undefined,
    /** Note libere. */
    public readonly notes: string | undefined,
  ) {}
}
