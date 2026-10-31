import { jsPDF } from "jspdf";
import QRCode from "qrcode";
import { DOCUMENT_TYPES, formatCodigo, type DocumentData, type LetterheadData } from "@shared/documents";

const PAGE_W = 210;
const PAGE_H = 297;
const FONT = "times";
const BODY_PT = 11.5;
const LINE = 1.45; // entrelinha
const PT_TO_MM = 0.3528;

export const DEFAULT_LETTERHEAD: LetterheadData = {
  modo: "padrao",
  margem_top_mm: 25,
  margem_bottom_mm: 20,
  margem_left_mm: 25,
  margem_right_mm: 20,
  logo_data_url: null,
  linhas: [],
  rodape: null,
  fundo_data_url: null,
};

export interface PdfOptions {
  /** Endereço base do sistema, usado no link e no QR code de verificação. */
  verifyBaseUrl?: string;
}

const NUMBERED = new Set(["relatorio", "relatorio_multiprofissional", "laudo", "parecer", "termo_consentimento"]);
const SHOW_BIRTH = new Set(["atestado", "relatorio", "relatorio_multiprofissional", "laudo", "parecer"]);

const imgFormat = (dataUrl: string) => (dataUrl.startsWith("data:image/png") ? "PNG" : "JPEG");

function formatDateBR(iso: string) {
  const [y, m, d] = iso.slice(0, 10).split("-");
  return `${d}/${m}/${y}`;
}

function longDate(iso: string) {
  const [y, m, d] = iso.slice(0, 10).split("-").map(Number);
  return new Intl.DateTimeFormat("pt-BR", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" }).format(
    new Date(Date.UTC(y, m - 1, d, 12)),
  );
}

function formatDateTimeBR(iso: string) {
  return new Intl.DateTimeFormat("pt-BR", {
    day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "America/Sao_Paulo",
  }).format(new Date(iso));
}

