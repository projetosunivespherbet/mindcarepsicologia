/** Gráfico de linha simples (SVG, sem bibliotecas): evolução de uma medida ao longo das datas. */
export function LineChart({
  pontos,
  max,
  faixas = [],
  rotulo,
}: {
  pontos: { data: string; valor: number }[];
  max: number;
  /** Faixas de referência ao fundo (ex.: leve, moderado), do valor `de` ao `ate`. */
  faixas?: { de: number; ate: number; nome: string }[];
  rotulo: string;
}) {
  const W = 560, H = 180, L = 32, R = 12, T = 12, B = 28;
  const n = pontos.length;
  const x = (i: number) => (n <= 1 ? L + (W - L - R) / 2 : L + (i * (W - L - R)) / (n - 1));
  const y = (v: number) => T + (1 - v / max) * (H - T - B);
  const dia = (iso: string) => new Date(iso).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" });
  const ticks = [0, Math.round(max / 2), max];
  return (
    <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={rotulo} className="h-auto w-full max-w-xl">
      {faixas.map((f, i) => (
        <g key={f.nome}>
          <rect x={L} y={y(f.ate)} width={W - L - R} height={y(f.de) - y(f.ate)} className={i % 2 ? "fill-muted/60" : "fill-muted/20"} />
          <text x={W - R - 4} y={y(f.ate) + 11} textAnchor="end" className="fill-muted-foreground" fontSize="10">
            {f.nome}
          </text>
        </g>
      ))}
      {ticks.map((t) => (
        <text key={t} x={L - 6} y={y(t) + 4} textAnchor="end" className="fill-muted-foreground" fontSize="10">
          {t}
        </text>
      ))}
      <line x1={L} x2={W - R} y1={y(0)} y2={y(0)} className="stroke-border" />
      {n > 1 && <polyline fill="none" className="stroke-primary" strokeWidth="2" points={pontos.map((p, i) => `${x(i)},${y(p.valor)}`).join(" ")} />}
      {pontos.map((p, i) => (
        <g key={`${p.data}-${i}`}>
          <circle cx={x(i)} cy={y(p.valor)} r="4" className="fill-primary" />
          <text x={x(i)} y={y(p.valor) - 8} textAnchor="middle" fontSize="10" className="fill-foreground">
            {p.valor}
          </text>
          {(n <= 8 || i === 0 || i === n - 1 || i % Math.ceil(n / 6) === 0) && (
            <text x={x(i)} y={H - 8} textAnchor="middle" fontSize="10" className="fill-muted-foreground">
              {dia(p.data)}
            </text>
          )}
        </g>
      ))}
    </svg>
  );
}
