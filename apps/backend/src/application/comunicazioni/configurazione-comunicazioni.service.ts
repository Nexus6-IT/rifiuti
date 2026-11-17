import { Injectable } from '@nestjs/common'
import type { Prisma } from '@prisma/client'
import {
  CONSORZI_CONFIGURABILI,
  VERSIONE_SCHEMA_CONFIGURAZIONE,
  configurazionePredefinita,
  validaConfigurazione,
  type ConfigurazionePerConsorzio,
  type ConsorzioConfigurabile,
} from '../../domain/comunicazioni/configurazione-sede'
import { PrismaService } from '../../infrastructure/persistence/prisma.service'
import {
  ConfigurazioneComunicazioniNonValidaError,
  UnitaLocaleNonTrovataError,
  type ConfigurazioneComunicazioniPort,
  type ConfigurazioneVista,
} from './configurazione-comunicazioni.port'

/**
 * Configurazione delle comunicazioni per sede propria e consorzio (4.9c-f, D4): una riga per
 * (sede, consorzio), con `dati` validati dallo schema del consorzio.
 */
@Injectable()
export class ConfigurazioneComunicazioniService implements ConfigurazioneComunicazioniPort {
  constructor(private readonly prisma: PrismaService) {}

  private controllaConsorzio(consorzio: string): asserts consorzio is ConsorzioConfigurabile {
    if (!(CONSORZI_CONFIGURABILI as readonly string[]).includes(consorzio)) {
      throw new ConfigurazioneComunicazioniNonValidaError([`consorzio sconosciuto: ${consorzio}`])
    }
  }

  private async controllaSede(tenantId: string, unitaLocaleId: string): Promise<void> {
    const u = await this.prisma.rentriUnitaLocale.findFirst({
      where: { id: unitaLocaleId, tenantId },
      select: { id: true },
    })
    if (!u) throw new UnitaLocaleNonTrovataError()
  }

  async leggi<C extends ConsorzioConfigurabile>(
    tenantId: string,
    unitaLocaleId: string,
    consorzio: C
  ): Promise<ConfigurazioneVista<C>> {
    this.controllaConsorzio(consorzio)
    await this.controllaSede(tenantId, unitaLocaleId)
    const riga = await this.prisma.configurazioneComunicazioneSede.findFirst({
      where: { tenantId, unitaLocaleId, consorzio },
    })
    if (!riga) {
      return {
        unitaLocaleId,
        consorzio,
        salvata: false,
        dati: configurazionePredefinita(consorzio),
      }
    }
    // Una riga scritta da una versione precedente dello schema si rilegge completandola coi predefiniti.
    const esito = validaConfigurazione(consorzio, riga.dati)
    const dati = esito.ok ? esito.valore : configurazionePredefinita(consorzio)
    return { unitaLocaleId, consorzio, salvata: true, dati: dati as ConfigurazionePerConsorzio[C] }
  }

  async imposta<C extends ConsorzioConfigurabile>(
    tenantId: string,
    unitaLocaleId: string,
    consorzio: C,
    dati: unknown
  ): Promise<ConfigurazioneVista<C>> {
    this.controllaConsorzio(consorzio)
    await this.controllaSede(tenantId, unitaLocaleId)
    const esito = validaConfigurazione(consorzio, dati)
    if (!esito.ok) throw new ConfigurazioneComunicazioniNonValidaError(esito.errori)
    const valore = esito.valore as ConfigurazionePerConsorzio[C]
    if (consorzio === 'ORR') {
      const id = (valore as ConfigurazionePerConsorzio['ORR']).autorizzazioneImpiantoId
      if (id !== undefined) {
        const a = await this.prisma.autorizzazioneImpianto.findFirst({
          where: { id, tenantId },
          select: { id: true },
        })
        if (!a) {
          throw new ConfigurazioneComunicazioniNonValidaError([
            'autorizzazioneImpiantoId: autorizzazione non trovata',
          ])
        }
      }
    }
    const json = valore as unknown as Prisma.InputJsonObject
    await this.prisma.configurazioneComunicazioneSede.upsert({
      where: { tenantId_unitaLocaleId_consorzio: { tenantId, unitaLocaleId, consorzio } },
      create: {
        tenantId,
        unitaLocaleId,
        consorzio,
        dati: json,
        versioneSchema: VERSIONE_SCHEMA_CONFIGURAZIONE,
      },
      update: { dati: json, versioneSchema: VERSIONE_SCHEMA_CONFIGURAZIONE },
    })
    return { unitaLocaleId, consorzio, salvata: true, dati: valore }
  }
}
