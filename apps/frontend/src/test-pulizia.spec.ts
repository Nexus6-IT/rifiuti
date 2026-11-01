/**
 * Salvaguardia globale fra uno spec e l'altro (Jasmine esegue gli hook di primo livello per
 * ogni spec di ogni file).
 *
 * PERCHE': PrimeNG monta dialog, maschere, overlay e toast direttamente in `document.body`,
 * fuori dal fixture. Uno spec che apre un dialog e non lo chiude (o non distrugge il fixture)
 * lascia li' `.p-dialog-mask` & co.; con l'ordine casuale quei residui finiscono davanti agli
 * spec successivi, che cercano `.p-dialog` con `document.querySelector` o si aspettano che
 * `document.activeElement` sia un loro elemento. Il difetto compare solo con certi semi, e si
 * aggrava ad ogni spec nuovo. Qui si riparte ogni volta da un body pulito e senza focus.
 *
 * Si pulisce in `beforeEach` (dopo il teardown del TestBed dello spec precedente), non in
 * `afterEach`, cosi' non si strappa il DOM a un fixture ancora vivo.
 */
const RESIDUI_PRIMENG = [
  '.p-dialog-mask',
  '.p-dialog',
  '.p-overlay',
  '.p-component-overlay',
  '.p-toast',
  '.p-confirm-dialog',
  '.p-confirm-popup',
  '.p-tooltip',
  '.p-datepicker-panel',
  '.p-sidebar-mask',
].join(',')

beforeEach(() => {
  document.body.querySelectorAll(RESIDUI_PRIMENG).forEach(el => el.remove())
  document.body.classList.remove('p-overflow-hidden')
  const attivo = document.activeElement as HTMLElement | null
  if (attivo && attivo !== document.body) attivo.blur()
})
