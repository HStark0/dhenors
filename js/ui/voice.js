// =============================================================
// voice.js — Lançamento por voz (reconhecimento de fala do navegador)
// -------------------------------------------------------------
// Usa a Web Speech API em português. Atenção: no Chrome, o áudio é
// transcrito pelos servidores do Google; o app só recebe o texto.
// O texto vai para o lançamento rápido (domain/quickadd.js):
// "gastei 50 no mercado", "luz 180 todo dia 20"…
// =============================================================

const Recognition = () => globalThis.SpeechRecognition || globalThis.webkitSpeechRecognition;

export const speechSupported = () => Boolean(Recognition());

/** Ouve uma frase e devolve o texto (ou '' se nada foi dito). */
export function listen({ lang = 'pt-BR', timeout = 8000 } = {}) {
  return new Promise((resolve, reject) => {
    const R = Recognition();
    if (!R) { reject(new Error('Seu navegador não reconhece fala.')); return; }
    const rec = new R();
    rec.lang = lang;
    rec.interimResults = false;
    rec.maxAlternatives = 1;
    let text = '';
    const timer = setTimeout(() => rec.stop(), timeout);
    rec.onresult = (ev) => { text = ev.results[0]?.[0]?.transcript || ''; };
    rec.onerror = (ev) => {
      clearTimeout(timer);
      if (ev.error === 'no-speech' || ev.error === 'aborted') resolve('');
      else reject(new Error(ev.error === 'not-allowed' ? 'Permissão do microfone negada.' : 'Não foi possível ouvir agora.'));
    };
    rec.onend = () => { clearTimeout(timer); resolve(text); };
    rec.start();
  });
}
