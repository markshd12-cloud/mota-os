// TODO: substituir por consulta ao Supabase — tabelas: messages, sessions

export type BlockKind =
  | "text"
  | "card"
  | "checklist"
  | "actions"
  | "tags"
  | "divider"

export interface TextBlock     { kind: "text";      content: string }
export interface CardBlock     { kind: "card";      title: string; badge?: string; rows: { label: string; value: string; highlight?: boolean }[] }
export interface ChecklistBlock{ kind: "checklist"; title?: string; items: { id: string; text: string; done?: boolean }[] }
export interface ActionsBlock  { kind: "actions";   items: { label: string; variant: "primary" | "ghost" | "danger" }[] }
export interface TagsBlock     { kind: "tags";      label: string; items: string[] }
export interface DividerBlock  { kind: "divider" }

export type MessageBlock =
  | TextBlock | CardBlock | ChecklistBlock
  | ActionsBlock | TagsBlock | DividerBlock

export interface Message {
  id: string
  role: "user" | "assistant"
  content: MessageBlock[]
  agentName?:        string
  agentColor?:       string
  timestamp:         string
  slashCommand?:     string   // ex: "copy"
  slashAgentLabel?:  string   // ex: "Copywriter"
  // Metadata de IA
  modelUsed?:        string   // ex: "claude-sonnet-4-6"
  providerUsed?:     string   // ex: "anthropic"
  aiMode?:           string   // ex: "claude" | "jarvis"
  routedByJarvis?:   boolean
  // Regeneração
  regeneratedFrom?:  string   // assistant_message_id original
  // Anexos
  attachmentIds?:    string[]
}

// ── Sessão s1: Criar campanha Intensivão PMPE ─────────────────────────────

const s1: Message[] = [
  {
    id: "m1",
    role: "user",
    timestamp: "09:14",
    content: [
      { kind: "text", content: "Preciso criar uma campanha de geração de leads para o Intensivão PMPE 2026. Budget semanal de R$ 3.000, público em Pernambuco, objetivo: capturar leads para WhatsApp. Período: 4 semanas antes da prova." },
    ],
  },
  {
    id: "m2",
    role: "assistant",
    agentName: "Marketing",
    agentColor: "#16a34a",
    timestamp: "09:14",
    content: [
      { kind: "text", content: "Estruturei a campanha completa para o Intensivão PMPE 2026. Veja o plano abaixo:" },
      {
        kind: "card",
        title: "Estrutura da Campanha",
        badge: "Meta Ads",
        rows: [
          { label: "Objetivo",           value: "Geração de Leads (Lead Gen)",      highlight: true },
          { label: "Orçamento semanal",  value: "R$ 3.000 → R$ 2.100 Meta + R$ 900 Google" },
          { label: "Período",            value: "4 semanas (28 dias)" },
          { label: "CPL estimado",       value: "R$ 2,80 – R$ 4,50"                 },
          { label: "Volume estimado",    value: "660 – 1.070 leads"                 },
          { label: "Público principal",  value: "Homens 20-35 anos, PE, interesse em concurso policial" },
          { label: "Público LAL",        value: "Lookalike 2% e 5% da base CPPEM"  },
        ],
      },
      {
        kind: "checklist",
        title: "Próximos passos",
        items: [
          { id: "c1", text: "Criar públicos personalizados no Meta Ads (LAL 2%, 5% e retargeting)" },
          { id: "c2", text: "Desenvolver 3 variações de criativo (1 vídeo + 2 imagens)" },
          { id: "c3", text: "Configurar pixel Meta na landing page de captura" },
          { id: "c4", text: "Criar landing page ou ativar lead form nativo" },
          { id: "c5", text: "Configurar automação de boas-vindas no WhatsApp" },
          { id: "c6", text: "Definir KPIs de corte: pausar anúncio com CPL > R$ 6,00" },
        ],
      },
      {
        kind: "actions",
        items: [
          { label: "Aprovar estrutura",   variant: "primary" },
          { label: "Ajustar parâmetros",  variant: "ghost" },
          { label: "Gerar briefing",       variant: "ghost" },
        ],
      },
    ],
  },
  {
    id: "m3",
    role: "user",
    timestamp: "09:21",
    content: [
      { kind: "text", content: "Aprovado. Agora gere o briefing completo para o designer criar os criativos. Tenho disponível 1 vídeo (30s) e posso fazer 2 imagens." },
    ],
  },
  {
    id: "m4",
    role: "assistant",
    agentName: "Marketing",
    agentColor: "#16a34a",
    timestamp: "09:21",
    content: [
      { kind: "text", content: "Briefing completo para o designer. Encaminhe exatamente como está:" },
      {
        kind: "card",
        title: "Briefing de Criativos — Intensivão PMPE 2026",
        rows: [
          { label: "Produto",     value: "Intensivão PMPE 2026 — CPPEM Concursos"           },
          { label: "Objetivo",    value: "Gerar leads para WhatsApp",  highlight: true       },
          { label: "Formato 1",   value: "Vídeo 30s (9:16) — Reels/Stories"                 },
          { label: "Formato 2",   value: "Imagem estática 1080×1080 — Feed"                 },
          { label: "Formato 3",   value: "Imagem 1080×1920 — Story/Reels cover"             },
          { label: "Tom",         value: "Urgência + autoridade. Direto, imperativo"        },
          { label: "CTA",         value: "\"Garantir minha vaga\" → link WA"                },
          { label: "Prazo",       value: "48h para versões para aprovação"                  },
        ],
      },
      {
        kind: "checklist",
        title: "Elementos obrigatórios em todos os criativos",
        items: [
          { id: "b1", text: "Logo CPPEM no canto superior ou inferior" },
          { id: "b2", text: "Data/período do intensivão em destaque" },
          { id: "b3", text: "CTA visível: botão ou texto com \"Garantir minha vaga\"" },
          { id: "b4", text: "Referência à banca (CESPE/CEBRASPE) se confirmada" },
          { id: "b5", text: "Cores: verde escuro + branco (identidade CPPEM)" },
        ],
      },
      {
        kind: "tags",
        label: "Formatos necessários",
        items: ["1080×1080 Feed", "1080×1920 Story", "1200×628 Link", "9:16 Reels 30s"],
      },
      {
        kind: "actions",
        items: [
          { label: "Salvar como tarefa",    variant: "primary" },
          { label: "Enviar ao Rocket.Chat", variant: "ghost"   },
          { label: "Exportar PDF",          variant: "ghost"   },
        ],
      },
    ],
  },
]

