import { useState } from "react";
import { Loader2 } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

interface ViaCep {
  logradouro?: string;
  bairro?: string;
  localidade?: string;
  uf?: string;
  erro?: boolean | string;
}

/** "Praça da Sé, nº , Sé, São Paulo/SP, CEP 01001-000": o número fica para a pessoa completar. */
export function enderecoDoCep(cep: string, r: ViaCep): string {
  const cidade = r.localidade ? (r.uf ? `${r.localidade}/${r.uf}` : r.localidade) : "";
  return [r.logradouro ? `${r.logradouro}, nº ` : "", r.bairro ?? "", cidade, `CEP ${cep.slice(0, 5)}-${cep.slice(5)}`].filter(Boolean).join(", ");
}

/**
 * Endereço com busca por CEP (ViaCEP, gratuito e sem chave). Só o CEP sai do navegador; nenhum dado do paciente.
 * O endereço continua sendo um texto livre: a busca apenas preenche rua, bairro, cidade/UF e CEP.
 */
export function AddressInput({ id, value, onChange }: { id: string; value: string; onChange: (v: string) => void }) {
  const [cep, setCep] = useState("");
  const [status, setStatus] = useState<"" | "buscando" | "nao-achou" | "falhou">("");

  const buscar = async (raw: string) => {
    const digitos = raw.replace(/\D/g, "");
    setCep(raw);
    if (digitos.length !== 8) return setStatus("");
    setStatus("buscando");
    try {
      const res = await fetch(`https://viacep.com.br/ws/${digitos}/json/`);
      const r = (await res.json()) as ViaCep;
      if (!res.ok || r.erro) return setStatus("nao-achou");
      onChange(enderecoDoCep(digitos, r));
      setStatus("");
    } catch {
      setStatus("falhou");
    }
  };

  return (
    <div className="grid gap-2 sm:grid-cols-[9rem_1fr]">
      <div className="space-y-2">
        <Label htmlFor={`${id}-cep`}>CEP</Label>
        <div className="relative">
          <Input id={`${id}-cep`} inputMode="numeric" maxLength={9} placeholder="00000-000" value={cep} onChange={(e) => void buscar(e.target.value)} />
          {status === "buscando" && <Loader2 className="absolute right-2 top-3 h-4 w-4 animate-spin text-muted-foreground" />}
        </div>
      </div>
      <div className="space-y-2">
        <Label htmlFor={id}>Endereço</Label>
        <Input id={id} maxLength={300} placeholder="Rua, número, bairro, cidade/UF" value={value} onChange={(e) => onChange(e.target.value)} />
      </div>
      {status === "nao-achou" && <p className="text-xs text-destructive sm:col-span-2">CEP não encontrado. Preencha o endereço à mão.</p>}
      {status === "falhou" && <p className="text-xs text-destructive sm:col-span-2">Não foi possível consultar o CEP agora. Preencha o endereço à mão.</p>}
      {status === "" && value.includes("nº ,") && <p className="text-xs text-muted-foreground sm:col-span-2">Complete o número (e o complemento, se houver).</p>}
    </div>
  );
}
