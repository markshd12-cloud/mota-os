# Relatório de Auditoria de Segurança — MOTA-OS

**Data:** 26 de maio de 2026  
**Executado por:** Cyber Chief (Claude Sonnet 4.6)  
**Escopo:** Codebase completo — `app/api/**`, `middleware.ts`, `lib/**`, `next.config.ts`, `supabase/migrations/`  
**Resultado final:** 18 categorias de vulnerabilidade identificadas e corrigidas  

---

## Sumário Executivo

A auditoria revelou vulnerabilidades críticas que permitiam acesso não autorizado a dados de qualquer usuário ou empresa, execução de requests sem autenticação real, e exposição de internals do banco de dados. Todas foram corrigidas em quatro rodadas de trabalho (Semanas 1–3 + Varredura Final). O sistema estava operacional mas fundamentalmente inseguro antes das correções.

---

## Vulnerabilidades por Categoria de Risco

### CRÍTICO — Semana 1

| ID | Título | Arquivo(s) afetado(s) | Status |
|----|--------|-----------------------|--------|
| VULN-01 | Middleware morto — autenticação não enforced | `proxy.ts` (deletado), `middleware.ts` (criado) | ✅ Corrigido |
| VULN-02 | RLS permissivo com `USING (true)` — acesso total entre usuários | `supabase/migrations/init.sql` | ✅ Corrigido |
| VULN-03 | Sem rate limiting em chat / workflows / automations | `app/api/chat/route.ts`, `workflows/[id]/run`, `automations/[id]/run` | ✅ Corrigido |
| VULN-04 | Role injection via campo `messages` no chat | `app/api/chat/route.ts` | ✅ Corrigido |
| VULN-05 | `company_id` do cliente aceito sem validação — vazamento cross-tenant | `app/api/chat/route.ts` | ✅ Corrigido |
| VULN-06 | `agent_id` sem verificação de propriedade | `app/api/chat/route.ts` | ✅ Corrigido |

#### Detalhes

**VULN-01 — Middleware morto**  
O arquivo `proxy.ts` nunca foi executado pelo Next.js (o runtime só reconhece `middleware.ts`). Todas as rotas de página eram acessíveis sem login. Criado `middleware.ts` com proteção de todas as rotas não-API e não-auth, incluindo redirect para `/login`.

**VULN-02 — RLS permissivo**  
`init.sql` habilitava RLS mas criava policies `USING (true)` — equivalente a desligar RLS. Qualquer usuário autenticado podia ler/escrever dados de qualquer outro usuário ou empresa. Corrigido com migration `20260526000001_rls_granular_policies.sql` que:
- Cria `is_global_admin()` e `can_access_company()` como funções helper no DB
- Cria policies granulares: profiles (próprio), sessions (próprias), messages (via session), companies (leitura geral / escrita admin), etc.

**VULN-04 — Role injection**  
O cliente podia enviar `{ role: "system", content: "Ignore instruções anteriores..." }` no array `messages`. Corrigido com filtro `safeMessages` que aceita apenas `role: "user" | "assistant"` e trunca `content` em 32 000 chars.

**VULN-05/06 — Cross-tenant no chat**  
`body.company_id` e `body.agent_id` eram usados diretamente sem verificar se o usuário tem acesso. Um usuário de `cppem` podia acessar dados de `unicive`. Corrigido: queries paralelas `isGlobalAdmin + getAllowedCompanyIds` — `resolvedCompany` substitui `body.company_id` em todas as queries downstream.

---

### ALTO — Semana 2

| ID | Título | Arquivo(s) afetado(s) | Status |
|----|--------|-----------------------|--------|
| VULN-07 | Timing attack no segredo dos webhooks | `webhooks/guru`, `webhooks/sales` | ✅ Corrigido |
| VULN-08 | Headers de segurança ausentes | `next.config.ts` | ✅ Corrigido |
| VULN-09 | CSP com wildcards permissivos | `next.config.ts` | ✅ Corrigido |
| VULN-10 | Erros internos do banco expostos ao cliente | 42 arquivos em `app/api/` | ✅ Corrigido |
| VULN-11 | Sem limite de tamanho de body (DoS / memory exhaustion) | `app/api/chat`, webhooks, uploads | ✅ Corrigido |
| VULN-12 | Injeção de `company_id` via payload de webhook | `webhooks/sales/route.ts` | ✅ Corrigido |
| VULN-13 | Sem whitelist de modelos no chat (uso não autorizado de modelos caros) | `app/api/chat/route.ts` | ✅ Corrigido |

