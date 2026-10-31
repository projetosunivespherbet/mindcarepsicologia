/**
 * Abre a aba do PDF no mesmo instante do clique. Navegadores (Safari, em especial) bloqueiam `window.open`
 * chamado depois de um `await`; por isso a aba é aberta vazia aqui e recebe o PDF quando ele fica pronto.
 */
export function openPdfWindow(): Window | null {
  const win = window.open("", "_blank");
  if (win) {
    try {
      win.opener = null;
      win.document.write('<p style="font-family:sans-serif;color:#555;padding:1rem">Gerando o PDF…</p>');
    } catch {
      /* sem acesso ao documento: segue mesmo assim */
    }
  }
  return win;
}
