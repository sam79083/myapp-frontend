"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabaseClient";

export default function Home() {
  const [items, setItems] = useState([]);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [error, setError] = useState("");

  async function load() {
    setError("");
    const res = await fetch("/api/items");
    const data = await res.json();
    if (!res.ok) {
      setError(data.error || "Failed to load items");
      return;
    }
    setItems(data);
  }

  useEffect(() => {
    load();

    const channel = supabase
      .channel("core_item-changes")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "core_item" },
        () => load(),
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  async function add(e) {
    e.preventDefault();
    if (!title.trim()) return;
    const res = await fetch("/api/items", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title, description }),
    });
    if (res.ok) {
      setTitle("");
      setDescription("");
      load();
    } else {
      setError("Failed to add item");
    }
  }

  async function del(id) {
    await fetch(`/api/items/${id}`, { method: "DELETE" });
    load();
  }

  return (
    <main style={{ maxWidth: 640, margin: "2rem auto", fontFamily: "system-ui" }}>
      <h1>Toy App (Next.js + Supabase)</h1>
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
