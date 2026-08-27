# Full-Stack Toy — Next.js + Supabase (Stack B)

A free, permanent, full-stack web app:

```
[ Browser ]
    │  email/password login (Supabase Auth)
    ▼
Vercel  ── Next.js (App Router, React) UI + client-side data layer
    │  @supabase/supabase-js (publishable key + user session JWT)
    ▼
Supabase ── Postgres  +  Row Level Security  +  Realtime  +  Auth
```

No Render, no Django, no cold starts. Total cost: **$0**.

---

## 0. How we got here (context)

The original plan was **Vercel + Render + Supabase** with a Django backend and a Vite/React
frontend. We built both, then pivoted to **Stack B: Next.js + Supabase**, which lets Next.js
serve both UI and API (route handlers / client data layer) and uses Supabase for DB + Auth +
Realtime — retiring the Django/Render backend entirely.

The user's *original* application was **LACMTA CCS GUI** (LA Metro Central Control System) — a
traditional Django 4.2 monolith (server-rendered HTML templates, Django Channels, Redis, OIDC,
ModSecurity). We mined its **architecture bones** (not its Metro domain logic) to inform this toy:

| LACMTA concept | Toy translation (Next.js + Supabase) |
|---|---|
| `reg_dtime` / `upd_dtime` / `use_yn` audit + soft-delete | `created_at` / `updated_at` (trigger) / `is_active` columns |
| Channels + Redis (WebSockets) | Supabase Realtime (Postgres changes) |
| `AUTHENTICATION_BACKENDS` (OIDC) | Supabase Auth + Row Level Security |
| Structured JSON logging | Vercel log capture + consistent logging |
| Config via INI + Fernet | Vercel env vars + `.env.local` (secrets server-only) |
| ModSecurity / nginx / Docker | Dropped (managed PaaS takes care of it) |

**Do NOT migrate from LACMTA:** Metro domain models, OIDC endpoints, `managed=False` tables,
`search_path="afc_main"`, ModSecurity/nginx/Docker, `DEBUG_TOOLBAR`, hardcoded secrets.

---

## 1. Accounts / prerequisites

- **GitHub** account (repo: `sam79083/myapp-frontend`, public)
- **Supabase** project (ref `sgkfmmemqgbvvwrpxeix`, region `ap-southeast-1`)
- **Vercel** account (project: `myapp-frontend`)

Database connection string (for admin/SQL work only — never from the app):
```
postgresql://postgres.sgkfmmemqgbvvwrpxeix:%40<DB_PASSWORD>@aws-0-ap-southeast-1.pooler.supabase.com:5432/postgres
```
> ⚠️ The password contains a literal `@`, so it must be URL-encoded as `%40` in any URL.

Supabase keys (Project Settings → API):
- **Publishable key** (`sb_publishable_...`) → browser-safe, goes in `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- **Secret key** (`sb_secret_...`) → server-only, full DB access; no longer used by the app but kept for admin

---

## 2. Final project structure (`frontend/`)

```
frontend/
├── app/
│   ├── layout.js
│   ├── page.js                # auth + item CRUD + realtime (client component)
│   └── globals.css
├── lib/
│   └── supabaseClient.js      # browser Supabase client (publishable key)
├── public/  (static assets)
├── .env.example
├── .env.local                 # local only (gitignored) — holds real keys
├── vercel.json                # framework=nextjs, build=next build, output=.next
├── package.json               # next 14.2.x, react 18, @supabase/supabase-js
└── jsconfig.json
```

`lib/supabaseClient.js`:
```js
import { createClient } from "@supabase/supabase-js";

export const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
);
```

---

## 3. Database setup (Supabase)

### 3.1 Create the table (clean version — don't rely on Django defaults)

> Django's `auto_now_add` sets `created_at` only at the **ORM (Python) level**, NOT as a DB
> `DEFAULT`. Any non-Django writer (Supabase API) would insert `NULL` and fail with `23502`.
> Define explicit DB defaults instead.

```sql
CREATE TABLE public.core_item (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  title       text NOT NULL,
  description text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  is_active   boolean     NOT NULL DEFAULT true,
  user_id     uuid
);

-- keep updated_at fresh on every UPDATE
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS trigger AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_core_item_updated ON public.core_item;
CREATE TRIGGER trg_core_item_updated
  BEFORE UPDATE ON public.core_item
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
```

### 3.2 Row Level Security (per-user)

```sql
ALTER TABLE public.core_item ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "anon read" ON public.core_item;
CREATE POLICY "owner select" ON public.core_item FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "owner insert" ON public.core_item FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "owner update" ON public.core_item
  FOR UPDATE USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "owner delete" ON public.core_item FOR DELETE USING (auth.uid() = user_id);
