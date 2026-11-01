import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useAuth } from "@/contexts/AuthContext";
import { api } from "@/lib/api";
import { formatCpf } from "@shared/documents";

interface ClinicInfo {
  nome: string;
  razao_social: string | null;
  documento_tipo: "cpf" | "cnpj" | null;
  documento: string | null;
  telefone: string | null;
  email: string | null;
  endereco: string | null;
  encarregado_nome: string | null;
  encarregado_email: string | null;
}

const ATUALIZADO = "01/11/2026";

const fmtDoc = (c: ClinicInfo) =>
  !c.documento ? null : c.documento_tipo === "cpf" ? `CPF ${formatCpf(c.documento)}` : `CNPJ ${c.documento.replace(/^(.{2})(.{3})(.{3})(.{4})(.{2})$/, "$1.$2.$3/$4-$5")}`;

function Secao({ titulo, children }: { titulo: string; children: ReactNode }) {
  return (
    <section className="space-y-2">
      <h2 className="text-base font-semibold">{titulo}</h2>
      <div className="space-y-2 text-sm leading-relaxed [&_li]:ml-5 [&_li]:list-disc">{children}</div>
    </section>
  );
}

function Falta({ children }: { children: ReactNode }) {
  return <span className="rounded bg-amber-500/15 px-1 text-amber-800 dark:text-amber-300">{children}</span>;
}