/** Gera o PDF (A4) do documento, com o papel timbrado escolhido. */
export async function renderDocumentPdf(data: DocumentData, letterhead: LetterheadData | null, opts: PdfOptions = {}) {
  const lh = letterhead ?? DEFAULT_LETTERHEAD;
  const def = DOCUMENT_TYPES[data.tipo];
  const doc = new jsPDF({ unit: "mm", format: "a4", orientation: "portrait", compress: true });
  doc.setProperties({ title: `${data.titulo}${data.numero ? ` ${data.numero}` : ""}`, creator: "MindCare" });

  const left = lh.margem_left_mm;
  const right = PAGE_W - lh.margem_right_mm;
  const width = right - left;
  const verifiable = data.status !== "rascunho" && !!data.codigo;
  const base = (opts.verifyBaseUrl ?? (typeof window !== "undefined" ? window.location.origin : "")).replace(/\/$/, "");
  const verifyUrl = verifiable ? `${base}/verificar/${data.codigo}` : "";
  const qr = verifiable ? await QRCode.toDataURL(verifyUrl, { margin: 0, width: 240, errorCorrectionLevel: "M" }) : null;
  // Reserva no fim do texto: número da página e, nos documentos emitidos, duas linhas de verificação.
  const contentBottom = PAGE_H - lh.margem_bottom_mm - (verifiable ? 11 : 6);
  let y = 0;

  // ---- decoração de cada página (fundo, cabeçalho)
  const headerHeight = () => {
    if (lh.modo !== "padrao") return 0;
    const logoH = lh.logo_data_url ? 18 : 0;
    const textH = lh.linhas.length ? lh.linhas.length * 4.6 + 1 : 0;
    return Math.max(logoH, textH);
  };

  const decoratePage = () => {
    if (lh.modo === "imagem" && lh.fundo_data_url) {
      doc.addImage(lh.fundo_data_url, imgFormat(lh.fundo_data_url), 0, 0, PAGE_W, PAGE_H);
    }
    if (lh.modo === "padrao") {
      const top = 10;
      let textX = left;
      if (lh.logo_data_url) {
        const p = doc.getImageProperties(lh.logo_data_url);
        const h = 18;
        const w = Math.min((p.width / p.height) * h, 45);
        doc.addImage(lh.logo_data_url, imgFormat(lh.logo_data_url), left, top, w, h);
        textX = left + w + 5;
      }
      if (lh.linhas.length) {
        doc.setFont(FONT, "bold").setFontSize(12).setTextColor(40);
        doc.text(lh.linhas[0], textX, top + 5);
        doc.setFont(FONT, "normal").setFontSize(9).setTextColor(90);
        lh.linhas.slice(1).forEach((l, i) => doc.text(l, textX, top + 10 + i * 4.2));
      }
      const h = headerHeight();
      if (h > 0) {
        doc.setDrawColor(170).setLineWidth(0.3).line(left, top + h + 3, right, top + h + 3);
      }
    }
    doc.setTextColor(0);
  };

  const startY = () => {
    const hdr = headerHeight();
    return Math.max(lh.margem_top_mm, hdr > 0 ? 10 + hdr + 10 : 0);
  };

  const newPage = () => {
    doc.addPage();
    decoratePage();
    y = startY();
  };

  const ensure = (h: number) => {
    if (y + h > contentBottom) newPage();
  };

  decoratePage();
  y = startY();

  // ---- texto
  const lineH = (pt: number) => pt * PT_TO_MM * LINE;

  const writeParagraph = (text: string, opts2: { bold?: boolean; size?: number; justify?: boolean; indent?: number; gap?: number } = {}) => {
    const size = opts2.size ?? BODY_PT;
    const indent = opts2.indent ?? 0;
    doc.setFont(FONT, opts2.bold ? "bold" : "normal").setFontSize(size);
    const lines = doc.splitTextToSize(text, width - indent) as string[];
    const h = lineH(size);
    lines.forEach((line, i) => {
      ensure(h);
      const last = i === lines.length - 1;
      if (opts2.justify && !last && line.includes(" ")) {
        doc.text(line, left + indent, y + h * 0.75, { align: "justify", maxWidth: width - indent });
      } else {
        doc.text(line, left + indent, y + h * 0.75);
      }
      y += h;
    });
    y += opts2.gap ?? 0;
  };

  const writeBlocks = (text: string, opts2: { justify?: boolean } = {}) => {
    text
      .split(/\n+/)
      .map((t) => t.trim())
      .filter(Boolean)
      .forEach((par) => writeParagraph(par, { justify: opts2.justify ?? true, gap: 2.2 }));
  };

  const labeled = (label: string, value: string) => {
    const size = BODY_PT;
    doc.setFont(FONT, "bold").setFontSize(size);
    const lw = doc.getTextWidth(`${label}: `);
    doc.setFont(FONT, "normal");
    const lines = doc.splitTextToSize(value, width - lw) as string[];
    const h = lineH(size);
    lines.forEach((line, i) => {
      ensure(h);
      if (i === 0) {
        doc.setFont(FONT, "bold").setFontSize(size).text(`${label}:`, left, y + h * 0.75);
        doc.setFont(FONT, "normal");
      }
      doc.setFont(FONT, "normal").setFontSize(size).text(line, left + lw, y + h * 0.75);
      y += h;
    });
  };

  // ---- título
  doc.setFont(FONT, "bold").setFontSize(14);
  const titleLines = doc.splitTextToSize(data.titulo.toUpperCase(), width) as string[];
  titleLines.forEach((l) => {
    ensure(7);
    doc.text(l, PAGE_W / 2, y + 5, { align: "center" });
    y += 6.2;
  });
  y += 5;

  // ---- identificação
  const id = data.identificacao;
  labeled("Autor(a)", `${id.psicologo_nome} — CRP ${id.psicologo_crp}`);
  labeled("Pessoa atendida", id.paciente_nome);
  if (SHOW_BIRTH.has(data.tipo) && id.paciente_nascimento) labeled("Data de nascimento", formatDateBR(id.paciente_nascimento));
  if (data.solicitante?.trim()) labeled("Solicitante", data.solicitante.trim());
  if (data.finalidade?.trim()) labeled("Finalidade", data.finalidade.trim());
  y += 5;

  // ---- seções
  const sections = def.sections.filter((s) => data.conteudo[s.key]?.trim());
  const showHeadings = def.sections.length > 1;
  const numbered = NUMBERED.has(data.tipo);
  sections.forEach((s, i) => {
    if (showHeadings) {
      ensure(lineH(BODY_PT) * 3);
      writeParagraph(numbered ? `${i + 1}. ${s.label}` : s.label, { bold: true, gap: 1 });
    }
    writeBlocks(data.conteudo[s.key]);
    if (showHeadings) y += 2;
  });

  // ---- local, data e assinatura
  y += 4;
  // Data, assinatura e bloco de verificação ficam juntos na mesma página.
  ensure(42);
  const when = longDate(data.data_documento);
  writeParagraph(data.local?.trim() ? `${data.local.trim()}, ${when}.` : `${when[0].toUpperCase()}${when.slice(1)}.`, { gap: 0 });
  y += 16;
  const sigW = 80;
  const sigX = PAGE_W / 2 - sigW / 2;
  doc.setDrawColor(40).setLineWidth(0.3).line(sigX, y, sigX + sigW, y);
  doc.setFont(FONT, "normal").setFontSize(BODY_PT);
  doc.text(id.psicologo_nome, PAGE_W / 2, y + 5, { align: "center" });
  doc.setFontSize(10).text(`Psicólogo(a) — CRP ${id.psicologo_crp}`, PAGE_W / 2, y + 9.5, { align: "center" });
  if (qr) {
    doc.addImage(qr, "PNG", right - 17, y - 8, 17, 17);
    doc.setFont(FONT, "normal").setFontSize(6.5).setTextColor(110).text("Verificar", right - 8.5, y + 11, { align: "center" });
    doc.setTextColor(0);
  }
  y += 18;

  // ---- rodapé, número de página e marca d'água em todas as páginas
  const total = doc.getNumberOfPages();
  for (let p = 1; p <= total; p++) {
    doc.setPage(p);
    if (lh.modo === "padrao" && lh.rodape) {
      doc.setFont(FONT, "normal").setFontSize(8.5).setTextColor(100);
      doc.text(doc.splitTextToSize(lh.rodape, width) as string[], PAGE_W / 2, PAGE_H - 12, { align: "center" });
    }
    doc.setFont(FONT, "normal").setFontSize(8.5).setTextColor(110);
    doc.text(`Página ${p} de ${total}`, right, contentBottom + 4.5, { align: "right" });
    if (verifiable && data.codigo) {
      doc.setFontSize(7).setTextColor(110);
      const emitido = data.emitted_at ? ` · emitido em ${formatDateTimeBR(data.emitted_at)}` : "";
      const hash = data.content_hash ? ` · SHA-256 ${data.content_hash.slice(0, 16)}…` : "";
      doc.text(`Documento nº ${data.numero}${emitido}${hash}`, left, contentBottom + 4.5);
      doc.text(`Código de verificação ${formatCodigo(data.codigo)} · confira em ${verifyUrl}`, left, contentBottom + 7.8);
    }

    if (data.status !== "emitido") {
      const label = data.status === "rascunho" ? "RASCUNHO" : "ANULADO";
      doc.saveGraphicsState();
      doc.setGState(doc.GState({ opacity: 0.12 }));
      doc.setFont("helvetica", "bold").setFontSize(86).setTextColor(data.status === "rascunho" ? 90 : 200, data.status === "rascunho" ? 90 : 30, data.status === "rascunho" ? 90 : 30);
      doc.text(label, PAGE_W / 2, PAGE_H / 2 + 20, { align: "center", angle: 45 });
      doc.restoreGraphicsState();
      if (data.status === "anulado" && data.annul_reason) {
        doc.setFont(FONT, "bold").setFontSize(9).setTextColor(170, 30, 30);
        doc.text(doc.splitTextToSize(`Documento anulado: ${data.annul_reason}`, width) as string[], left, contentBottom - 2);
      }
    }
    doc.setTextColor(0);
  }

  return doc;
}

export function pdfFileName(data: DocumentData) {
  const base = data.numero ? data.numero.replace("/", "-") : "rascunho";
  return `${data.tipo}-${base}.pdf`;
}

export async function downloadDocumentPdf(data: DocumentData, letterhead: LetterheadData | null, opts: PdfOptions = {}) {
  const doc = await renderDocumentPdf(data, letterhead, opts);
  doc.save(pdfFileName(data));
}

/**
 * Mostra o PDF numa aba. Passe a aba aberta por `openPdfWindow()` no clique; se ela foi bloqueada (null),
 * o PDF é baixado em vez de aberto.
 */
export async function openDocumentPdf(data: DocumentData, letterhead: LetterheadData | null, opts: PdfOptions = {}, target: Window | null = null) {
  let doc;
  try {
    doc = await renderDocumentPdf(data, letterhead, opts);
  } catch (err) {
    target?.close();
    throw err;
  }
  if (!target || target.closed) {
    doc.save(pdfFileName(data));
    return;
  }
  const url = URL.createObjectURL(doc.output("blob"));
  target.location.href = url;
  setTimeout(() => URL.revokeObjectURL(url), 5 * 60_000);
}