```

### 3.3 Realtime

```sql
ALTER PUBLICATION supabase_realtime ADD TABLE public.core_item;
```

### 3.4 Grants (only needed because the table was first created by Django under `postgres`)

```sql
GRANT USAGE ON SCHEMA public TO anon, service_role, authenticator;
GRANT ALL ON TABLE public.core_item TO anon, service_role;
GRANT USAGE, SELECT ON SEQUENCE public.core_item_id_seq TO anon, service_role, authenticator;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT ALL ON TABLES TO anon, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO anon, service_role;
```

### 3.5 Auth

Supabase → Authentication → Providers → Email → **uncheck "Confirm email"** (for this toy, so
sign-up works without email verification). Or create users manually under Authentication → Users.

---

## 4. The app code

`app/page.js` (client component) handles: auth state, item list, add, soft-delete, and live updates.

Key ideas:
- `supabase.auth.getSession()` + `onAuthStateChange` track login.
- Data is read/written **client-side** with the user's session; RLS scopes rows to `auth.uid()`.
- Insert sets `user_id: user.id`; delete is a soft-delete (`is_active = false`).
- Realtime subscribes to `core_item` changes and reloads on any event.

```jsx
"use client";
import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabaseClient";

export default function Home() {
  const [user, setUser] = useState(null);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [items, setItems] = useState([]);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) =>
      setUser(data.session?.user ?? null));
    const { data: sub } = supabase.auth.onAuthStateChange((_e, session) =>
      setUser(session?.user ?? null));
    return () => sub.subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (!user) return;
    load();
    const channel = supabase.channel("core_item-changes")
      .on("postgres_changes",
          { event: "*", schema: "public", table: "core_item" },
          () => load())
      .subscribe();
    return () => supabase.removeChannel(channel);
  }, [user]);

  async function load() {
    setError("");
    const { data, error } = await supabase
      .from("core_item").select("*").eq("is_active", true)
      .order("created_at", { ascending: false });
    if (error) setError(error.message); else setItems(data);
  }
  async function signUp(e) {
    e.preventDefault(); setError("");
    const { error } = await supabase.auth.signUp({ email, password });
    if (error) setError(error.message);
  }
  async function signIn(e) {
    e.preventDefault(); setError("");
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) setError(error.message);
  }
  async function signOut() { await supabase.auth.signOut(); setItems([]); }
  async function add(e) {
    e.preventDefault(); if (!title.trim()) return;
    const { error } = await supabase.from("core_item")
      .insert({ title, description, user_id: user.id, is_active: true });
    if (error) setError(error.message); else { setTitle(""); setDescription(""); }
  }
  async function del(id) {
    await supabase.from("core_item").update({ is_active: false }).eq("id", id);
  }

  if (!user) {
    return (
      <main style={{ maxWidth: 420, margin: "4rem auto", fontFamily: "system-ui" }}>
        <h1>Toy App — Sign in</h1>
        {error && <p style={{ color: "crimson" }}>{error}</p>}
        <form onSubmit={signIn} style={{ display: "grid", gap: 8 }}>
          <input placeholder="Email" value={email} onChange={(e)=>setEmail(e.target.value)} />
          <input type="password" placeholder="Password" value={password}
                 onChange={(e)=>setPassword(e.target.value)} />
          <button type="submit">Sign In</button>
          <button type="button" onClick={signUp}>Sign Up</button>
        </form>
      </main>
    );
  }
  return (
    <main style={{ maxWidth: 640, margin: "2rem auto", fontFamily: "system-ui" }}>
      <h1>Toy App</h1>
      <p>Signed in as {user.email} <button onClick={signOut}>Logout</button></p>
      {error && <p style={{ color: "crimson" }}>{error}</p>}
      <form onSubmit={add} style={{ display: "flex", gap: 8, marginBottom: 16 }}>
        <input placeholder="Title" value={title} onChange={(e)=>setTitle(e.target.value)} style={{ flex: 1 }} />
        <input placeholder="Description" value={description} onChange={(e)=>setDescription(e.target.value)} style={{ flex: 2 }} />
        <button type="submit">Add</button>
      </form>
      <ul>
        {items.map((it) => (
          <li key={it.id} style={{ marginBottom: 8 }}>
            <strong>{it.title}</strong> — {it.description}{" "}
            <button onClick={()=>del(it.id)}>delete</button>
          </li>
        ))}
        {items.length === 0 && <li>No items yet.</li>}
      </ul>
    </main>
  );
}
```

---

## 5. Environment variables

`.env.example` (committed):
```
# REQUIRED — browser-safe (publishable key)
NEXT_PUBLIC_SUPABASE_URL=https://sgkfmmemqgbvvwrpxeix.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=<SB_PUBLISHABLE_KEY>

