type SlideDef = {
  title: string;
  subtitle?: string;
  body?: string;
  accent?: string;
  layout?: "default" | "camTable";
  table?: { headers: string[]; rows: string[][] };
};
type Slide = { id: string; url: string; name: string };
type RecordingResult = {
  videoUrl: string;
  duration: number;
  slides: Slide[];
  slideMarkers: { slideId: string; time: number }[];
  startAt?: number;
  audioOnly?: boolean;
};

const SLIDES_DATA: SlideDef[] = [
  {
    subtitle: "LECTOR TECNOLOGIA",
    title: "Manual Operacional do Suporte",
    body: "Framework completo de atendimento, processos e fluxos de trabalho.\n\nVersão 1.0 · Equipe de Suporte Técnico",
    accent: "#ff5a1f",
  },
  {
    subtitle: "01",
    title: "Objetivo do Suporte",
    body: "Garantir o funcionamento da plataforma Lector para todos os clientes.\n\nO suporte atua como Suporte Técnico + QA Funcional — investiga, valida regras e documenta para o desenvolvimento.",
  },
  {
    subtitle: "02",
    title: "Entrada de Chamados",
    body: "Tickets chegam por e-mail e geram automaticamente o chamado no Movidesk.\n\nAntes da análise: preencher Solicitante, Serviço, Categoria, Urgência, Responsável, Local, Ambiente e Prioridade.",
  },
  {
    subtitle: "03",
    title: "Primeira Resposta",
    body: "Resposta direta na primeira frase. Linguagem neutra.\n\nNunca afirmar erro do sistema antes da análise. Nunca dar instrução de financeiro sem validar com o time técnico.",
  },
  {
    subtitle: "04",
    title: "Coleta de Informações",
    body: "Solicitar SEMPRE o CPF em chamados de cadastro, duplicidade ou inscrição.\n\nNome e e-mail sozinhos podem não ser identificadores únicos.",
  },
  {
    subtitle: "05",
    title: "Investigação no Sistema",
    body: "Verificar usuários, matrículas, treinamentos e turmas.\n\nDocumentar a análise no chamado antes de executar qualquer ação — garante rastreabilidade.",
  },
  {
    subtitle: "06",
    title: "Classificação do Problema",
    body: "Configuração Incorreta • Limitação do Sistema • Ajuste Pontual de Dados • Possível Bug.\n\nA classificação define o caminho de resolução.",
  },
  {
    subtitle: "07",
    title: "Reprodução de Bug — QA",
    body: "OBRIGATÓRIO reproduzir no ambiente HML antes de encaminhar ao desenvolvimento.\n\nSem reprodução, não há evidência suficiente para o dev analisar.",
  },
  {
    subtitle: "08",
    title: "Escalonamento Interno",
    body: "Suporte analisa → Verifica com Desenvolvimento → Alinha com Alex → Responde cliente.\n\nNunca responder definitivamente sobre financeiro sem alinhamento prévio.",
  },
  {
    subtitle: "09",
    title: "Chamado Filho",
    body: "Principal: comunicação com o cliente.\nFilho: tratativa técnica com o desenvolvimento.\n\nO dev trabalha apenas no chamado filho — o cliente nunca o vê.",
  },
  {
    subtitle: "10",
    title: "Solicitação de Melhoria",
    body: "Funcionalidade inexistente vira chamado de melhoria.\n\nNunca comprometer prazo ao cliente sem confirmação do time de produto.",
  },
  {
    subtitle: "11",
    title: "Resolução e Encerramento",
    body: "Status 16 — Aguardando retorno cliente.\nStatus 20 — Resolvido.\n\nAplicar SEMPRE a macro de fechamento ao encerrar o chamado.",
  },
  {
    subtitle: "12",
    title: "Controle de Apontamentos",
    body: "Terminou a ação? Aponte o tempo imediatamente.\n\nNunca acumule chamados para apontar depois — gera sobreposição e retrabalho.",
  },
  {
    subtitle: "13",
    title: "Tipos de Treinamento — Comparativo",
    layout: "camTable",
    table: {
      headers: ["Aspecto", "Treinam. Internos", "Treinamentos Externos", "Cursos de Formação"],
      rows: [
        ["Benefício", "Gratuitos", "Subsídio 50% do valor do curso, limitado a R$1.000,00", "Reembolso 50% do valor da mensalidade, limite R$400 p/ mês"],
        ["Pagamento", "Não aplicável", "Pagamento à instituição feito pela empresa, desconto em folha", "Pagamento à instituição feito pelo colaborador, reembolso em folha"],
        ["Critérios de Aprovação", "Não aplicável", "Cursos relacionados à função. Profissionais com 6 meses de empresa", "Cursos necessários para a função. 6 meses de empresa e bom desempenho"],
        ["Reprovação / Desistência", "Não aplicável", "Perda do subsídio e desconto dos valores pagos. Suspensão por 6 meses", "Perda do subsídio e suspensão de outros treinamentos por 6 meses"],
        ["Rescisão Empresa", "Não aplicável", "Subsídio suspenso", "Subsídio suspenso"],
        ["Rescisão Empregado", "Não aplicável", "Subsídio suspenso, curso descontado da rescisão + multa", "Subsídio suspenso, curso descontado da rescisão + multa"],
        ["Condições Gerais", "Solicitação Portal RH ou indicação empresa", "Solicitações ao RH a qualquer momento pelo Portal RH", "Solicitações ao RH entre novembro e janeiro pelo Portal RH"],
        ["Matrícula / Inscrição", "Matrícula realizada pela empresa", "Matrícula realizada pela empresa", "Matrícula realizada pelo colaborador"],
      ],
    },
  },
  {
    subtitle: "OBRIGADO",
    title: "Dúvidas?",
    body: "Equipe de Suporte Técnico — Lector Tecnologia\nVersão 1.0",
    accent: "#ff5a1f",
  },
];

