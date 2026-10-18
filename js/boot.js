// =============================================================
// boot.js — Roda ANTES de desenhar a página (script clássico)
// -------------------------------------------------------------
// Aplica o tema salvo, a cor da barra do navegador e o modo
// discreto, para não "piscar" branco no tema escuro. Fica num
// arquivo (e não inline no HTML) para a Content-Security-Policy
// poder proibir scripts inline. Cores: as mesmas de js/core/theme.js.
// =============================================================
(function () {
  // Aberto dentro de outro site (iframe): sai para a janela inteira — ninguém
  // pode cobrir o app com botões falsos. (A CSP em <meta> não aceita frame-ancestors.)
  if (window.top !== window.self) {
    try { window.top.location = window.self.location.href; } catch (e) { document.documentElement.style.display = 'none'; }
    return;
  }
  var theme = 'auto';
  var color = null;
  var discreet = false;
  try {
    theme = localStorage.getItem('dhenors:theme') || 'auto';
    color = localStorage.getItem('dhenors:theme-color');
    discreet = localStorage.getItem('dhenors:discreet') === '1';
  } catch (e) { /* armazenamento bloqueado */ }
  var dark = theme === 'dark' || theme === 'oled' || (theme === 'auto' && window.matchMedia('(prefers-color-scheme: dark)').matches);
  var root = document.documentElement;
  root.dataset.theme = dark ? 'dark' : 'light';
  if (theme === 'oled') root.setAttribute('data-oled', '');
  if (discreet) root.setAttribute('data-discreet', '');
  var value = color || (theme === 'oled' ? '#000000' : dark ? '#0B0B0D' : '#F5F5F7');
  var metas = document.querySelectorAll('meta[name="theme-color"]');
  for (var i = 0; i < metas.length; i++) metas[i].setAttribute('content', value);
})();
