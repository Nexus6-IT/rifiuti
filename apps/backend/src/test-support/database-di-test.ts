/**
 * Controllo "il database di test e' locale": vero solo per
 * `postgresql://<utente>[:<password>]@(127.0.0.1|localhost):<porta>/wasteflow_ci[?...]`.
 *
 * Sostituisce il controllo fisso sulla porta 55432: conserva lo scopo (le suite non girano mai
 * contro un database vero) ma funziona su qualunque porta locale (CI 55432, worktree 55434...).
 * Non registra ne' restituisce mai l'URL (contiene la password).
 */
export function eDatabaseDiTestLocale(url: string | null | undefined): boolean {
  if (!url) return false
  let u: URL
  try {
    u = new URL(url)
  } catch {
    return false
  }
  if (u.protocol !== 'postgresql:' && u.protocol !== 'postgres:') return false
  if (u.hostname !== '127.0.0.1' && u.hostname !== 'localhost') return false
  if (!/^[0-9]{1,5}$/.test(u.port)) return false
  return u.pathname === '/wasteflow_ci'
}
