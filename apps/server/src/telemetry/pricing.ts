// Versioned, server-side price registry + cost calculator (docs/SYSTEM_DESIGN.md 6.4).
//  - Rates live in apps/server/config/prices.json (never hardcoded here, never writable via the API).
//  - `null` cost always means "cannot calculate"; it is NEVER shown or summed as $0.00.
//  - Local inference has a true $0 external API cost (hardware/power excluded); mock is N/A.
import fs from 'node:fs';
import { z } from 'zod';
import type { AiStage, CostBasis, CostDetail, NormalizedUsage, PricingResponse, ProviderPreset } from '@kt/shared';

const num = z.number().finite().min(0);

const EntrySchema = z.object({
  provider: z.string(),
  model: z.string(),
  stages: z.array(z.enum(['ASR', 'INTERPRET', 'TRANSLATE', 'TTS', 'IDENTIFY'])).min(1),
  billingMetric: z.enum(['tokens', 'audio_minute']),
  unit: z.string(),
  inputPerMTok: num.nullish(),
  cachedInputPerMTok: num.nullish(),
  outputPerMTok: num.nullish(),
  /** Set together when text and audio tokens have different rates (Realtime TTS). */
  textOutputPerMTok: num.nullish(),
  audioInputPerMTok: num.nullish(),
  cachedAudioInputPerMTok: num.nullish(),
  audioOutputPerMTok: num.nullish(),
  perMinuteUsd: num.nullish(),
  costIsVendorEstimate: z.boolean().optional(),
});

const RegistrySchema = z.object({
  revision: z.string(),
  effectiveDate: z.string(),
  sourceUrl: z.string(),
  entries: z.array(EntrySchema),
});

export type PriceEntry = z.infer<typeof EntrySchema>;
export type PriceData = z.infer<typeof RegistrySchema>;

export type CostInput = {
  preset: ProviderPreset;
  providerName: string;
  model: string;
  stage: AiStage;
  usage: NormalizedUsage;
  /** Only successful (or at least billed) calls are priced by the caller; failed calls pass priceable=false. */
  priceable?: boolean;
};

export type CostResult = {
  costUsd: number | null;
  costBasis: CostBasis;
  priceRevision: string | null;
  detail: CostDetail | null;
};

export const EMPTY_PRICES: PriceData = { revision: 'none', effectiveDate: '', sourceUrl: '', entries: [] };

export class PriceRegistry {
  private data: PriceData;
  private mtimeMs = 0;

  constructor(
    data: PriceData = EMPTY_PRICES,
    private readonly file?: string,
  ) {
    this.data = data;
  }

  /** Reads the JSON file; an unreadable/invalid file yields an EMPTY registry (all Cloud costs Unknown). */
  static fromFile(file: string): PriceRegistry {
    const registry = new PriceRegistry(EMPTY_PRICES, file);
    registry.reloadIfChanged(true);
    return registry;
  }

  /** Rates are editable without a redeploy: pick up changes to the file on the next calculation. */
  reloadIfChanged(force = false): void {
    if (!this.file) return;
    try {
      const mtime = fs.statSync(this.file).mtimeMs;
      if (!force && mtime === this.mtimeMs) return;
      const parsed = RegistrySchema.parse(JSON.parse(fs.readFileSync(this.file, 'utf8')));
      this.data = parsed;
      this.mtimeMs = mtime;
    } catch {
      if (force) this.data = EMPTY_PRICES;
    }
  }

  get revision(): string {
    return this.data.revision;
  }

  describe(): PricingResponse {
    this.reloadIfChanged();
    return {
      revision: this.data.revision,
      effectiveDate: this.data.effectiveDate,
      sourceUrl: this.data.sourceUrl,
      entries: this.data.entries.map((e) => ({ ...e })),
      editableOnlyOnServer: true,
    };
  }

  private find(provider: string, model: string, stage: AiStage): PriceEntry | undefined {
    const candidates = this.data.entries.filter((e) => e.provider === provider && e.stages.includes(stage));
    // Exact id first, then dated snapshots such as "gpt-4.1-mini-2025-04-14".
    return candidates.find((e) => e.model === model) ?? candidates.find((e) => model.startsWith(`${e.model}-`));
  }

