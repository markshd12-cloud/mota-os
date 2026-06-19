import { createClient } from "@/lib/supabase-server";
import { NextResponse } from "next/server";

export async function GET(request: Request) {
  console.log("====================================");
  console.log("AUTH CALLBACK EXECUTOU");
  console.log("URL:", request.url);
  console.log("====================================");

  try {
    const url = new URL(request.url);
    const origin = url.origin;

    const code = url.searchParams.get("code");
    const type = url.searchParams.get("type");
    const next = url.searchParams.get("next") ?? "/chat";

    console.log("code:", code);
    console.log("type:", type);
    console.log("next:", next);

    if (code) {
      console.log("Executando exchangeCodeForSession");

      const supabase = await createClient();

      const { error } = await supabase.auth.exchangeCodeForSession(code);

      if (error) {
        console.error("exchangeCodeForSession error:", error);

        const loginUrl = new URL("/login", origin);
        loginUrl.searchParams.set("error", error.message);

        return NextResponse.redirect(loginUrl);
      }

      console.log("exchangeCodeForSession OK");

      if (type === "recovery") {
        return NextResponse.redirect(new URL("/reset-password", origin));
      }

      return NextResponse.redirect(new URL(next, origin));
    }

    console.warn("Nenhum code encontrado na URL");

    const loginUrl = new URL("/login", origin);
    loginUrl.searchParams.set("error", "callback_sem_code");

    return NextResponse.redirect(loginUrl);
  } catch (err) {
    console.error("Callback fatal error:", err);

    return NextResponse.redirect(
      new URL("/login?error=callback_error", request.url),
    );
  }
}
