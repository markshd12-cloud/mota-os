import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase-server";
import { createAdminClient } from "@/lib/supabase-admin";
import { isGlobalAdmin, getAllowedCompanyIds } from "@/lib/company-scope";
import { logActivity } from "@/lib/activity-logger";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user)
    return NextResponse.json({ error: "Não autorizado" }, { status: 401 });

  const isAdmin = await isGlobalAdmin(user.id);
  const { searchParams } = new URL(req.url);
  const companyFilter = searchParams.get("company_id");
  const search = searchParams.get("search")?.trim();

  const admin = createAdminClient();

  if (!isAdmin) {
    if (!companyFilter) {
      return NextResponse.json(
        { error: "Sem permissão para listar todos os usuários" },
        { status: 403 },
      );
    }
    const allowed = await getAllowedCompanyIds(user.id);
    if (!(allowed as string[]).includes(companyFilter)) {
      return NextResponse.json(
        { error: "Sem acesso a esta empresa" },
        { status: 403 },
      );
    }
  }

  let profileQuery = admin
    .from("profiles")
    .select(
      "id, name, email, role, job_title, department, default_company_id, avatar_url, created_at, updated_at",
    )
    .order("name", { ascending: true });

  if (search) {
    profileQuery = profileQuery.or(
      `name.ilike.%${search}%,email.ilike.%${search}%`,
    );
  }

  const { data: profiles, error: profErr } = await profileQuery;
  if (profErr)
    return NextResponse.json(
      { error: "Erro interno no servidor" },
      { status: 500 },
    );

  const { data: members } = await admin
    .from("company_members")
    .select("user_id, company_id, role, status")
    .eq("status", "active");

  const memberMap: Record<
    string,
    Array<{ company_id: string; role: string }>
  > = {};
  for (const m of members ?? []) {
    const uid = m.user_id as string;
    if (!memberMap[uid]) memberMap[uid] = [];
    memberMap[uid].push({
      company_id: m.company_id as string,
      role: (m.role as string) ?? "member",
    });
  }

  let users = (profiles ?? []).map(p => ({
    ...p,
    companies: (memberMap[p.id as string] ?? []).map(m => m.company_id),
    company_roles: Object.fromEntries(
      (memberMap[p.id as string] ?? []).map(m => [m.company_id, m.role]),
    ),
  }));

  if (companyFilter) {
    users = users.filter(u => u.companies.includes(companyFilter));
  }

  return NextResponse.json({ users });
}
export async function POST(req: NextRequest) {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user)
      return NextResponse.json({ error: "Não autorizado" }, { status: 401 });

    const isAdmin = await isGlobalAdmin(user.id);
    if (!isAdmin) {
      return NextResponse.json(
        { error: "Sem permissão para criar usuários" },
        { status: 403 },
      );
    }

    const formData = await req.formData();
    const name = formData.get("name") as string | null;
    const email = formData.get("email") as string | null;
    const companyId = formData.get("company_id") as string | null;
    const avatarFile = formData.get("avatar") as File | null;

    // Validações
    if (!name?.trim()) {
      return NextResponse.json(
        { error: "Nome é obrigatório" },
        { status: 400 },
      );
    }
    if (!email?.trim()) {
      return NextResponse.json(
        { error: "Email é obrigatório" },
        { status: 400 },
      );
    }
    if (!companyId?.trim()) {
      return NextResponse.json(
        { error: "Empresa é obrigatória" },
        { status: 400 },
      );
    }

    const admin = createAdminClient();

    const origin = req.headers.get("origin")
      ?? process.env.NEXT_PUBLIC_APP_URL
      ?? ""

    // Convida o usuário por e-mail — sem senha temporária, sem envio manual.
    // O Supabase envia o e-mail de convite via SMTP configurado.
    const { data: authData, error: authError } =
      await admin.auth.admin.inviteUserByEmail(
        email.toLowerCase().trim(),
        {
          data: { name: name.trim() },
          redirectTo: `${origin}/reset-password`,
        },
      )

    if (authError || !authData?.user) {
      return NextResponse.json(
        { error: authError?.message || "Erro ao convidar usuário" },
        { status: 400 },
      );
    }

    const newUserId = authData.user.id;
    let avatarUrl: string | null = null;

    // Upload de avatar se fornecido
    if (avatarFile && avatarFile.size > 0) {
      try {
        const buffer = await avatarFile.arrayBuffer();
        const filename = `${newUserId}-${Date.now()}`;
        const { data: uploadData, error: uploadError } = await admin.storage
          .from("avatars")
          .upload(filename, buffer, {
            contentType: avatarFile.type,
            upsert: true,
          });

        if (!uploadError && uploadData) {
          const { data: publicUrl } = admin.storage
            .from("avatars")
            .getPublicUrl(filename);
          avatarUrl = publicUrl.publicUrl;
        }
      } catch (uploadErr) {
        // Log do erro, mas não bloqueia a criação do usuário
        console.error("Erro ao fazer upload de avatar:", uploadErr);
      }
    }

    // Cria/atualiza perfil. Sem ignoreDuplicates para sobrescrever dados
    // gerados por trigger com nome e empresa corretos.
    const baseProfile: Record<string, unknown> = {
      id: newUserId,
      email: email.toLowerCase().trim(),
      name: name.trim(),
      avatar_url: avatarUrl,
      role: "viewer",
      default_company_id: companyId,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

    let { error: profileError } = await admin
      .from("profiles")
      .upsert({ ...baseProfile, must_change_password: false }, { onConflict: "id" });

    // Fallback: coluna must_change_password ainda não existe (migration
    // 20260605000002_profiles_security não aplicada ou schema cache desatualizado)
    if (
      profileError &&
      (profileError.message.includes("must_change_password") ||
        profileError.message.includes("schema cache"))
    ) {
      ({ error: profileError } = await admin
        .from("profiles")
        .upsert(baseProfile, { onConflict: "id" }));
    }

    if (profileError) {
      // Se falhar, deletar usuário de auth
      await admin.auth.admin.deleteUser(newUserId);
      return NextResponse.json(
        { error: `Erro ao criar perfil do usuário: ${profileError.message}` },
        { status: 500 },
      );
    }

    // Vincular usuário à empresa em company_members
    const { error: memberError } = await admin.from("company_members").upsert(
      {
        user_id: newUserId,
        company_id: companyId,
        role: "member",
        status: "active",
      },
      {
        onConflict: "company_id,user_id",
        ignoreDuplicates: true,
      },
    );

    if (memberError) {
      // Se falhar, deletar usuário de auth e profile
      await admin.auth.admin.deleteUser(newUserId);
      await admin.from("profiles").delete().eq("id", newUserId);
      return NextResponse.json(
        { error: `Erro ao vincular usuário à empresa: ${memberError.message}` },
        { status: 500 },
      );
    }

    void logActivity({
      userId: user.id,
      eventType: "settings",
      action: "create",
      detail: `Convite enviado para: ${email}`,
      metadata: {
        entity: "user",
        entityId: newUserId,
        invite_flow: true,
      },
    });

    return NextResponse.json({
      user: {
        id: newUserId,
        email: email.toLowerCase().trim(),
        name: name.trim(),
        created_at: new Date().toISOString(),
        last_sign_in_at: null,
      },
      message: `Convite enviado para ${email}. O usuário receberá um e-mail para definir sua senha.`,
    });
  } catch (err) {
    console.error("Erro ao criar usuário:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Erro ao criar usuário" },
      { status: 500 },
    );
  }
}