function escXml(t: string): string {
  return t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function svgDataUrl(s: SlideDef, index: number, total: number): string {
  const accent = s.accent ?? "#ff5a1f";

  if (s.layout === "camTable" && s.table) {
    return camTableSvg(s, index, total, accent);
  }

  const bodyHtml = escXml(s.body ?? "")
    .split("\n")
    .map((line) => (line.trim() === "" ? "<div style='height:18px'></div>" : `<div>${line}</div>`))
    .join("");

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1920 1080">
    <defs>
      <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0" stop-color="#0a0a0a"/>
        <stop offset="1" stop-color="#1c1c1c"/>
      </linearGradient>
      <linearGradient id="glow" x1="0" y1="0" x2="1" y2="0">
        <stop offset="0" stop-color="${accent}" stop-opacity="0.0"/>
        <stop offset="1" stop-color="${accent}" stop-opacity="0.18"/>
      </linearGradient>
    </defs>
    <rect width="1920" height="1080" fill="url(#bg)"/>
    <rect x="1280" y="0" width="640" height="1080" fill="url(#glow)"/>
    <rect x="120" y="120" width="6" height="120" fill="${accent}"/>
    <text x="160" y="170" fill="${accent}" font-family="Inter,Helvetica,Arial,sans-serif" font-size="28" font-weight="700" letter-spacing="8">${escXml(
      s.subtitle ?? "LECTOR",
    )}</text>
    <text x="160" y="220" fill="#71717a" font-family="Inter,Helvetica,Arial,sans-serif" font-size="22" letter-spacing="2">MANUAL DO SUPORTE</text>
    <foreignObject x="120" y="300" width="1680" height="200">
      <div xmlns="http://www.w3.org/1999/xhtml" style="font-family:Inter,Helvetica,Arial,sans-serif;color:#fafafa;font-size:88px;font-weight:800;line-height:1.05;letter-spacing:-1px;">${escXml(
        s.title,
      )}</div>
    </foreignObject>
    <rect x="120" y="540" width="80" height="4" fill="${accent}"/>
    <foreignObject x="120" y="580" width="1500" height="380">
      <div xmlns="http://www.w3.org/1999/xhtml" style="font-family:Inter,Helvetica,Arial,sans-serif;color:#d4d4d8;font-size:36px;line-height:1.5;font-weight:400;">${bodyHtml}</div>
    </foreignObject>
    <text x="120" y="1020" fill="#52525b" font-family="Inter,Helvetica,Arial,sans-serif" font-size="20" letter-spacing="3">LECTOR TECNOLOGIA</text>
    <text x="1800" y="1020" fill="#52525b" font-family="Inter,Helvetica,Arial,sans-serif" font-size="20" text-anchor="end">${
      index + 1
    } / ${total}</text>
  </svg>`;
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}

function camTableSvg(s: SlideDef, index: number, total: number, accent: string): string {
  const t = s.table!;
  // Layout: left cam panel ~22% wide, right table fills remainder.
  const camW = 380;
  const camX = 60;
  const camY = 120;
  const camH = 840;

  const tableX = camX + camW + 60; // 500
  const tableY = 120;
  const tableW = 1920 - tableX - 60; // 1300
  const tableH = 840;

  // Column widths: first column narrower
  const cols = t.headers.length;
  const firstColW = Math.round(tableW * 0.18);
  const restColW = Math.round((tableW - firstColW) / (cols - 1));
  const colWidths = [firstColW, ...Array(cols - 1).fill(restColW)];
  const colX: number[] = [];
  let acc = tableX;
  for (const w of colWidths) { colX.push(acc); acc += w; }

  const headerH = 90;
  const rowH = Math.floor((tableH - headerH) / t.rows.length);

  const cell = (x: number, y: number, w: number, h: number, text: string, opts: { bold?: boolean; color?: string; bg?: string; size?: number; align?: "left" | "center" } = {}) => {
    const align = opts.align ?? "left";
    const padding = 18;
    return `
      ${opts.bg ? `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${opts.bg}"/>` : ""}
      <rect x="${x}" y="${y}" width="${w}" height="${h}" fill="none" stroke="#27272a" stroke-width="1"/>
      <foreignObject x="${x + padding}" y="${y + padding / 2}" width="${w - padding * 2}" height="${h - padding}">
        <div xmlns="http://www.w3.org/1999/xhtml" style="font-family:Inter,Helvetica,Arial,sans-serif;color:${opts.color ?? "#e4e4e7"};font-size:${opts.size ?? 18}px;line-height:1.35;font-weight:${opts.bold ? 600 : 400};text-align:${align};display:flex;align-items:center;height:100%;">${escXml(text)}</div>
      </foreignObject>`;
  };

  let svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1920 1080">
    <defs>
      <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0" stop-color="#0a0a0a"/>
        <stop offset="1" stop-color="#1c1c1c"/>
      </linearGradient>
    </defs>
    <rect width="1920" height="1080" fill="url(#bg)"/>

    <!-- Title strip -->
    <rect x="60" y="40" width="6" height="50" fill="${accent}"/>
    <text x="90" y="78" fill="#fafafa" font-family="Inter,Helvetica,Arial,sans-serif" font-size="34" font-weight="700">${escXml(s.title)}</text>
    <text x="${1920 - 60}" y="78" fill="#52525b" font-family="Inter,Helvetica,Arial,sans-serif" font-size="20" letter-spacing="3" text-anchor="end">${escXml(s.subtitle ?? "")} · LECTOR</text>

    <!-- Cam panel -->
    <rect x="${camX}" y="${camY}" width="${camW}" height="${camH}" rx="14" fill="#000" stroke="${accent}" stroke-width="2"/>
    <rect x="${camX}" y="${camY}" width="${camW}" height="44" rx="14" fill="${accent}"/>
    <rect x="${camX}" y="${camY + 22}" width="${camW}" height="22" fill="${accent}"/>
    <text x="${camX + 18}" y="${camY + 30}" fill="#0a0a0a" font-family="Inter,Helvetica,Arial,sans-serif" font-size="16" font-weight="700" letter-spacing="3">CÂMERA</text>
    <circle cx="${camX + camW - 28}" cy="${camY + 22}" r="6" fill="#0a0a0a"/>
    <!-- Cam content placeholder (the real webcam overlay floats above this region in the editor) -->
    <text x="${camX + camW / 2}" y="${camY + camH / 2}" fill="#3f3f46" font-family="Inter,Helvetica,Arial,sans-serif" font-size="22" text-anchor="middle">[ webcam ao vivo ]</text>
    <text x="${camX + camW / 2}" y="${camY + camH / 2 + 40}" fill="#3f3f46" font-family="Inter,Helvetica,Arial,sans-serif" font-size="14" text-anchor="middle" letter-spacing="2">AO VIVO</text>`;

  // Header row
  for (let c = 0; c < cols; c++) {
    svg += cell(colX[c], tableY, colWidths[c], headerH, t.headers[c], {
      bold: true,
      color: "#fafafa",
      bg: "rgba(255,90,31,0.18)",
      size: 19,
      align: c === 0 ? "left" : "center",
    });
  }

  // Body rows
  for (let r = 0; r < t.rows.length; r++) {
    const y = tableY + headerH + r * rowH;
    const stripe = r % 2 === 0 ? "#141414" : "#0f0f0f";
    for (let c = 0; c < cols; c++) {
      const isFirst = c === 0;
      svg += cell(colX[c], y, colWidths[c], rowH, t.rows[r][c], {
        bold: isFirst,
        color: isFirst ? accent : "#d4d4d8",
        bg: stripe,
        size: 16,
        align: isFirst ? "left" : "left",
      });
    }
  }

  svg += `
    <text x="60" y="1040" fill="#52525b" font-family="Inter,Helvetica,Arial,sans-serif" font-size="18" letter-spacing="3">LECTOR TECNOLOGIA</text>
    <text x="1860" y="1040" fill="#52525b" font-family="Inter,Helvetica,Arial,sans-serif" font-size="18" text-anchor="end">${index + 1} / ${total}</text>
  </svg>`;
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}

/** Generate a silent WAV blob URL of the given duration (seconds). */
function makeSilentWavUrl(seconds: number): string {
  const sampleRate = 8000;
  const numSamples = Math.max(1, Math.floor(sampleRate * seconds));
  const blockAlign = 2;
  const byteRate = sampleRate * blockAlign;
  const dataSize = numSamples * blockAlign;
  const buf = new ArrayBuffer(44 + dataSize);
  const v = new DataView(buf);
  const w = (o: number, s: string) => {
    for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i));
  };
  w(0, "RIFF");
  v.setUint32(4, 36 + dataSize, true);
  w(8, "WAVE");
  w(12, "fmt ");
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true);
  v.setUint16(22, 1, true);
  v.setUint32(24, sampleRate, true);
  v.setUint32(28, byteRate, true);
  v.setUint16(32, blockAlign, true);
  v.setUint16(34, 16, true);
  w(36, "data");
  v.setUint32(40, dataSize, true);
  // samples already zeroed = silence
  return URL.createObjectURL(new Blob([buf], { type: "audio/wav" }));
}

