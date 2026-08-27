import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";

export async function DELETE(req, { params }) {
  const { id } = params;
  const { error } = await supabase
    .from("core_item")
    .update({ is_active: false })
    .eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
