const BASE = import.meta.env.VITE_API_BASE || "";

export async function getItems() {
  const res = await fetch(`${BASE}/api/items/`);
  if (!res.ok) throw new Error("Failed to load items");
  return res.json();
}

export async function createItem(title, description) {
  const res = await fetch(`${BASE}/api/items/`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ title, description }),
  });
  if (!res.ok) throw new Error("Failed to create item");
  return res.json();
}

export async function deleteItem(id) {
  const res = await fetch(`${BASE}/api/items/${id}/`, { method: "DELETE" });
  if (!res.ok) throw new Error("Failed to delete item");
}
