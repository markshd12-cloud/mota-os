# Convite de usuários por e-mail

A página **Admin → Gestão de Usuários** (`/admin/users`) permite ao admin global
convidar funcionários por e-mail. O fluxo usa o `inviteUserByEmail` do Supabase Auth
(rota `POST /api/users`), que envia automaticamente um e-mail com link para o usuário
definir a própria senha.

## Como funciona

1. Admin clica em **"Convidar usuário"**, informa nome, e-mail e empresa padrão.
2. O backend chama `supabase.auth.admin.inviteUserByEmail()` com `redirectTo` para `/reset-password`.
3. O Supabase envia o e-mail de convite (template **"Invite user"**).
4. O usuário clica no link, define a senha e é redirecionado para o sistema.
5. O perfil é criado em `profiles` (role `viewer`) e vinculado em `company_members` (role `member`).

## Pré-requisitos no Supabase Dashboard

### 1. SMTP configurado
O envio de e-mails depende de um SMTP próprio em produção
(**Project Settings → Auth → SMTP Settings**). Sem SMTP customizado, o Supabase
limita drasticamente o número de e-mails e pode não entregar em produção.

### 2. Template de e-mail de convite
Em **Authentication → Email Templates → "Invite user"**, personalize com o branding do Jarvis:

**Subject:**
```
Você foi convidado para o Jarvis — Grupo Mota Educação
```

**Body (HTML):**
```html
<h2>Bem-vindo ao Jarvis</h2>
<p>Você foi convidado para acessar o sistema operacional de IA do Grupo Mota Educação.</p>
<p>Clique no botão abaixo para definir sua senha e acessar:</p>
<p>
  <a href="{{ .ConfirmationURL }}"
     style="background:#16a34a;color:#fff;padding:12px 24px;border-radius:8px;text-decoration:none;display:inline-block;">
    Definir minha senha
  </a>
</p>
<p style="color:#888;font-size:12px;">Se você não esperava este convite, ignore este e-mail.</p>
```

### 3. Redirect URLs permitidas
Em **Authentication → URL Configuration → Redirect URLs**, garanta que a URL de produção
com `/reset-password` esteja na allowlist (ex.: `https://seu-dominio.com/reset-password`).

## Variáveis de ambiente relevantes

- `NEXT_PUBLIC_APP_URL` — usada como fallback de `origin` ao montar o `redirectTo` do convite.
- `SUPABASE_SERVICE_ROLE_KEY` — necessária no servidor para o `admin.auth.admin.inviteUserByEmail`.
