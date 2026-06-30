import { IsIn } from 'class-validator'

/**
 * SetTenantStatusDto
 * Body per sospendere/riattivare un tenant.
 * Sono ammessi solo i due stati operativi gestibili da admin: SUSPENDED / ACTIVE.
 * (Gli stati TRIAL/EXPIRED sono guidati dal ciclo di vita della subscription.)
 */
export class SetTenantStatusDto {
  @IsIn(['SUSPENDED', 'ACTIVE'], {
    message: 'status deve essere SUSPENDED o ACTIVE',
  })
  status!: 'SUSPENDED' | 'ACTIVE'
}