# optional now (admin/backups only)
SUPABASE_URL=https://sgkfmmemqgbvvwrpxeix.supabase.co
SUPABASE_SECRET_KEY=<SB_SECRET_KEY>
```
In **Vercel → Settings → Environment Variables** add the two `NEXT_PUBLIC_*` vars (the anon
key is safe to expose; RLS protects the data). `.env.local` holds the same for local dev.

---

## 6. Deploy

```bash
cd frontend
git add .
git commit -m "Next.js + Supabase: auth, RLS, realtime, base-table pattern"
git push
```
Vercel auto-detects Next.js (or set Framework = Next.js, Output = `.next`). Open the URL:
sign up two users in two browsers → each sees only their own items; changes appear live.

---

## 7. Troubleshooting (everything we hit)

| # | Symptom | Root cause | Fix |
|---|---|---|---|
| 1 | `password authentication failed` from Django | Supabase password has `@`, breaking the URL | URL-encode `@` as `%40` in `DATABASE_URL` |
| 2 | `psycopg2-binary` wheel build fails | pinned version had no wheel for Python 3.14 | loose pins; `Django>=5.2` (got 6.1) |
| 3 | `Cannot GET /api/health/` from Render | Hit wrong URL — a stray Render service ran the *frontend* (Express) | Use the real backend URL `myapp-backend-XXXX.onrender.com`; delete the stray service |
| 4 | Browser CORS error | Render `FRONTEND_URL` not set | set `FRONTEND_URL` = Vercel URL, redeploy |
| 5 | `GET //api/items/ 404` | `VITE_API_BASE` trailing slash → `//api` | strip trailing slash (`replace(/\/$/,"")`) |
| 6 | Vercel "Deployment Blocked … Hobby private repo" | Vercel GitHub account ≠ repo owner (private repo) | make repo **public**, or reconnect Vercel to repo-owning account |
| 7 | Vercel "No Next.js version detected" / "No Output Directory dist" | Project still configured as the old **Vite** app | set Framework = Next.js, Output = `.next`, Root Directory = `./` |
| 8 | `permission denied for table core_item` (500) | API role lacked GRANT on the table (created by Django under `postgres`) | `GRANT ALL ON TABLE … TO anon, service_role` |
| 9 | `500` on **POST only** (GET/DELETE ok) | API role lacked USAGE on `core_item_id_seq` | `GRANT USAGE, SELECT ON SEQUENCE … TO anon, service_role` |
| 10 | `23502 null value in column "created_at"` | `auto_now_add` is ORM-level only — no DB DEFAULT | `ALTER COLUMN created_at SET DEFAULT now()` |
| 11 | Everyone saw all rows (no per-user) | open `anon read` policy | replace with per-user RLS (`auth.uid() = user_id`) |

---

## 8. Key concepts learned

- **Supabase = Postgres + REST API (PostgREST) + Auth + Realtime.** The API connects as a role
  (`anon` for client, `service_role` for server). Tables are owned by `postgres`; other roles
  need **GRANTs**.
- **RLS** is the security layer: even with the right GRANT, *which rows* a role sees is decided
  by policies. `auth.uid()` in a policy scopes rows to the logged-in user.
- **ORM vs DB defaults:** Django/ORM-level defaults (e.g. `auto_now_add`) are NOT real DB
  `DEFAULT`s. Any non-ORM writer (Supabase API, raw SQL) must supply the value or you'll get
  `23502`. Define schema with explicit DB defaults (e.g. via Supabase migrations).
- **Secrets:** `service_role`/secret key = server-only, full access. Publishable/anon key =
  browser-safe, RLS-enforced. Never ship the secret key to the client.
- **Realtime** needs the table added to the `supabase_realtime` publication and a role with
  SELECT (via RLS) to receive changes.
- **Admin work** (grants, DDL) is done by connecting as `postgres` directly (SQL Editor or a
  `psycopg2` script) — equivalent operations; the dashboard SQL Editor is just a GUI for the same.

---

## 9. Future improvements

- **Supabase CLI migrations** (`supabase init` + `supabase db push`) so schema is version-controlled.
- **Password reset / magic-link** login.
- **Dedicated schema** (e.g. `app`) instead of `public` for tidiness.
- **Background jobs** via Vercel Cron or Supabase scheduled functions.
- **Validation** (e.g. `zod`) on inputs.
- Soft-deleted rows: add a "trash" view or hard-delete after a retention period.
