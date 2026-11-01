import { jsPDF } from "jspdf";
import { formatCns, formatCpf } from "@shared/documents";

export interface RecordExport {
  paciente: { nome: string; cpf: string | null; cns: string | null; data_nascimento: string | null };
  profissional: { nome: string; crp: string | null } | null;
  clinica: string;
  itens: { appointment_id: string; starts_at: string; ends_at: string; status: string; conteudo: string; anotacoes: string | null }[];
}

const M = 22; // margem
const W = 210;
const H = 297;
const hhmm = (iso: string) => new Date(iso).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
const dia = (iso: string) => new Date(iso).toLocaleDateString("pt-BR");

/** PDF (A4) com o prontuário das sessões escolhidas; anotações privativas só entram nas que o profissional marcou. */
export function renderRecordPdf(d: RecordExport): jsPDF {
  const doc = new jsPDF({ unit: "mm", format: "a4", compress: true });
  doc.setProperties({ title: `Prontuário - ${d.paciente.nome}`, creator: "MindCare" });
  let y = M;
  const room = (h: number) => {
    if (y + h > H - M) {
      doc.addPage();
      y = M;
    }
  };
  const write = (text: string, size = 11, style: "normal" | "bold" | "italic" = "normal", gap = 1.6) => {
    doc.setFont("times", style).setFontSize(size);
    const lh = size * 0.3528 * 1.4;
    for (const line of doc.splitTextToSize(text, W - 2 * M) as string[]) {
      room(lh);
      doc.text(line, M, y + lh * 0.8);
      y += lh;
    }
    y += gap;
  };

  write("PRONTUÁRIO PSICOLÓGICO", 15, "bold", 3);
  if (d.clinica) write(d.clinica, 11, "normal", 3);
  write("Identificação", 12, "bold");
  write(`Paciente: ${d.paciente.nome}`);
  if (d.paciente.data_nascimento) write(`Nascimento: ${d.paciente.data_nascimento.split("-").reverse().join("/")}`);
  if (d.paciente.cpf) write(`CPF: ${formatCpf(d.paciente.cpf)}`);
  if (d.paciente.cns) write(`CNS: ${formatCns(d.paciente.cns)}`);
  if (d.profissional) write(`Psicólogo(a): ${d.profissional.nome}${d.profissional.crp ? ` · CRP ${d.profissional.crp}` : ""}`, 11, "normal", 4);

  for (const it of d.itens) {
    room(20);
    doc.setDrawColor(180).line(M, y, W - M, y);
    y += 3;
    write(`Sessão de ${dia(it.starts_at)}, ${hhmm(it.starts_at)}–${hhmm(it.ends_at)}`, 12, "bold");
    write(it.conteudo || "(sem registro no prontuário)", 11, it.conteudo ? "normal" : "italic", 3);
    if (it.anotacoes) {
      write("Registro documental (anotações privativas)", 11, "bold");
      write(it.anotacoes, 11, "normal", 3);
    }
  }

  const pages = doc.getNumberOfPages();
  for (let i = 1; i <= pages; i++) {
    doc.setPage(i).setFont("times", "normal").setFontSize(9).setTextColor(110);
    doc.text(`Gerado em ${new Date().toLocaleDateString("pt-BR")} · página ${i} de ${pages}`, W / 2, H - 10, { align: "center" });
  }
  return doc;
}
