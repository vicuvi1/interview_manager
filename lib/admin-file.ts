/**
 * Open a private "resumes"-bucket file for an admin via the server signer
 * (/api/admin/file), which bypasses storage RLS. A blank tab is opened
 * synchronously (inside the click gesture) so the pop-up isn't blocked, then
 * pointed at the signed URL once it resolves. Returns null on success or an
 * error message to surface.
 */
export async function openSignedAdminFile(path: string): Promise<string | null> {
  const w = typeof window !== "undefined" ? window.open("about:blank", "_blank") : null;
  try {
    const res = await fetch("/api/admin/file", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path }),
    });
    const j = await res.json().catch(() => ({}));
    if (!res.ok || !j?.url) {
      w?.close();
      return j?.error ?? "Could not open file";
    }
    if (w) w.location.href = j.url;
    else window.open(j.url, "_blank", "noopener");
    return null;
  } catch (e) {
    w?.close();
    return e instanceof Error ? e.message : "Could not open file";
  }
}
