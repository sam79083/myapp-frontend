import { useEffect, useState } from "react";
import { getItems, createItem, deleteItem } from "./api.js";

export default function App() {
  const [items, setItems] = useState([]);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  async function load() {
    try {
      setLoading(true);
      setItems(await getItems());
      setError("");
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  async function handleSubmit(e) {
    e.preventDefault();
    if (!title.trim()) return;
    try {
      await createItem(title, description);
      setTitle("");
      setDescription("");
      await load();
    } catch (e) {
      setError(e.message);
    }
  }

  async function handleDelete(id) {
    try {
      await deleteItem(id);
      await load();
    } catch (e) {
      setError(e.message);
    }
  }

  return (
    <main style={{ maxWidth: 640, margin: "2rem auto", fontFamily: "system-ui" }}>
      <h1>Toy App</h1>
      {error && <p style={{ color: "crimson" }}>{error}</p>}

      <form onSubmit={handleSubmit} style={{ display: "flex", gap: 8, marginBottom: 16 }}>
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

      {loading ? (
        <p>Loading… (Render may take ~50s to wake up)</p>
      ) : (
        <ul>
          {items.map((it) => (
            <li key={it.id} style={{ marginBottom: 8 }}>
              <strong>{it.title}</strong> — {it.description}{" "}
              <button onClick={() => handleDelete(it.id)}>delete</button>
            </li>
          ))}
          {items.length === 0 && <li>No items yet.</li>}
        </ul>
      )}
    </main>
  );
}
