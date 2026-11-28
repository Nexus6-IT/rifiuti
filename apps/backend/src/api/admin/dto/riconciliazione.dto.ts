import {
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  Min,
} from 'class-validator'

/** `?tenantId=` delle rotte di lettura: l'azienda di cui si riconcilia l'import. */
export class TenantRiconciliazioneQuery {
  @IsUUID()
  tenantId!: string
}

export class EsitoCampioneDto {
  @IsUUID()
  tenantId!: string

  @IsIn(['CORRISPONDE', 'NON_CORRISPONDE'])
  esito!: 'CORRISPONDE' | 'NON_CORRISPONDE'

  @IsOptional()
  @IsString()
  @MaxLength(500)
  nota?: string
}

export class AccettaDifferenzaDto {
  @IsUUID()
  tenantId!: string

  /** Versione del rapporto che l'operatore ha letto: se e' cambiata, 409. */
  @IsInt()
  @Min(1)
  versione!: number

  /** `<confronto>:<voce>`, come restituita dal rapporto. */
  @IsString()
  @IsNotEmpty()
  @MaxLength(300)
  chiave!: string

  @IsString()
  @MaxLength(1000)
  motivo!: string
}

export class ChiudiRapportoDto {
  @IsUUID()
  tenantId!: string

  @IsInt()
  @Min(1)
  versione!: number
}
