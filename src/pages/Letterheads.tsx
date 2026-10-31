import { useState, type ChangeEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Eye, ImageUp, Pencil, Plus, Star } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { api, errMsg } from "@/lib/api";
import { imageToDataUrl } from "@/lib/image";
import { openPdfWindow } from "@/lib/pdfWindow";
import type { LetterheadRow } from "@/lib/types";
import type { DocumentData, LetterheadData } from "@shared/documents";

type Modo = LetterheadData["modo"];

const MODOS: { value: Modo; titulo: string; texto: string }[] = [
  { value: "padrao", titulo: "Cabeçalho gerado", texto: "O sistema monta logo, dados da clínica e rodapé. Bom para enviar por e-mail." },
  { value: "imagem", titulo: "Imagem do papel timbrado", texto: "Você envia a arte do seu papel timbrado (A4) e o texto é posto dentro das margens." },
  { value: "impresso", titulo: "Imprimir em papel timbrado físico", texto: "O PDF sai sem cabeçalho, só com margens para o seu papel já impresso." },
];
const PRESETS: Record<Modo, { top: number; bottom: number }> = {
  padrao: { top: 25, bottom: 20 },
  imagem: { top: 40, bottom: 30 },
  impresso: { top: 50, bottom: 35 },
};

const blank = () => ({
  id: null as string | null,
  nome: "",
  modo: "padrao" as Modo,
  top: 25,
  bottom: 20,
  left: 25,
  right: 20,
  logo: null as string | null,
  linhas: "",
  rodape: "",
  fundo: null as string | null,
  is_default: false,
  ativo: true,
});
type Form = ReturnType<typeof blank>;

const toData = (f: Form): LetterheadData => ({
  modo: f.modo,
  margem_top_mm: f.top,
  margem_bottom_mm: f.bottom,
  margem_left_mm: f.left,
  margem_right_mm: f.right,
  logo_data_url: f.logo,
  linhas: f.linhas.split("\n").map((l) => l.trim()).filter(Boolean).slice(0, 6),
  rodape: f.rodape.trim() || null,
  fundo_data_url: f.fundo,
});

const SAMPLE: DocumentData = {
  tipo: "declaracao",
  titulo: "Declaração (exemplo de leiaute)",
  status: "emitido",
  numero: "0000/0000",
  codigo: "EXEMPLOEXEMP",
  content_hash: "0".repeat(64),
  data_documento: new Date().toISOString().slice(0, 10),
  local: "Cidade/UF",
  solicitante: null,
  finalidade: "Visualizar o papel timbrado",
  conteudo: {
    registro:
      "Declaro, para os devidos fins, que Nome da Pessoa Atendida esteve em atendimento psicológico nesta data. Este é apenas um exemplo para você conferir cabeçalho, margens e rodapé antes de usar o modelo.",
  },
  identificacao: { paciente_nome: "Nome da Pessoa Atendida", paciente_nascimento: null, psicologo_nome: "Nome do(a) Psicólogo(a)", psicologo_crp: "00/00000", clinica_nome: "Clínica" },
  emitted_at: new Date().toISOString(),
  annul_reason: null,
};

