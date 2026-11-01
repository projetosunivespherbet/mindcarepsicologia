import { useState } from "react";
import { Loader2, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export interface Endereco {
  end_cep: string;
  end_logradouro: string;
  end_numero: string;
  end_complemento: string;
  end_bairro: string;
  end_cidade: string;
  end_uf: string;
}

export const ENDERECO_VAZIO: Endereco = { end_cep: "", end_logradouro: "", end_numero: "", end_complemento: "", end_bairro: "", end_cidade: "", end_uf: "" };

interface ViaCep {
  cep?: string;
  logradouro?: string;
  complemento?: string;
  bairro?: string;
  localidade?: string;
  uf?: string;
  erro?: boolean | string;
}

const UFS = ["AC", "AL", "AP", "AM", "BA", "CE", "DF", "ES", "GO", "MA", "MT", "MS", "MG", "PA", "PB", "PR", "PE", "PI", "RJ", "RN", "RS", "RO", "RR", "SC", "SP", "SE", "TO"];
const so8 = (s: string) => s.replace(/\D/g, "").slice(0, 8);
const cepFmt = (d: string) => (d.length === 8 ? `${d.slice(0, 5)}-${d.slice(5)}` : d);

/** Texto do endereço para documentos: "Rua X, 123, apto 4, Bairro, Cidade/UF, CEP 00000-000". */
export function montarEndereco(e: Endereco): string {
  const rua = [e.end_logradouro.trim(), e.end_numero.trim(), e.end_complemento.trim()].filter(Boolean).join(", ");
  const cidade = e.end_cidade.trim() ? (e.end_uf ? `${e.end_cidade.trim()}/${e.end_uf}` : e.end_cidade.trim()) : e.end_uf;
  const cep = so8(e.end_cep);
  return [rua, e.end_bairro.trim(), cidade, cep.length === 8 ? `CEP ${cepFmt(cep)}` : ""].filter(Boolean).join(", ");
}

/** Resultado do ViaCEP → partes do endereço (número e complemento ficam com a pessoa). */
export function partesDoViaCep(r: ViaCep, atual: Endereco): Endereco {
  return {
    ...atual,
    end_cep: so8(r.cep ?? atual.end_cep),
    end_logradouro: r.logradouro ?? "",
    end_bairro: r.bairro ?? "",
    end_cidade: r.localidade ?? "",
    end_uf: r.uf ?? "",
  };
}

/**
 * Endereço em campos separados. O CEP preenche rua, bairro, cidade e UF (ViaCEP, gratuito, sem chave);
 * sem o CEP, a busca por UF + cidade + rua encontra o CEP. Só o CEP ou o nome da rua saem do navegador.
 */
export function AddressInput({ id, value, onChange }: { id: string; value: Endereco; onChange: (v: Endereco) => void }) {
  const [status, setStatus] = useState<"" | "buscando" | "nao-achou" | "falhou">("");
  const [busca, setBusca] = useState(false);
  const [resultados, setResultados] = useState<ViaCep[] | null>(null);
  const set = (k: keyof Endereco) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => onChange({ ...value, [k]: e.target.value });

  const porCep = async (raw: string) => {
    const d = so8(raw);
    onChange({ ...value, end_cep: d });
    if (d.length !== 8) return setStatus("");
    setStatus("buscando");
    try {
      const res = await fetch(`https://viacep.com.br/ws/${d}/json/`);
      const r = (await res.json()) as ViaCep;
      if (!res.ok || r.erro) return setStatus("nao-achou");
      onChange(partesDoViaCep(r, { ...value, end_cep: d }));
      setStatus("");
    } catch {
      setStatus("falhou");
    }
  };

  const porRua = async () => {
    if (!value.end_uf || value.end_cidade.trim().length < 3 || value.end_logradouro.trim().length < 3) {
      return setStatus("nao-achou");
    }
    setStatus("buscando");
    try {
      const url = `https://viacep.com.br/ws/${value.end_uf}/${encodeURIComponent(value.end_cidade.trim())}/${encodeURIComponent(value.end_logradouro.trim())}/json/`;
      const res = await fetch(url);
      const r = (await res.json()) as ViaCep[] | ViaCep;
      const lista = Array.isArray(r) ? r : [];
      setResultados(lista);
      setStatus(lista.length ? "" : "nao-achou");
    } catch {
      setStatus("falhou");
    }
  };

  return (
    <div className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-[9rem_1fr]">
        <div className="space-y-2">
          <Label htmlFor={`${id}-cep`}>CEP</Label>
          <div className="relative">
            <Input id={`${id}-cep`} inputMode="numeric" maxLength={9} placeholder="00000-000" value={cepFmt(value.end_cep)} onChange={(e) => void porCep(e.target.value)} />
            {status === "buscando" && <Loader2 className="absolute right-2 top-3 h-4 w-4 animate-spin text-muted-foreground" />}
          </div>
        </div>
        <div className="flex items-end">
          <Button type="button" variant="ghost" size="sm" onClick={() => setBusca(!busca)}>
            <Search className="mr-1 h-4 w-4" /> {busca ? "Fechar busca" : "Não sei o CEP"}
          </Button>
        </div>
      </div>
      {busca && <p className="text-xs text-muted-foreground">Preencha UF, cidade e rua (pelo menos 3 letras) e clique em Buscar CEP.</p>}

      <div className="grid gap-3 sm:grid-cols-[1fr_7rem]">
        <div className="space-y-2">
          <Label htmlFor={`${id}-rua`}>Rua</Label>
          <Input id={`${id}-rua`} maxLength={160} value={value.end_logradouro} onChange={set("end_logradouro")} />
        </div>
        <div className="space-y-2">
          <Label htmlFor={`${id}-num`}>Número</Label>
          <Input id={`${id}-num`} maxLength={20} placeholder="s/n" value={value.end_numero} onChange={set("end_numero")} />
        </div>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor={`${id}-comp`}>Complemento</Label>
          <Input id={`${id}-comp`} maxLength={80} placeholder="apto, bloco, casa" value={value.end_complemento} onChange={set("end_complemento")} />
        </div>
        <div className="space-y-2">
          <Label htmlFor={`${id}-bairro`}>Bairro</Label>
          <Input id={`${id}-bairro`} maxLength={80} value={value.end_bairro} onChange={set("end_bairro")} />
        </div>
      </div>
      <div className="grid gap-3 sm:grid-cols-[1fr_7rem]">
        <div className="space-y-2">
          <Label htmlFor={`${id}-cidade`}>Cidade</Label>
          <Input id={`${id}-cidade`} maxLength={80} value={value.end_cidade} onChange={set("end_cidade")} />
        </div>
        <div className="space-y-2">
          <Label htmlFor={`${id}-uf`}>Estado (UF)</Label>
          <select id={`${id}-uf`} className="flex h-10 w-full rounded-md border border-input bg-background px-3 text-sm" value={value.end_uf} onChange={set("end_uf")}>
            <option value="">—</option>
            {UFS.map((u) => (
              <option key={u} value={u}>
                {u}
              </option>
            ))}
          </select>
        </div>
      </div>

      {busca && (
        <div className="space-y-2">
          <Button type="button" variant="outline" size="sm" disabled={status === "buscando"} onClick={() => void porRua()}>
            Buscar CEP
          </Button>
          {resultados && resultados.length > 0 && (
            <ul className="max-h-56 divide-y overflow-y-auto rounded-lg border text-sm" aria-label="CEPs encontrados">
              {resultados.map((r) => (
                <li key={`${r.cep}-${r.complemento}`}>
                  <button
                    type="button"
                    className="w-full p-2 text-left hover:bg-muted/50"
                    onClick={() => {
                      onChange(partesDoViaCep(r, value));
                      setResultados(null);
                      setBusca(false);
                    }}
                  >
                    <span className="font-medium">{r.cep}</span> · {r.logradouro}
                    {r.complemento ? ` (${r.complemento})` : ""} · {r.bairro}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
      {status === "nao-achou" && (
        <p className="text-xs text-destructive">{busca ? "Nada encontrado. Confira UF, cidade e rua (pelo menos 3 letras cada)." : "CEP não encontrado. Preencha os campos à mão."}</p>
      )}
      {status === "falhou" && <p className="text-xs text-destructive">Não foi possível consultar agora. Preencha os campos à mão.</p>}
    </div>
  );
}
