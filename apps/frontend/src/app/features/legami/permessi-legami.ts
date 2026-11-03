/** Solo ADMIN e SUPER_ADMIN impostano «fatturazione da» (spec §9). */
export const RUOLI_IMPOSTAZIONE_FATTURAZIONE: readonly string[] = ['SUPER_ADMIN', 'ADMIN']

export function puoImpostareFatturazione(role: string | null | undefined): boolean {
  return !!role && RUOLI_IMPOSTAZIONE_FATTURAZIONE.includes(role)
}