  calculate(input: CostInput): CostResult {
    this.reloadIfChanged();
    if (input.preset === 'mock') {
      return { costUsd: null, costBasis: 'not_applicable', priceRevision: null, detail: null };
    }
    if (input.preset === 'local') {
      return {
        costUsd: 0,
        costBasis: 'not_applicable',
        priceRevision: null,
        detail: {
          method: 'local inference: no external API charge',
          unit: 'USD',
          rates: {},
          quantities: {},
          note: 'Local API: $0 (hardware, electricity and developer time excluded)',
        },
      };
    }

    const unknown = (note: string, detail?: Partial<CostDetail>): CostResult => ({
      costUsd: null,
      costBasis: 'unknown',
      priceRevision: this.data.revision,
      detail: { method: 'not calculable', unit: '', rates: {}, quantities: {}, ...detail, note },
    });

    if (input.priceable === false) return unknown('request failed before usage was reported; not priced');

    const entry = this.find(input.providerName, input.model, input.stage);
    if (!entry) return unknown(`no price entry for ${input.providerName}/${input.model} (${input.stage}) in revision ${this.data.revision}`);

    const u = input.usage;

    if (entry.billingMetric === 'tokens' && entry.audioOutputPerMTok != null) {
      return this.mixedTokens(entry, u, unknown);
    }

    if (entry.billingMetric === 'tokens') {
      const { inputPerMTok, outputPerMTok } = entry;
      if (u.promptTokens === undefined || u.outputTokens === undefined) {
        return unknown('provider returned no token usage for this call; not guessing tokens from text length', {
          method: 'tokens x rate',
          unit: entry.unit,
          rates: { inputPerMTok: inputPerMTok ?? null, cachedInputPerMTok: entry.cachedInputPerMTok ?? null, outputPerMTok: outputPerMTok ?? null },
        });
      }
      if (inputPerMTok == null || outputPerMTok == null) return unknown('rate missing in price registry', { unit: entry.unit });
      const cached = Math.min(u.cachedPromptTokens ?? 0, u.promptTokens);
      const cachedRate = entry.cachedInputPerMTok ?? inputPerMTok;
      const usd = ((u.promptTokens - cached) * inputPerMTok + cached * cachedRate + u.outputTokens * outputPerMTok) / 1_000_000;
      return {
        costUsd: usd,
        costBasis: 'reported_usage',
        priceRevision: this.data.revision,
        detail: {
          method: '(uncachedInput x inputRate + cachedInput x cachedRate + output x outputRate) / 1e6',
          unit: entry.unit,
          rates: { inputPerMTok, cachedInputPerMTok: entry.cachedInputPerMTok ?? null, outputPerMTok },
          quantities: { promptTokens: u.promptTokens, cachedPromptTokens: cached, outputTokens: u.outputTokens },
        },
      };
    }

    // audio_minute
    const rate = entry.perMinuteUsd;
    if (rate == null) return unknown('per-minute rate missing in price registry', { unit: entry.unit });
    if (u.inputAudioMs === undefined || u.inputAudioMs <= 0) {
      return unknown('audio duration unknown; cannot apply a per-minute rate', { unit: entry.unit, rates: { perMinuteUsd: rate } });
    }
    const minutes = u.inputAudioMs / 60_000;
    return {
      costUsd: minutes * rate,
      costBasis: 'estimated',
      priceRevision: this.data.revision,
      detail: {
        method: 'audioMinutes x perMinuteRate (estimate; provider bills by its own metric)',
        unit: entry.unit,
        rates: { perMinuteUsd: rate },
        quantities: { audioMinutes: minutes, promptTokens: u.promptTokens ?? null, outputTokens: u.outputTokens ?? null },
        note: entry.costIsVendorEstimate ? 'rate is the vendor-published estimated cost per minute' : undefined,
      },
    };
  }

  /** Text and audio tokens are billed at different rates. Missing a split stays Unknown. */
  private mixedTokens(
    entry: PriceEntry,
    u: NormalizedUsage,
    unknown: (note: string, detail?: Partial<CostDetail>) => CostResult,
  ): CostResult {
    const textIn = u.inputTextTokens;
    const audioIn = u.inputAudioTokens;
    const imageIn = u.inputImageTokens ?? 0;
    const textOut = u.outputTextTokens;
    const audioOut = u.outputAudioTokens;
    if (textIn === undefined || audioIn === undefined || textOut === undefined || audioOut === undefined) {
      return unknown('provider did not split text and audio tokens; not guessing a blended rate', { unit: entry.unit });
    }
    if (imageIn > 0) return unknown('image tokens are not priced on this TTS call', { unit: entry.unit });
    if (u.promptTokens !== undefined && u.promptTokens !== textIn + audioIn + imageIn) {
      return unknown('input token total does not match the reported text and audio split', { unit: entry.unit });
    }
    if (u.outputTokens !== undefined && u.outputTokens !== textOut + audioOut) {
      return unknown('output token total does not match the reported text and audio split', { unit: entry.unit });
    }
    const textInRate = entry.inputPerMTok;
    const textOutRate = entry.textOutputPerMTok ?? entry.outputPerMTok;
    const audioOutRate = entry.audioOutputPerMTok;
    const audioInRate = entry.audioInputPerMTok;
    if (textInRate == null || textOutRate == null || audioOutRate == null) return unknown('rate missing in price registry', { unit: entry.unit });
    if (audioIn > 0 && audioInRate == null) return unknown('audio input rate missing in price registry', { unit: entry.unit });
    const cachedText = Math.min(u.cachedTextTokens ?? 0, textIn);
    const cachedAudio = Math.min(u.cachedAudioTokens ?? 0, audioIn);
    const cachedTextRate = entry.cachedInputPerMTok ?? textInRate;
    const cachedAudioRate = entry.cachedAudioInputPerMTok ?? audioInRate ?? 0;
    const usd =
      ((textIn - cachedText) * textInRate +
        cachedText * cachedTextRate +
        (audioIn - cachedAudio) * (audioInRate ?? 0) +
        cachedAudio * cachedAudioRate +
        textOut * textOutRate +
        audioOut * audioOutRate) /
      1_000_000;
    return {
      costUsd: usd,
      costBasis: 'reported_usage',
      priceRevision: this.data.revision,
      detail: {
        method: 'text and audio tokens x their own rates / 1e6',
        unit: entry.unit,
        rates: {
          inputPerMTok: textInRate,
          cachedInputPerMTok: entry.cachedInputPerMTok ?? null,
          textOutputPerMTok: textOutRate,
          audioInputPerMTok: audioInRate ?? null,
          cachedAudioInputPerMTok: entry.cachedAudioInputPerMTok ?? null,
          audioOutputPerMTok: audioOutRate,
        },
        quantities: {
          inputTextTokens: textIn,
          cachedTextTokens: cachedText,
          inputAudioTokens: audioIn,
          cachedAudioTokens: cachedAudio,
          outputTextTokens: textOut,
          outputAudioTokens: audioOut,
          promptTokens: u.promptTokens ?? null,
          outputTokens: u.outputTokens ?? null,
        },
      },
    };
  }
}
