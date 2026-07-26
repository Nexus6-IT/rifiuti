import { FIR } from '../../domain/fir/aggregates/fir.aggregate'
import { FormularioModel } from '../../infrastructure/rentri/rentri-api.client'

/** Token DI per iniettare {@link CreaFIRDaFormularioRENTRIPort} (interfaccia cancellata a runtime). */
export const CREA_FIR_DA_FORMULARIO_RENTRI_PORT = Symbol('CREA_FIR_DA_FORMULARIO_RENTRI_PORT')

/**
 * Porta verso la creazione del FIR locale a partire dal dettaglio RENTRI di
 * un formulario di cui si è appena acquisita la visibilità (ramo "aggancia
 * come nuovo formulario" di `AcquisisciFormularioRENTRIUseCase`, R2 Task 4).
 *
 * La mappatura dettaglio RENTRI → FIR locale è il **Task 5** (creazione FIR
 * da RENTRI), NON ancora implementato in questo worktree (v.
 * `task-3-brief.md`, riga 6: "il record locale viene creato da zero a
 * partire dal dettaglio RENTRI (Task 5)"). Questo task (4) orchestra fino al
 * punto di invocare questa porta e poi `FIR.agganciaFormularioAcquisito` sul
 * FIR restituito — la costruzione del FIR in sé è responsabilità del Task 5.
 *
 * Isolata come porta (non una dipendenza diretta su una classe concreta)
 * così che l'implementazione reale del Task 5 possa sostituire il
 * placeholder registrato oggi (v. `CreaFIRDaFormularioRENTRINonImplementatoAdapter`)
 * senza toccare `AcquisisciFormularioRENTRIUseCase`.
 */
export interface CreaFIRDaFormularioRENTRIPort {
  creaDaDettaglio(
    tenantId: string,
    userId: string,
    dettaglio: FormularioModel,
    numeroFir: string
  ): Promise<FIR>
}
