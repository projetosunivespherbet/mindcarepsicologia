/** Pix "copia e cola" estático (BR Code, Manual de Padrões do Pix do Banco Central). Roda no navegador; nada é enviado a terceiros. */

const tlv = (id: string, value: string) => `${id}${String(value.length).padStart(2, "0")}${value}`;

/** CRC16/CCITT-FALSE (polinômio 0x1021, início 0xFFFF), em hexadecimal maiúsculo com 4 dígitos. */
export function crc16(text: string): string {
  let crc = 0xffff;
  for (let i = 0; i < text.length; i++) {
    crc ^= text.charCodeAt(i) << 8;
    for (let b = 0; b < 8; b++) crc = crc & 0x8000 ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff;
  }
  return crc.toString(16).toUpperCase().padStart(4, "0");
}

/** Maiúsculas, sem acento e só letras, números e espaço (o campo do BR Code é restrito). */
function plain(text: string, max: number, fallback: string): string {
  const s = text
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase()
    .replace(/[^A-Z0-9 ]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max)
    .trim();
  return s || fallback;
}

export interface PixInput {
  /** Chave Pix de quem recebe (CPF, CNPJ, e-mail, telefone +55… ou chave aleatória). */
  chave: string;
  /** Valor em centavos; 0 ou omitido deixa o valor livre para o pagador digitar. */
  valorCentavos?: number;
  /** Nome de quem recebe (até 25 caracteres, sem acentos). */
  nome: string;
  /** Cidade de quem recebe (até 15 caracteres). */
  cidade?: string;
}

export function pixCopiaECola({ chave, valorCentavos, nome, cidade = "BRASIL" }: PixInput): string {
  const conta = tlv("26", tlv("00", "br.gov.bcb.pix") + tlv("01", chave.trim()));
  const partes = [
    tlv("00", "01"),
    tlv("01", "11"),
    conta,
    tlv("52", "0000"),
    tlv("53", "986"),
    ...(valorCentavos && valorCentavos > 0 ? [tlv("54", (valorCentavos / 100).toFixed(2))] : []),
    tlv("58", "BR"),
    tlv("59", plain(nome, 25, "RECEBEDOR")),
    tlv("60", plain(cidade, 15, "BRASIL")),
    tlv("62", tlv("05", "***")),
  ];
  const semCrc = `${partes.join("")}6304`;
  return `${semCrc}${crc16(semCrc)}`;
}
