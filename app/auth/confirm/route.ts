import { type EmailOtpType } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase-server";
import { NextResponse } from "next/server";



export async function GET(request: Request) {
  const url = new URL(request.url);
  const origin = url.origin;

  const token_hash = url.searchParams.get("token_hash");
  const type = url.searchParams.get("type") as EmailOtpType | null;
  const next = url.searchParams.get("next") ?? "/reset-password";

  if (!token_hash || !type) {
    const loginUrl = new URL("/login", origin);
    loginUrl.searchParams.set("error", "confirm_sem_token");
    return NextResponse.redirect(loginUrl);
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.verifyOtp({ type, token_hash });

  if (error) {
    console.error("[auth/confirm] verifyOtp error:", error.message);
    const loginUrl = new URL("/login", origin);
    loginUrl.searchParams.set("error", error.message);
    return NextResponse.redirect(loginUrl);
  }

  return NextResponse.redirect(new URL(next, origin));
}
