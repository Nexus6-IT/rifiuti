/** Le variazioni di massa toccano tutto l'archivio: solo SUPER_ADMIN e ADMIN (R11). */
export const RUOLI_VARIAZIONI: readonly string[] = ['SUPER_ADMIN', 'ADMIN']

export function puoVariarePrezzi(role: string | null | undefined): boolean {
  return !!role && RUOLI_VARIAZIONI.includes(role)
}
