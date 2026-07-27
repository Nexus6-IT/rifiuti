-- CreateEnum
CREATE TYPE "rentri_stato_formulario" AS ENUM ('InserimentoQuantita', 'InserimentoQuantitaTrasportoIniziale', 'InserimentoTrasportoIniziale', 'FirmaProduttoreTrasportatoreIniziale', 'FirmaTrasportatoreIniziale', 'FirmaProduttore', 'InserimentoTrasportoSuccessivo', 'FirmaTrasportatoreSuccessivo', 'FirmaAnnotazione', 'FirmaTrasbordoParziale', 'FirmaTrasbordoTotale', 'FirmaSostaTecnica', 'FirmaAllegato', 'InserimentoAccettazione', 'FirmaAccettazione', 'Accettato', 'RespintoAccettatoParzialmente', 'FirmaDestinatarioSuccessivo', 'FirmaAccettazioneSuccessiva', 'FirmaAnnullamento', 'Annullato', 'Indeterminato');

-- Colonna nullable: un FIR non legato a RENTRI non ha uno stato presso
-- l'ente, e nullable e' l'unico modo onesto di dirlo. Nessun DROP, nessun
-- TRUNCATE, nessuna colonna obbligatoria su dati esistenti.
-- AlterTable
ALTER TABLE "firs" ADD COLUMN     "rentri_stato_formulario" "rentri_stato_formulario";

-- NOTA: `prisma migrate dev` ha accodato qui, come sempre, un
--   ALTER TABLE "notifications" ALTER COLUMN "expires_at" SET DEFAULT ...
-- che NON e' stato richiesto da questa modifica ed e' stato rimosso a mano.
-- E' il falso positivo noto del differ di Prisma, l'unico rimasto dopo la
-- bonifica del drift (v. il commento sopra quel campo in schema.prisma).
-- Se in una prossima migrazione ne comparisse piu' di una, NON e' questo caso
-- noto: il drift e' tornato e va affrontato prima di proseguire.
