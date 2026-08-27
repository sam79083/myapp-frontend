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

  // Track auth state
  useEffect(() => {
    supabase.auth.getSession().then(({ data }) =>
      setUser(data.session?.user ?? null),
    );
    const { data: sub } = supabase.auth.onAuthStateChange((_e, session) =>
      setUser(session?.user ?? null),
    );
    return () => sub.subscription.unsubscribe();
  }, []);

  // Load items + live updates (only when logged in)
  useEffect(() => {
    if (!user) return;
    load();
    const channel = supabase
      .channel("core_item-changes")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "core_item" },
        () => load(),
      )
      .subscribe();
    return () => supabase.removeChannel(channel);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

  async function load() {
    setError("");
    const { data, error } = await supabase
      .from("core_item")
      .select("*")
      .eq("is_active", true)
      .order("created_at", { ascending: false });
    if (error) setError(error.message);
    else setItems(data);
  }

  async function signUp(e) {
    e.preventDefault();
    setError("");
    const { error } = await supabase.auth.signUp({ email, password });
    if (error) setError(error.message);
  }

  async function signIn(e) {
    e.preventDefault();
    setError("");
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) setError(error.message);
  }

  async function signOut() {
    await supabase.auth.signOut();
    setItems([]);
  }

  async function add(e) {
    e.preventDefault();
    if (!title.trim()) return;
    const { error } = await supabase
      .from("core_item")
      .insert({ title, description, user_id: user.id, is_active: true });
    if (error) setError(error.message);
    else {
      setTitle("");
      setDescription("");
    }
  }

  async function del(id) {
    await supabase
      .from("core_item")
      .update({ is_active: false })
      .eq("id", id);
  }

  if (!user) {
    return (
      <main style={{ maxWidth: 420, margin: "4rem auto", fontFamily: "system-ui" }}>
        <h1>Toy App — Sign in</h1>
        {error && <p style={{ color: "crimson" }}>{error}</p>}
        <form onSubmit={signIn} style={{ display: "grid", gap: 8 }}>
          <input
            placeholder="Email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
          <input
            type="password"
            placeholder="Password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
          <button type="submit">Sign In</button>
          <button type="button" onClick={signUp}>
            Sign Up
          </button>
        </form>
      </main>
    );
  }

  return (
    <main style={{ maxWidth: 640, margin: "2rem auto", fontFamily: "system-ui" }}>
      <h1>Toy App</h1>
      <p>
        Signed in as {user.email}{" "}
        <button onClick={signOut}>Logout</button>
      </p>
      {error && <p style={{ color: "crimson" }}>{error}</p>}

      <form onSubmit={add} style={{ display: "flex", gap: 8, marginBottom: 16 }}>
        <input
          placeholder="Title"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          style={{ flex: 1 }}
        />
        <input
          placeholder="Description"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          style={{ flex: 2 }}
        />
        <button type="submit">Add</button>
      </form>

      <ul>
        {items.map((it) => (
          <li key={it.id} style={{ marginBottom: 8 }}>
            <strong>{it.title}</strong> — {it.description}{" "}
            <button onClick={() => del(it.id)}>delete</button>
          </li>
        ))}
        {items.length === 0 && <li>No items yet.</li>}
      </ul>
    </main>
  );
}
