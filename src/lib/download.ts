import { toast } from "sonner";
import { API_URL, tokenStore } from "@/lib/api";

/** Baixa um arquivo que a API só entrega com login (XML, CSV): envia o token e salva pelo navegador. */
export async function downloadAuthed(path: string, filename: string) {
  const res = await fetch(`${API_URL}${path}`, { headers: { Authorization: `Bearer ${tokenStore.get() ?? ""}` } });
  if (!res.ok) {
    toast.error("Não foi possível baixar o arquivo");
    return;
  }
  const url = URL.createObjectURL(await res.blob());
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