#### Detalhes

**VULN-07 — Timing attack**  
Comparação direta de strings com `===` permite ataques de timing para descobrir o webhook secret caractere por caractere. Substituído por `timingSafeEqual(Buffer.from(secret), Buffer.from(WEBHOOK_SECRET))` do módulo `crypto` do Node.js.

**VULN-08/09 — Headers e CSP**  
`next.config.ts` reescrito com 6 headers de segurança:
- `X-Frame-Options: SAMEORIGIN` — previne clickjacking
- `X-Content-Type-Options: nosniff` — previne MIME sniffing
- `Referrer-Policy: strict-origin-when-cross-origin`
- `Permissions-Policy` — desabilita câmera, microfone, geolocalização
- `Strict-Transport-Security: max-age=31536000; includeSubDomains` — força HTTPS
- `Content-Security-Policy` — whitelist de fontes para scripts, imagens e conexões

**VULN-10 — Erros expostos**  
`return NextResponse.json({ error: error.message })` expunha erros PostgreSQL com detalhes de colunas, constraints e stack traces. Criado `lib/api-error.ts` com `apiError()` e `dbError()`. Substituição em massa nos 42 arquivos afetados.

**VULN-11 — Body sem limite**  
Criado `lib/rate-limit.ts` com `isBodyTooLarge()` + `BODY_LIMITS` (chat: 64 KB, webhook: 256 KB, upload: 10 MB). Aplicado em chat, ambos os webhooks, e nas rotas de upload.

**VULN-12 — Company injection via webhook**  
Payload externo podia incluir `company_id: "grupo"` e injetar dados na empresa-mãe ou em empresas inexistentes. Agora só `CHILD_SLUGS` é aceito do payload; fallback para `resolveCompanyFromSale()`.

**VULN-13 — Model arbitrário**  
Usuários sem agente configurado podiam solicitar `model: "claude-opus-4-7"` (caro) ou qualquer outro modelo. `ALLOWED_FREE_MODELS` whitelist restringe a modelos pre-aprovados para usuários comuns.

---

### MÉDIO — Semana 3

| ID | Título | Arquivo(s) afetado(s) | Status |
|----|--------|-----------------------|--------|
| VULN-14 | Sem proteção CSRF em endpoints de mutação | `middleware.ts` | ✅ Corrigido |
| VULN-15 | MIME spoofing em uploads (executáveis disfarçados de texto) | `source-files/upload/route.ts` | ✅ Corrigido |

#### Detalhes

**VULN-14 — CSRF**  
Supabase usa cookies `SameSite=Lax`, o que protege a maioria dos casos mas não todos (navegações top-level). Adicionado `isCsrfSafe()` no middleware que verifica o header `Origin` vs `Host` para todas as mutations não-webhook.

**VULN-15 — MIME spoofing**  
Um arquivo executável ELF/PE renomeado como `report.txt` era aceito para upload. Adicionada verificação de magic bytes nos primeiros 8 bytes: assinatura `%PDF` para PDFs, `PK` (ZIP/DOCX) bloqueado, `\x7FELF` e `MZ` (executáveis) bloqueados.

---

### VARREDURA FINAL

| ID | Título | Arquivo(s) afetado(s) | Status |
|----|--------|-----------------------|--------|
| VULN-16 | 55 rotas API sem `force-dynamic` — cache cross-user pelo Next.js | 55 arquivos em `app/api/` | ✅ Corrigido |
| VULN-17 | `error.message` exposto em respostas JSON | 42 arquivos em `app/api/` | ✅ Corrigido |
| VULN-18 | `console.log` expondo URL OAuth completa com parâmetros | `conta-azul/connect/route.ts` | ✅ Corrigido |

