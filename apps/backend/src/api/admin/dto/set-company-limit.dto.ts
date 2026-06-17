import { IsInt, Min } from 'class-validator';

/**
 * SetCompanyLimitDto
 * Payload per impostare la quota di aziende creabili in autonomia da un utente
 * (endpoint riservato al SUPER_ADMIN).
 */
export class SetCompanyLimitDto {
  @IsInt()
  @Min(0)
  companyLimit!: number;
}