/** Políticas internas: privacidade (LGPD), termos de uso da equipe, segurança e incidentes, guarda e descarte. */
export default function Policies() {
  const { user } = useAuth();
  const q = useQuery({ queryKey: ["clinic-info"], queryFn: () => api<ClinicInfo | null>("/clinic-info") });
  const c = q.data;
  const nome = c?.razao_social || c?.nome || user?.clinic_nome || "a clínica";
  const contato = [c?.email, c?.telefone].filter(Boolean).join(" · ");
  const admin = user?.role === "admin";
  const pedir = (o: string) => (admin ? <Link to="/clinica" className="underline">{o} (preencha em Clínica)</Link> : <Falta>{o} (a administração preenche)</Falta>);

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold">Políticas e privacidade</h1>
        <p className="text-sm text-muted-foreground">Como {nome} trata os dados de pacientes e da equipe no MindCare. Última atualização: {ATUALIZADO}.</p>
      </div>
      <p className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-sm">
        Modelo de referência, escrito a partir de como o sistema funciona. Antes de divulgar aos pacientes, revise com a assessoria jurídica ou contábil da clínica.
      </p>
      <Tabs defaultValue="privacidade" className="space-y-4">
        <TabsList className="h-auto flex-wrap justify-start">
          <TabsTrigger value="privacidade">Privacidade (LGPD)</TabsTrigger>
          <TabsTrigger value="termos">Termos de uso da equipe</TabsTrigger>
          <TabsTrigger value="seguranca">Segurança e incidentes</TabsTrigger>
          <TabsTrigger value="guarda">Guarda e descarte</TabsTrigger>
        </TabsList>

        <TabsContent value="privacidade">
          <Card>
            <CardHeader>
              <CardTitle>Política de privacidade</CardTitle>
              <CardDescription>Lei Geral de Proteção de Dados Pessoais (Lei nº 13.709/2018).</CardDescription>
            </CardHeader>
            <CardContent className="space-y-5">
              <Secao titulo="Quem é responsável pelos dados">
                <p>
                  A controladora dos dados é <strong>{nome}</strong>
                  {c && fmtDoc(c) ? `, ${fmtDoc(c)}` : ""}
                  {c?.endereco ? `, ${c.endereco}` : ""}. Contato: {contato || pedir("e-mail ou telefone da clínica")}.
                </p>
                <p>
                  Encarregado(a) pelo tratamento de dados: {c?.encarregado_nome ? <strong>{c.encarregado_nome}</strong> : pedir("nome do encarregado")}
                  {c?.encarregado_email ? ` (${c.encarregado_email})` : ""}.
                </p>
                <p>O MindCare é a ferramenta usada pela clínica; a infraestrutura (servidores e banco de dados) é contratada de provedores de nuvem.</p>
              </Secao>
              <Secao titulo="Quais dados tratamos e para quê">
                <ul>
                  <li><strong>Identificação e contato</strong> (nome, CPF, CNS, nascimento, endereço, telefone, e-mail, responsável legal): cadastro, agendamento, contato e emissão de documentos.</li>
                  <li><strong>Dados de saúde</strong> (prontuário, anotações privativas, anamnese, plano terapêutico, escalas, documentos psicológicos): prestação do serviço psicológico e cumprimento das normas do Conselho Federal de Psicologia.</li>
                  <li><strong>Dados financeiros</strong> (cobranças, pagamentos, responsável financeiro): cobrança e obrigações fiscais, como o Receita Saúde.</li>
                  <li><strong>Dados da equipe</strong> (nome, e-mail, CRP, CPF, chave Pix, registros de acesso): controle de acesso, segurança e pagamentos.</li>
                </ul>
              </Secao>
              <Secao titulo="Bases legais">
                <ul>
                  <li>Dados de saúde: tutela da saúde, em procedimento realizado por profissional de saúde (art. 11, II, "f"), e cumprimento de obrigação legal ou regulatória (art. 11, II, "a").</li>
                  <li>Cadastro, agenda e cobrança: execução de contrato (art. 7º, V) e obrigação legal, inclusive fiscal (art. 7º, II).</li>
                  <li>Registros de acesso e segurança: legítimo interesse e exercício regular de direitos (art. 7º, IX e VI).</li>
                  <li>Crianças e adolescentes: tratamento no melhor interesse deles, com o responsável legal (art. 14).</li>
                </ul>
              </Secao>
              <Secao titulo="Com quem os dados são compartilhados">
                <ul>
                  <li><strong>Ninguém de fora recebe conteúdo clínico.</strong> Prontuário, anotações e escalas não saem do sistema.</li>
                  <li>Receita Federal: o profissional envia os recibos do Receita Saúde (nome, CPF e valores), por obrigação legal.</li>
                  <li>Provedores de infraestrutura (hospedagem e banco de dados), que guardam os dados sem acesso ao conteúdo para outros fins.</li>
                  <li>Consulta de CEP (ViaCEP): só o número do CEP é enviado, para preencher o endereço.</li>
                  <li>Autoridades, quando houver ordem judicial ou exigência legal.</li>
                </ul>
              </Secao>
              <Secao titulo="Quem dentro da clínica vê o quê">
                <ul>
                  <li>Prontuário, anotações privativas, anamnese, plano terapêutico, escalas e documentos: só o(a) psicólogo(a) que atende o paciente.</li>
                  <li>Recepção: cadastro, agenda, observações não clínicas e financeiro. Nunca o conteúdo clínico.</li>
                  <li>Administração: gestão da clínica e financeiro; conteúdo clínico só se também atender o paciente.</li>
                </ul>
              </Secao>
              <Secao titulo="Direitos do titular (art. 18)">
                <p>
                  O paciente, ou o responsável legal, pode pedir: confirmação de que tratamos seus dados, acesso, correção, informação sobre compartilhamento, portabilidade e cópia do prontuário. A eliminação de dados de saúde
                  segue os prazos mínimos de guarda (aba Guarda e descarte). Pedidos: pelo contato do encarregado acima. Também é possível reclamar à ANPD.
                </p>
              </Secao>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="termos">
          <Card>
            <CardHeader>
              <CardTitle>Termos de uso da equipe</CardTitle>
              <CardDescription>Vale para todas as pessoas com login no MindCare.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-5">
              <Secao titulo="Acesso">
                <ul>
                  <li>O login é pessoal e intransferível. Não compartilhe senha nem deixe a sessão aberta em computador de uso comum.</li>
                  <li>Use senha forte e troque-a se suspeitar de vazamento.</li>
                  <li>Ao deixar a clínica, a administração desativa o acesso no mesmo dia.</li>
                </ul>
              </Secao>
              <Secao titulo="Sigilo">
                <ul>
                  <li>Todo dado de paciente é sigiloso, conforme o Código de Ética Profissional do Psicólogo e a LGPD.</li>
                  <li>Observações da agenda e do cadastro são abertas à equipe: nunca escreva conteúdo clínico nelas.</li>
                  <li>Não copie dados do sistema para aplicativos pessoais, planilhas ou mensagens sem necessidade do atendimento.</li>
                  <li>Documentos e PDFs baixados ficam sob responsabilidade de quem os baixou.</li>
                </ul>
              </Secao>
              <Secao titulo="Registros">
                <ul>
                  <li>O sistema registra quem leu, criou, alterou ou exportou informações. Prontuários não são apagados e cada alteração gera uma versão.</li>
                  <li>Informações devem ser verdadeiras e registradas no dia do atendimento, sempre que possível.</li>
                </ul>
              </Secao>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="seguranca">
          <Card>
            <CardHeader>
              <CardTitle>Segurança da informação e resposta a incidentes</CardTitle>
              <CardDescription>O que o sistema faz e o que a clínica faz se algo der errado.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-5">
              <Secao titulo="Proteções do sistema">
                <ul>
                  <li>Conexão criptografada (HTTPS) em todo o acesso.</li>
                  <li>Cada consulta ao banco roda com a identidade de quem está logado: o próprio banco recusa o que a pessoa não pode ver.</li>
                  <li>Limite de tentativas de login e verificação anti-robô (quando ativada).</li>
                  <li>Auditoria de leitura, gravação e exportação de dados clínicos; versões imutáveis do prontuário.</li>
                </ul>
              </Secao>
              <Secao titulo="Se houver um incidente">
                <p>Incidente é qualquer acesso indevido, perda ou vazamento de dados: um login usado por outra pessoa, um computador roubado com o sistema aberto, um PDF enviado à pessoa errada.</p>
                <ol className="ml-5 list-decimal space-y-1">
                  <li className="!list-decimal">Avise a administração e o encarregado imediatamente.</li>
                  <li className="!list-decimal">Contenha: troque senhas, desative acessos, peça a exclusão do material enviado por engano.</li>
                  <li className="!list-decimal">Registre o que houve, quando, quais dados e quantos pacientes.</li>
                  <li className="!list-decimal">
                    Se houver risco ou dano relevante aos pacientes, a clínica comunica a ANPD e os titulares em até 3 dias úteis (Resolução CD/ANPD nº 15/2024).
                  </li>
                </ol>
              </Secao>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="guarda">
          <Card>
            <CardHeader>
              <CardTitle>Guarda e descarte</CardTitle>
              <CardDescription>Por quanto tempo os dados ficam guardados.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-5">
              <Secao titulo="Prazos">
                <ul>
                  <li>
                    <strong>Prontuário e documentos psicológicos</strong>: no mínimo 5 anos, conforme orientação do Conselho Federal de Psicologia; o prazo pode ser maior por lei, ordem judicial ou necessidade do caso.
                  </li>
                  <li><strong>Dados financeiros e fiscais</strong>: pelo prazo exigido pela legislação fiscal.</li>
                  <li><strong>Registros de acesso e auditoria</strong>: enquanto a clínica usar o sistema, para segurança e defesa de direitos.</li>
                </ul>
              </Secao>
              <Secao titulo="Como funciona no MindCare">
                <ul>
                  <li>Dados clínicos não são apagados pela tela: pacientes são desativados, e o histórico continua disponível ao profissional responsável.</li>
                  <li>Ao encerrar o uso do sistema, a clínica deve exportar e guardar os prontuários (documento do prontuário em PDF) pelo prazo mínimo.</li>
                  <li>Cópias impressas ou baixadas devem ser guardadas em local seguro e destruídas de forma que não possam ser lidas.</li>
                </ul>
              </Secao>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
