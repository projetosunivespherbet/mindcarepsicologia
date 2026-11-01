// Escalas de rastreio de domínio público, aplicadas pelo psicólogo durante a sessão.
// Não são testes psicológicos (SATEPSI) e não substituem a avaliação clínica.

export type EscalaKey = "phq9" | "gad7";

export const OPCOES = ["Nenhuma vez", "Vários dias", "Mais da metade dos dias", "Quase todos os dias"] as const;

export interface EscalaDef {
  key: EscalaKey;
  nome: string;
  sobre: string;
  pergunta: string;
  itens: string[];
  max: number;
  faixas: { ate: number; nome: string }[];
}

export const ESCALAS: Record<EscalaKey, EscalaDef> = {
  phq9: {
    key: "phq9",
    nome: "PHQ-9",
    sobre: "Rastreio de sintomas depressivos",
    pergunta: "Nas últimas 2 semanas, com que frequência você foi incomodado(a) por algum dos problemas abaixo?",
    itens: [
      "Pouco interesse ou pouco prazer em fazer as coisas",
      "Sentir-se para baixo, deprimido(a) ou sem perspectiva",
      "Dificuldade para pegar no sono ou permanecer dormindo, ou dormir mais do que de costume",
      "Sentir-se cansado(a) ou com pouca energia",
      "Falta de apetite ou comer demais",
      "Sentir-se mal consigo mesmo(a), ou achar que é um fracasso ou que decepcionou a família ou a si mesmo(a)",
      "Dificuldade para se concentrar nas coisas, como ler o jornal ou ver televisão",
      "Lentidão para se movimentar ou falar a ponto de outras pessoas perceberem, ou o oposto: estar tão agitado(a) ou inquieto(a) que fica andando de um lado para o outro mais do que de costume",
      "Pensar em se ferir de alguma maneira ou que seria melhor estar morto(a)",
    ],
    max: 27,
    faixas: [
      { ate: 4, nome: "Mínimo" },
      { ate: 9, nome: "Leve" },
      { ate: 14, nome: "Moderado" },
      { ate: 19, nome: "Moderadamente grave" },
      { ate: 27, nome: "Grave" },
    ],
  },
  gad7: {
    key: "gad7",
    nome: "GAD-7",
    sobre: "Rastreio de sintomas de ansiedade",
    pergunta: "Nas últimas 2 semanas, com que frequência você foi incomodado(a) pelos problemas abaixo?",
    itens: [
      "Sentir-se nervoso(a), ansioso(a) ou muito tenso(a)",
      "Não ser capaz de impedir ou de controlar as preocupações",
      "Preocupar-se muito com diversas coisas",
      "Dificuldade para relaxar",
      "Ficar tão agitado(a) que se torna difícil permanecer sentado(a)",
      "Ficar facilmente aborrecido(a) ou irritado(a)",
      "Sentir medo como se algo horrível fosse acontecer",
    ],
    max: 21,
    faixas: [
      { ate: 4, nome: "Mínimo" },
      { ate: 9, nome: "Leve" },
      { ate: 14, nome: "Moderado" },
      { ate: 21, nome: "Grave" },
    ],
  },
};

export const pontuar = (respostas: number[]) => respostas.reduce((t, r) => t + r, 0);

export function faixa(escala: EscalaKey, pontuacao: number): string {
  return ESCALAS[escala].faixas.find((f) => pontuacao <= f.ate)?.nome ?? "";
}

/** PHQ-9, item 9 (pensamentos de se ferir) acima de zero: o profissional precisa avaliar o risco na hora. */
export const alertaRisco = (escala: EscalaKey, respostas: number[]) => escala === "phq9" && (respostas[8] ?? 0) > 0;