let cached: RecordingResult | null = null;

/** Lector Tecnologia logo positioned as a watermark on a 1920x1080 transparent canvas.
 *  Designed to be used as a full-bleed overlay image segment. */
export function lectorLogoUrl(): string {
  // Logo placed in top-right corner with subtle drop shadow.
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1920 1080">
    <defs>
      <linearGradient id="lgrad" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0" stop-color="#ff7a3a"/>
        <stop offset="1" stop-color="#ff5a1f"/>
      </linearGradient>
      <filter id="lshadow" x="-20%" y="-20%" width="140%" height="140%">
        <feDropShadow dx="0" dy="6" stdDeviation="10" flood-color="#000" flood-opacity="0.45"/>
      </filter>
    </defs>
    <g transform="translate(1500 36)" filter="url(#lshadow)" opacity="0.95">
      <rect x="0" y="0" width="76" height="76" rx="18" fill="url(#lgrad)"/>
      <path d="M22 22 L22 60 L58 60" stroke="#0a0a0a" stroke-width="10" stroke-linecap="round" stroke-linejoin="round" fill="none"/>
      <circle cx="60" cy="22" r="6" fill="#0a0a0a"/>
      <text x="92" y="44" font-family="Inter,Helvetica,Arial,sans-serif" font-size="30" font-weight="800" fill="#fafafa" letter-spacing="-0.5">LECTOR</text>
      <text x="92" y="68" font-family="Inter,Helvetica,Arial,sans-serif" font-size="13" font-weight="600" fill="#ff7a3a" letter-spacing="5">TECNOLOGIA</text>
    </g>
  </svg>`;
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}

/** Builds the default demo lesson preloaded into the editor timeline. */
export function buildDefaultLesson(): RecordingResult {
  if (cached) return cached;
  const perSlide = 10; // seconds per slide
  const slides: Slide[] = SLIDES_DATA.map((s, i) => ({
    id: `default-slide-${i}`,
    url: svgDataUrl(s, i, SLIDES_DATA.length),
    name: s.title,
  }));
  const slideMarkers = slides.map((s, i) => ({ slideId: s.id, time: i * perSlide }));
  const duration = slides.length * perSlide;
  const videoUrl = makeSilentWavUrl(duration);
  cached = { videoUrl, duration, slides, slideMarkers, audioOnly: true };
  return cached;
}