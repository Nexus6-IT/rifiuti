-- CreateEnum
CREATE TYPE "provenienza_rifiuto" AS ENUM ('URBANO', 'SPECIALE');

-- AlterTable
ALTER TABLE "firs" ADD COLUMN     "provenienza" "provenienza_rifiuto",
ADD COLUMN     "tipo_tratta_principale" "tipo_tratta";