// ── Sessão s2: Otimizar funil Unicive ────────────────────────────────────

const s2: Message[] = [
  {
    id: "m1",
    role: "user",
    timestamp: "08:30",
    content: [
      { kind: "text", content: "O CPL do funil da Unicive EAD está em R$ 28. Meta é R$ 18. Campanha no Meta Ads, público nacional, oferta: tecnólogo em análise e desenvolvimento de sistemas." },
    ],
  },
  {
    id: "m2",
    role: "assistant",
    agentName: "Tráfego Pago",
    agentColor: "#3b82f6",
    timestamp: "08:31",
    content: [
      { kind: "text", content: "Analisei o cenário. Com CPL R$ 28 e meta R$ 18, o gap é de 55%. As principais causas prováveis são:" },
      {
        kind: "card",
        title: "Diagnóstico do Funil",
        rows: [
          { label: "CPL atual",       value: "R$ 28,00",              highlight: true  },
          { label: "CPL meta",        value: "R$ 18,00"                                },
          { label: "Gap",             value: "−R$ 10,00 (−55%)",      highlight: true  },
          { label: "Causa #1",        value: "Público muito amplo — baixa qualificação" },
          { label: "Causa #2",        value: "Criativo com baixo CTR (< 1,2%)"         },
          { label: "Causa #3",        value: "Landing page sem prova social suficiente" },
        ],
      },
      {
        kind: "checklist",
        title: "Ações de otimização (em ordem de impacto)",
        items: [
          { id: "o1", text: "Segmentar por interesse em EAD + cursos de tecnologia (reduz público em 40%)" },
          { id: "o2", text: "Testar criativo com depoimento de aluno formado (CTR tende a subir 30-60%)" },
          { id: "o3", text: "Adicionar contador de vagas / urgência na landing page" },
          { id: "o4", text: "Criar campanha separada para retargeting (CPL cai 40-60%)" },
          { id: "o5", text: "Excluir público que já converteu nos últimos 180 dias" },
        ],
      },
      {
        kind: "actions",
        items: [
          { label: "Gerar plano detalhado", variant: "primary" },
          { label: "Ver mais métricas",     variant: "ghost"   },
        ],
      },
    ],
  },
]

// ── Sessão s3: Organizar tarefas ─────────────────────────────────────────