export default function Letterheads() {
  const qc = useQueryClient();
  const list = useQuery({ queryKey: ["letterheads"], queryFn: () => api<LetterheadRow[]>("/letterheads") });
  const [f, setF] = useState<Form | null>(null);

  const edit = (l: LetterheadRow): Form => ({
    id: l.id,
    nome: l.nome,
    modo: l.modo,
    top: l.margem_top_mm,
    bottom: l.margem_bottom_mm,
    left: l.margem_left_mm,
    right: l.margem_right_mm,
    logo: l.logo_data_url,
    linhas: l.linhas.join("\n"),
    rodape: l.rodape ?? "",
    fundo: l.fundo_data_url,
    is_default: l.is_default,
    ativo: l.ativo,
  });

  const save = useMutation({
    mutationFn: (form: Form) => {
      const d = toData(form);
      const body = { ...d, nome: form.nome, is_default: form.is_default, ...(form.id ? { ativo: form.ativo } : {}) };
      return form.id ? api(`/letterheads/${form.id}`, { method: "PATCH", body }) : api("/letterheads", { body });
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["letterheads"] });
      setF(null);
      toast.success("Papel timbrado salvo");
    },
    onError: (e) => toast.error(errMsg(e)),
  });

  const makeDefault = useMutation({
    mutationFn: (l: LetterheadRow) => api(`/letterheads/${l.id}`, { method: "PATCH", body: { is_default: true } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["letterheads"] }),
    onError: (e) => toast.error(errMsg(e)),
  });

  const upload = async (e: ChangeEvent<HTMLInputElement>, kind: "logo" | "fundo") => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file || !f) return;
    try {
      const url =
        kind === "logo"
          ? await imageToDataUrl(file, { maxWidth: 480, maxHeight: 240, type: "image/png", maxChars: 590_000 })
          : await imageToDataUrl(file, { maxWidth: 1240, maxHeight: 1754, type: "image/jpeg", quality: 0.85, maxChars: 4_400_000 });
      setF({ ...f, [kind]: url });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Não foi possível usar a imagem");
    }
  };

  const preview = () => {
    if (!f) return;
    const win = openPdfWindow(); // no clique, antes de qualquer await
    import("@/lib/documentPdf")
      .then(({ openDocumentPdf }) => openDocumentPdf(SAMPLE, toData(f), {}, win))
      .catch(() => toast.error("Não foi possível gerar a pré-visualização"));
  };

  const setNum = (k: "top" | "bottom" | "left" | "right") => (e: ChangeEvent<HTMLInputElement>) => f && setF({ ...f, [k]: Number(e.target.value) });

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold">Papel timbrado</h1>
          <p className="text-sm text-muted-foreground">Modelos usados no PDF dos documentos. Quem emite escolhe qual aplicar.</p>
        </div>
        <Button onClick={() => setF(blank())}>
          <Plus className="w-4 h-4 mr-2" /> Novo modelo
        </Button>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {list.data?.map((l) => (
          <Card key={l.id} className={l.ativo ? "" : "opacity-60"}>
            <CardHeader>
              <div className="flex items-start justify-between gap-2">
                <CardTitle className="text-base">{l.nome}</CardTitle>
                {l.is_default && <Badge>Padrão</Badge>}
              </div>
              <CardDescription>{MODOS.find((m) => m.value === l.modo)?.titulo}</CardDescription>
            </CardHeader>
            <CardContent className="flex gap-2 flex-wrap">
              <Button size="sm" variant="outline" onClick={() => setF(edit(l))}>
                <Pencil className="w-3.5 h-3.5 mr-1" /> Editar
              </Button>
              {!l.is_default && l.ativo && (
                <Button size="sm" variant="ghost" onClick={() => makeDefault.mutate(l)}>
                  <Star className="w-3.5 h-3.5 mr-1" /> Tornar padrão
                </Button>
              )}
              {!l.ativo && <Badge variant="secondary">Inativo</Badge>}
            </CardContent>
          </Card>
        ))}
        {list.data?.length === 0 && <p className="text-sm text-muted-foreground">Nenhum modelo ainda. Sem modelo, os documentos saem sem cabeçalho.</p>}
      </div>

      <Dialog open={!!f} onOpenChange={(o) => !o && setF(null)}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          {f && (
            <>
              <DialogHeader>
                <DialogTitle>{f.id ? "Editar papel timbrado" : "Novo papel timbrado"}</DialogTitle>
                <DialogDescription>Documentos já emitidos não mudam: cada um guarda o papel timbrado usado na emissão.</DialogDescription>
              </DialogHeader>
              <div className="space-y-5">
                <div className="space-y-2">
                  <Label htmlFor="l-nome">Nome do modelo</Label>
                  <Input id="l-nome" value={f.nome} onChange={(e) => setF({ ...f, nome: e.target.value })} placeholder="Ex.: Papel da clínica" />
                </div>

                <RadioGroup value={f.modo} onValueChange={(v) => setF({ ...f, modo: v as Modo, top: PRESETS[v as Modo].top, bottom: PRESETS[v as Modo].bottom })} className="space-y-2">
                  {MODOS.map((m) => (
                    <label key={m.value} htmlFor={`m-${m.value}`} className={`flex gap-3 rounded-lg border p-3 cursor-pointer ${f.modo === m.value ? "border-primary bg-primary/5" : ""}`}>
                      <RadioGroupItem id={`m-${m.value}`} value={m.value} className="mt-1" />
                      <span>
                        <span className="font-medium block">{m.titulo}</span>
                        <span className="text-xs text-muted-foreground">{m.texto}</span>
                      </span>
                    </label>
                  ))}
                </RadioGroup>

                {f.modo === "padrao" && (
                  <div className="space-y-4">
                    <div className="space-y-2">
                      <Label htmlFor="l-logo">Logotipo (opcional)</Label>
                      <div className="flex items-center gap-3">
                        {f.logo && <img src={f.logo} alt="Logotipo" className="h-12 rounded border" />}
                        <Label htmlFor="l-logo" className="inline-flex items-center gap-2 rounded-md border px-3 py-2 text-sm cursor-pointer hover:bg-muted">
                          <ImageUp className="w-4 h-4" /> {f.logo ? "Trocar" : "Enviar"} imagem
                        </Label>
                        <input id="l-logo" type="file" accept="image/png,image/jpeg" className="sr-only" onChange={(e) => upload(e, "logo")} />
                        {f.logo && (
                          <Button type="button" variant="ghost" size="sm" onClick={() => setF({ ...f, logo: null })}>
                            Remover
                          </Button>
                        )}
                      </div>
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="l-linhas">Cabeçalho (uma linha por linha, até 6)</Label>
                      <Textarea id="l-linhas" rows={4} value={f.linhas} onChange={(e) => setF({ ...f, linhas: e.target.value })} placeholder={"Nome da clínica\nCNPJ · endereço\nTelefone · e-mail"} />
                      <p className="text-xs text-muted-foreground">A primeira linha aparece em destaque.</p>
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="l-rodape">Rodapé</Label>
                      <Input id="l-rodape" value={f.rodape} onChange={(e) => setF({ ...f, rodape: e.target.value })} />
                    </div>
                  </div>
                )}

                {f.modo === "imagem" && (
                  <div className="space-y-2">
                    <Label htmlFor="l-fundo">Arte do papel timbrado (A4, PNG ou JPEG)</Label>
                    <div className="flex items-center gap-3">
                      {f.fundo && <img src={f.fundo} alt="Papel timbrado" className="h-24 rounded border" />}
                      <Label htmlFor="l-fundo" className="inline-flex items-center gap-2 rounded-md border px-3 py-2 text-sm cursor-pointer hover:bg-muted">
                        <ImageUp className="w-4 h-4" /> {f.fundo ? "Trocar" : "Enviar"} imagem
                      </Label>
                      <input id="l-fundo" type="file" accept="image/png,image/jpeg" className="sr-only" onChange={(e) => upload(e, "fundo")} />
                    </div>
                    <p className="text-xs text-muted-foreground">Ajuste as margens abaixo para o texto não cobrir o cabeçalho e o rodapé da arte.</p>
                  </div>
                )}

                <div>
                  <p className="text-sm font-medium mb-2">Margens (mm)</p>
                  <div className="grid grid-cols-4 gap-3">
                    {([["top", "Topo", 5, 80], ["bottom", "Rodapé", 5, 80], ["left", "Esquerda", 10, 50], ["right", "Direita", 10, 50]] as const).map(([k, label, min, max]) => (
                      <div key={k} className="space-y-1">
                        <Label htmlFor={`mg-${k}`} className="text-xs">{label}</Label>
                        <Input id={`mg-${k}`} type="number" min={min} max={max} value={f[k]} onChange={setNum(k)} />
                      </div>
                    ))}
                  </div>
                </div>

                <div className="flex items-center justify-between rounded-lg border p-3">
                  <Label htmlFor="l-def">Usar como padrão</Label>
                  <Switch id="l-def" checked={f.is_default} onCheckedChange={(v) => setF({ ...f, is_default: v })} />
                </div>
                {f.id && (
                  <div className="flex items-center justify-between rounded-lg border p-3">
                    <Label htmlFor="l-ativo">Modelo ativo</Label>
                    <Switch id="l-ativo" checked={f.ativo} onCheckedChange={(v) => setF({ ...f, ativo: v })} />
                  </div>
                )}
              </div>
              <DialogFooter className="gap-2 sm:gap-2">
                <Button type="button" variant="outline" onClick={preview}>
                  <Eye className="w-4 h-4 mr-2" /> Visualizar exemplo
                </Button>
                <Button type="button" disabled={save.isPending || f.nome.trim().length < 2} onClick={() => save.mutate(f)}>
                  {save.isPending ? "Salvando..." : "Salvar"}
                </Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
