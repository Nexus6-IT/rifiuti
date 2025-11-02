import { FIR } from './fir.aggregate';

export interface FIRRepository {
  findById(id: string): Promise<FIR | null>;
  findByIdPublic(id: string): Promise<FIR | null>; // Public access without tenant filter
  findByNumeroProgressivo(numero: string, tenantId: string): Promise<FIR | null>;
  save(fir: FIR): Promise<FIR>;
  update(fir: FIR): Promise<FIR>;
  delete(id: string): Promise<void>;

  /**
   * T185: Get current workload (total estimated weight of assigned FIRs) for a driver
   * Used for task assignment routing to balance workload
   */
  getCurrentWorkloadByDriver(driverId: string, tenantId: string): Promise<number>;
}

export const FIR_REPOSITORY = Symbol('FIR_REPOSITORY');