const s3: Message[] = [
  {
    id: "m1",
    role: "user",
    timestamp: "07:45",
    content: [
      { kind: "text", content: "Me ajuda a organizar as tarefas do time de marketing para esta semana. Temos: lançamento PMPE, captação Unicive, conteúdo colégio e relatório semanal." },
    ],
  },
  {
    id: "m2",
    role: "assistant",
    agentName: "Gestão",
    agentColor: "#06b6d4",
    timestamp: "07:46",
    content: [
      { kind: "text", content: "Organizei as tarefas por prioridade e responsável. Aqui está o plano da semana:" },
      {
        kind: "card",
        title: "Semana 19 — Prioridades do Time de Marketing",
        rows: [
          { label: "🔴 Alta",   value: "Criativos PMPE (prazo: amanhã)",              highlight: true },
          { label: "🔴 Alta",   value: "Subir campanha Meta Ads PMPE (Qui)"                          },
          { label: "🟡 Média",  value: "Calendário Unicive Junho (até Sex)"                          },
          { label: "🟡 Média",  value: "Relatório semanal (toda Sex 12h)"                            },
          { label: "🟢 Normal", value: "Conteúdo Colégio CPPEM — 3 posts"                            },
        ],
      },
      {
        kind: "checklist",
        title: "Tarefas da semana",
        items: [
          { id: "t1", text: "[Alexandre] Aprovar briefing de criativos PMPE" },
          { id: "t2", text: "[Designer] Criar 3 criativos Intensivão PMPE" },
          { id: "t3", text: "[Gestor Tráfego] Subir campanha Meta Ads — Qui 10h" },
          { id: "t4", text: "[Social Media] Calendário Unicive Junho — 20 posts" },
          { id: "t5", text: "[Alexandre] Relatório semanal — Sex 12h" },
          { id: "t6", text: "[Social Media] 3 posts feed Colégio CPPEM" },
        ],
      },
      {
        kind: "actions",
        items: [
          { label: "Salvar como tarefas", variant: "primary" },
          { label: "Enviar ao Rocket.Chat", variant: "ghost" },
        ],
      },
    ],
  },
]

export const mockMessages: Record<string, Message[]> = {
  s1: s1,
  s2: s2,
  s3: s3,
  s4: [],
  s5: [],
  s6: [],
  s7: [],
  s8: [],
  s9: [],
  s10: [],
}

// ── Mock AI responses para novas mensagens do usuário ────────────────────

export const aiResponses: Record<string, MessageBlock[]> = {
  marketing: [
    { kind: "text", content: "Entendido! Vou estruturar isso com base no histórico de campanhas do Grupo Mota." },
    { kind: "card", title: "Análise Rápida", rows: [
      { label: "Status",    value: "Processando contexto da marca",  highlight: true },
      { label: "Fonte",     value: "Base de conhecimento CPPEM"                     },
      { label: "Modelo",    value: "Marketing estratégico + dados históricos"       },
    ]},
    { kind: "actions", items: [
      { label: "Ver detalhes completos", variant: "primary" },
      { label: "Ajustar parâmetros",     variant: "ghost"   },
    ]},
  ],
  traffic: [
    { kind: "text", content: "Analisando as métricas da campanha. Com base nos dados históricos do Grupo Mota:" },
    { kind: "card", title: "Métricas Identificadas", rows: [
      { label: "CPL médio histórico", value: "R$ 3,80",     highlight: true },
      { label: "Melhor período",      value: "Seg–Qua, 18h–22h"             },
      { label: "Melhor criativo",     value: "Vídeo depoimento (CTR 3.2%)"  },
    ]},
    { kind: "actions", items: [
      { label: "Gerar relatório completo", variant: "primary" },
      { label: "Comparar períodos",        variant: "ghost"   },
    ]},
  ],
  management: [
    { kind: "text", content: "Organizando as informações para você. Aqui está o resumo:" },
    { kind: "checklist", title: "Itens identificados", items: [
      { id: "r1", text: "Prioridade definida por urgência e impacto" },
      { id: "r2", text: "Responsáveis atribuídos conforme perfil do time" },
      { id: "r3", text: "Prazos calculados com base na semana atual" },
    ]},
    { kind: "actions", items: [
      { label: "Salvar tarefas", variant: "primary" },
      { label: "Ajustar",        variant: "ghost"   },
    ]},
  ],
  default: [
    { kind: "text", content: "Recebi sua mensagem. Estou processando com base no contexto da sessão e nas fontes conectadas." },
    { kind: "actions", items: [
      { label: "Continuar",  variant: "primary" },
      { label: "Ver fontes", variant: "ghost"   },
    ]},
  ],
}
