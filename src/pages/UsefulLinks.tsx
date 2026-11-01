import { ExternalLink } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

const GRUPOS: { titulo: string; links: { nome: string; url: string; para: string }[] }[] = [
  {
    titulo: "Conselho e normas da profissão",
    links: [
      { nome: "Conselho Federal de Psicologia (CFP)", url: "https://site.cfp.org.br", para: "Resoluções, Código de Ética, orientações" },
      { nome: "Guarda e descarte de documentos (CFP)", url: "https://site.cfp.org.br/?p=2570", para: "Prazo mínimo de guarda do registro documental" },
      { nome: "Declaração para prestação de serviços (CFP)", url: "https://site.cfp.org.br/e-psi-cfp-orienta-categoria-sobre-como-obter-declaracao-para-prestacao-de-servicos/", para: "Orientação do CFP sobre atendimento on-line" },
    ],
  },
  {
    titulo: "Impostos e notas",
    links: [
      { nome: "e-CAC (Receita Federal)", url: "https://cav.receita.fazenda.gov.br", para: "Carnê-Leão e importação do arquivo do Receita Saúde" },
      { nome: "Manual do Receita Saúde 2.1", url: "https://www.gov.br/receitafederal/pt-br/centrais-de-conteudo/publicacoes/manuais/orientacao-tributaria/receita-saude-2.1.pdf", para: "Layout do arquivo e regras dos recibos" },
      { nome: "Recibos de saúde digitais (Serpro)", url: "https://www.serpro.gov.br/menu/noticias/noticias-2025/recibos-de-saude-digitais", para: "Explicação sobre o recibo digital" },
      { nome: "Emissor Nacional da NFS-e", url: "https://www.nfse.gov.br/EmissorNacional", para: "Emissão de nota fiscal de serviço" },
      { nome: "Documentação técnica da NFS-e", url: "https://www.gov.br/nfse/pt-br/biblioteca/documentacao-tecnica/apis-prod-restrita-e-producao", para: "APIs de produção e homologação" },
    ],
  },
  {
    titulo: "Proteção de dados (LGPD)",
    links: [
      { nome: "Lei Geral de Proteção de Dados (Lei nº 13.709/2018)", url: "https://www.planalto.gov.br/ccivil_03/_ato2015-2018/2018/lei/l13709.htm", para: "Texto da lei" },
      { nome: "Autoridade Nacional de Proteção de Dados (ANPD)", url: "https://www.gov.br/anpd/pt-br", para: "Guias e orientações" },
      { nome: "Comunicação de incidente de segurança (ANPD)", url: "https://www.gov.br/anpd/pt-br/assuntos/incidente-de-seguranca", para: "Como e quando comunicar um incidente" },
    ],
  },
  {
    titulo: "Apoio em situação de crise",
    links: [
      { nome: "CVV: Centro de Valorização da Vida (ligue 188)", url: "https://cvv.org.br", para: "Apoio emocional 24 horas, gratuito" },
      { nome: "SAMU (ligue 192)", url: "https://www.gov.br/saude/pt-br/composicao/saes/samu-192", para: "Urgência e emergência médica" },
    ],
  },
  {
    titulo: "Ferramentas usadas pelo MindCare",
    links: [{ nome: "ViaCEP", url: "https://viacep.com.br", para: "Consulta de endereço pelo CEP" }],
  },
];

/** Links úteis para o dia a dia da clínica. */
export default function UsefulLinks() {
  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold">Links úteis</h1>
        <p className="text-sm text-muted-foreground">Sites oficiais e de apoio. Abrem em uma nova aba.</p>
      </div>
      <div className="grid gap-4 md:grid-cols-2">
        {GRUPOS.map((g) => (
          <Card key={g.titulo}>
            <CardHeader>
              <CardTitle className="text-base">{g.titulo}</CardTitle>
            </CardHeader>
            <CardContent>
              <ul className="space-y-3">
                {g.links.map((l) => (
                  <li key={l.url}>
                    <a href={l.url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 font-medium text-primary hover:underline">
                      {l.nome} <ExternalLink className="h-3.5 w-3.5" />
                    </a>
                    <p className="text-xs text-muted-foreground">{l.para}</p>
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
