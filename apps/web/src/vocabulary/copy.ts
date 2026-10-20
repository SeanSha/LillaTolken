import { AppError, type VocabularyOutcome } from '@kt/shared';
import type { VocabImageErrorCode } from './image';

export function imageErrorCopy(code: VocabImageErrorCode): { zh: string; sv: string } {
  switch (code) {
    case 'TYPE':
      return { zh: '请换一张 JPEG、PNG、WEBP 或 HEIC 照片。', sv: 'Välj ett foto i JPEG, PNG, WEBP eller HEIC.' };
    case 'EMPTY':
      return { zh: '这张照片是空的。', sv: 'Fotot är tomt.' };
    case 'TOO_LARGE':
      return { zh: '这张照片太大了。请换一张近一点的。', sv: 'Fotot är för stort. Välj ett annat.' };
    case 'DECODE':
      return { zh: '这张照片打不开。请换一张，或改用 JPEG。', sv: 'Fotot kunde inte öppnas. Prova JPEG.' };
  }
}

export function vocabularyErrorCopy(error: unknown): { zh: string; sv: string } {
  const category = error instanceof AppError ? error.category : 'UNKNOWN';
  switch (category) {
    case 'NOT_CONFIGURED':
      return {
        zh: '这一步还不能用。本地模式需要已经装好的识图或朗读；云端模式需要服务器上的密钥。',
        sv: 'Det här steget är inte redo. Lokalt läge behöver en installerad modell; molnläge behöver en nyckel.',
      };
    case 'TIMEOUT':
      return { zh: '等太久了。请再试一次。', sv: 'Det tog för lång tid. Försök igen.' };
    case 'NETWORK':
      return {
        zh: '连不上。请检查网络；本地模式还要确认 Ollama 已经打开。',
        sv: 'Ingen kontakt. Kontrollera nätet. I lokalt läge, se att Ollama är igång.',
      };
    case 'BAD_REQUEST':
      return { zh: '这张图片没法用。请换一张 JPEG、PNG 或 WEBP。', sv: 'Bilden kunde inte användas.' };
    default:
      return { zh: '没有识别成功。请换一张照片再试。', sv: 'Det gick inte att känna igen bilden.' };
  }
}

export function identificationNotice(outcome: Extract<VocabularyOutcome, 'person' | 'none' | 'uncertain'>): { zh: string; sv: string } {
  switch (outcome) {
    case 'person':
      return {
        zh: '这张照片主要是人。请换一张没有人的物品照片。',
        sv: 'Fotot visar en person. Ta ett foto av en sak, utan människor.',
      };
    case 'none':
      return { zh: '没有看清一个具体的东西。请再拍一张。', sv: 'Ingen tydlig sak syntes. Ta ett nytt foto.' };
    case 'uncertain':
      return {
        zh: '不确定这是什么，所以没有填词。请你写上，或换一张照片。',
        sv: 'Osäkert vad det är, så inget ord har fyllts i. Skriv själv eller ta ett nytt foto.',
      };
  }
}

export const PRIVACY_NOTE = {
  zh: '没配对时，词卡只在这台设备的浏览器里。清除网站数据会删掉这一份。配对家庭口令后，照片、词语和声音会再复制一份到这台 Mac，给知道口令的设备一起看。同步不会自动删掉本机卡片。家庭口令不是监控后台的密码。',
  sv: 'Utan en hushållskod finns korten bara i den här webbläsaren. Rensar du webbplatsdata försvinner den kopian. Med en kod kopieras foto, ord och ljud till den här Macen. Synken tar inte bort korten på enheten.',
};
