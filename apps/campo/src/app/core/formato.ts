/** 'gg/mm HH:MM' locale dell'istante ISO; trattino se non valido. */
export function formattaAggiornamento(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  const due = (n: number) => String(n).padStart(2, '0');
  return `${due(d.getDate())}/${due(d.getMonth() + 1)} ${due(d.getHours())}:${due(d.getMinutes())}`;
}
