/** Reduz uma imagem enviada pelo usuário e devolve um data URL (PNG para logos, JPEG para fundos). */
export function imageToDataUrl(
  file: File,
  opts: { maxWidth: number; maxHeight: number; type: "image/png" | "image/jpeg"; quality?: number; maxChars: number },
): Promise<string> {
  return new Promise((resolve, reject) => {
    if (!/^image\/(png|jpeg)$/.test(file.type)) {
      reject(new Error("Use uma imagem PNG ou JPEG."));
      return;
    }
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      URL.revokeObjectURL(url);
      const scale = Math.min(1, opts.maxWidth / img.width, opts.maxHeight / img.height);
      const canvas = document.createElement("canvas");
      canvas.width = Math.round(img.width * scale);
      canvas.height = Math.round(img.height * scale);
      const ctx = canvas.getContext("2d");
      if (!ctx) {
        reject(new Error("Não foi possível processar a imagem."));
        return;
      }
      if (opts.type === "image/jpeg") {
        ctx.fillStyle = "#fff";
        ctx.fillRect(0, 0, canvas.width, canvas.height);
      }
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      let quality = opts.quality ?? 0.85;
      let out = canvas.toDataURL(opts.type, quality);
      while (out.length > opts.maxChars && opts.type === "image/jpeg" && quality > 0.4) {
        quality -= 0.1;
        out = canvas.toDataURL(opts.type, quality);
      }
      if (out.length > opts.maxChars) reject(new Error("A imagem é muito grande; use uma versão menor."));
      else resolve(out);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("Não foi possível ler a imagem."));
    };
    img.src = url;
  });
}
