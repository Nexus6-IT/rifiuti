import { IsBoolean, IsOptional, IsString, MaxLength } from 'class-validator'
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'

/** Corpo del PUT mud/obbligo (decisione A-W-10). */
export class ImpostaObbligoMudDto {
  @ApiProperty({
    description: "Vero se l'azienda non è tenuta alla presentazione del MUD",
    example: true,
  })
  @IsBoolean()
  mudNonDovuto: boolean

  @ApiPropertyOptional({
    description:
      "Perché l'azienda non è tenuta al MUD: obbligatorio (5-500 caratteri) con il flag attivo, ignorato altrimenti",
    example: 'Produttore di soli rifiuti non pericolosi con meno di 10 dipendenti',
    maxLength: 500,
  })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  motivo?: string
}