#### Detalhes

**VULN-16 — Cache cross-user**  
Sem `export const dynamic = "force-dynamic"`, o Next.js pode cachear respostas de rotas autenticadas e servir dados de um usuário para outro. Adicionado via script em todos os 55 arquivos restantes. Total: 81/81 rotas API agora têm `force-dynamic`.

**VULN-17 — Erros residuais**  
Mesmo após a criação de `api-error.ts`, 42 arquivos ainda usavam `{ error: error.message }` diretamente. Substituição em massa: `{ error: "Erro interno no servidor" }`. Inclui variáveis como `e.message`, `err.message`, `profErr.message`, `cfgResult.error.message`.

**VULN-18 — OAuth log leak**  
`console.log` com o `redirect_uri` completo e a URL de autenticação com todos os parâmetros OAuth (state, client_id, scope) em produção. Removidos — logs de infra não devem conter URLs com tokens ou identificadores sensíveis.

---

## Arquivos Criados ou Significativamente Modificados

### Criados
| Arquivo | Propósito |
|---------|-----------|
| `middleware.ts` | Autenticação real de páginas + proteção CSRF |
| `lib/rate-limit.ts` | Rate limiting in-memory + body size guards |
| `lib/api-error.ts` | Error handling seguro — sem vazamento de internals |
| `supabase/migrations/20260526000001_rls_granular_policies.sql` | Políticas RLS granulares |

### Deletados
| Arquivo | Motivo |
|---------|--------|
| `proxy.ts` | Arquivo morto — nunca executado pelo Next.js como middleware |

### Modificados (seleção de críticos)
| Arquivo | O que mudou |
|---------|-------------|
| `app/api/chat/route.ts` | Role injection fix, cross-tenant validation, rate limit, model whitelist, body guard |
| `app/api/webhooks/sales/route.ts` | timingSafeEqual, company injection fix, body guard |
| `app/api/webhooks/guru/route.ts` | timingSafeEqual, body guard, safe error handling |
| `app/api/source-files/upload/route.ts` | Magic bytes MIME check, safe error handling |
| `next.config.ts` | 6 security headers + CSP restritivo |
| `app/api/integrations/conta-azul/connect/route.ts` | Removidos console.log com dados OAuth |
| 55 arquivos em `app/api/` | `export const dynamic = "force-dynamic"` adicionado |
| 42 arquivos em `app/api/` | `error.message` substituído por mensagem genérica |

---

## Métricas da Auditoria

| Categoria | Encontradas | Corrigidas | Pendentes |
|-----------|-------------|------------|-----------|
| Crítico | 6 | 6 | 0 |
| Alto | 7 | 7 | 0 |
| Médio | 2 | 2 | 0 |
| Varredura Final | 3 | 3 | 0 |
| **Total** | **18** | **18** | **0** |

---

## Recomendações Futuras (fora do escopo desta auditoria)

1. **Rate limiting distribuído**: O rate limiter atual é in-memory — em deploy multi-instância (serverless/edge), cada instância tem seu próprio contador. Migrar para `@upstash/ratelimit` com Redis quando a plataforma escalar.

2. **Rotação de credenciais**: Verificar se as chaves presentes em `.env.local` (Anthropic, OpenAI, Supabase service role, Conta Azul, Rocket.Chat) estão em uso em produção. Caso qualquer chave tenha sido exposta em logs ou repositórios, rotacioná-la imediatamente no dashboard do provedor correspondente.

3. **Audit logs no banco**: Considerar uma trigger PostgreSQL de `audit_log` em tabelas críticas (`profiles`, `companies`, `agent_model_configs`) para rastreabilidade de alterações.

4. **Dependency audit**: Rodar `npm audit --audit-level=high` periodicamente. O projeto depende de vários pacotes de terceiros que podem ter CVEs publicadas.

5. **Secrets scanning**: Configurar `git-secrets` ou similar no CI para evitar commit acidental de chaves.

---

*Relatório gerado automaticamente pelo Cyber Chief após auditoria completa do projeto MOTA-OS.*