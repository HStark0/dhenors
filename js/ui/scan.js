// =============================================================
// scan.js — Ler boleto (código de barras) e Pix (QR Code) pela câmera
// -------------------------------------------------------------
// Usa o BarcodeDetector do próprio navegador (Chrome/Edge no
// Android, desktop; Safari ainda não tem). Sem ele, a janela
// oferece colar a linha digitável ou o Pix Copia e Cola.
// A imagem da câmera não sai do aparelho.
// =============================================================

import { html } from './dom.js';
import { icon } from './icons.js';
import { openDialog } from './dialog.js';

export const canScan = () => 'BarcodeDetector' in globalThis && Boolean(navigator.mediaDevices?.getUserMedia);

/**
 * Abre a câmera e devolve o primeiro código lido (texto) ou null.
 * formats: ['itf'] (boleto) | ['qr_code'] (Pix)
 */
export function scanCode({ formats = ['itf', 'qr_code'], title = 'Aponte a câmera para o código' } = {}) {
  return new Promise((resolve) => {
    let stream = null;
    let done = false;
    let timer = 0;
    const finish = (value, close) => {
      if (done) return;
      done = true;
      clearInterval(timer);
      stream?.getTracks().forEach((t) => t.stop());
      close?.();
      resolve(value);
    };
    const { dialog, close } = openDialog({
      title,
      size: 'sm',
      body: html`
        <div class="scan">
          <video class="scan__video" playsinline muted></video>
          <span class="scan__frame" aria-hidden="true"></span>
        </div>
        <p class="field__hint" data-scan-msg>${icon('info', 'icon--xs')} Segure o celular firme, com o código inteiro dentro do quadro.</p>`,
    });
    dialog.addEventListener('close', () => finish(null));
    (async () => {
      try {
        const supported = await BarcodeDetector.getSupportedFormats?.() || formats;
        const use = formats.filter((f) => supported.includes(f));
        if (!use.length) throw new Error('Seu navegador não lê esse tipo de código pela câmera.');
        const detector = new BarcodeDetector({ formats: use });
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment', width: { ideal: 1920 } }, audio: false });
        const video = dialog.querySelector('video');
        video.srcObject = stream;
        await video.play();
        timer = setInterval(async () => {
          try {
            const codes = await detector.detect(video);
            const hit = codes.find((c) => c.rawValue);
            if (hit) finish(hit.rawValue, close);
          } catch { /* quadro ainda não pronto */ }
        }, 350);
      } catch (err) {
        const msg = dialog.querySelector('[data-scan-msg]');
        if (msg) msg.textContent = err.name === 'NotAllowedError' ? 'Permissão da câmera negada. Libere nas configurações do navegador ou cole o código.' : err.message || 'Não foi possível abrir a câmera.';
      }
    })();
  });
}
