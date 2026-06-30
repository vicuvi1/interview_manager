// Admin ("caller") dashboard logic.

const AKEY = "im_admin_key";
let adminKey = localStorage.getItem(AKEY) || "";
const $ = (id) => document.getElementById(id);

function call(path, opts = {}) {
  return api(path, { ...opts, adminKey });
}

$("auth-go").onclick = async () => {
  adminKey = $("admin-key").value.trim();
  try {
    await call("/api/interviews"); // validates the key
    localStorage.setItem(AKEY, adminKey);
    showDash();
  } catch (e) {
    toast("Invalid admin key", "bad");
  }
};

$("lock").onclick = () => {
  localStorage.removeItem(AKEY);
  adminKey = "";
  $("dash").classList.add("hidden");
  $("auth").classList.remove("hidden");
};

$("reload").onclick = load;
$("filter").onchange = load;

function showDash() {
  $("auth").classList.add("hidden");
  $("dash").classList.remove("hidden");
  load();
}

async function load() {
  try {
    const status = $("filter").value;
    const [rows, notifs] = await Promise.all([
      call(`/api/interviews${status ? `?status=${status}` : ""}`),
      call("/api/admin/notifications"),
    ]);
    renderRows(rows);
    renderNotifs(notifs);
  } catch (e) {
    toast(e.message, "bad");
  }
}

function actionsFor(i) {
  const id = i.id;
  const btn = (label, act, cls = "ghost") =>
    `<button class="${cls}" data-act="${act}" data-id="${id}">${label}</button>`;
  const out = [];
  switch (i.status) {
    case "requested":
      out.push(btn("Approve", "approve"), btn("Reject", "reject", "ghost"));
      break;
    case "approved":
      out.push(btn("Schedule", "schedule"), btn("Cancel", "cancel"));
      break;
    case "scheduled":
      out.push(btn("Start call", "start"), btn("Cancel", "cancel"));
      break;
    case "in_progress":
      out.push(btn("Complete", "complete"), btn("Cancel", "cancel"));
      break;
    default:
      break;
  }
  if (!i.payment && !["rejected", "cancelled"].includes(i.status)) {
    out.push(btn("Invoice", "invoice"));
  }
  out.push(btn("Notes", "notes"));
  return `<div class="actions">${out.join("")}</div>`;
}

function renderRows(rows) {
  const tbody = $("rows");
  if (!rows.length) {
    tbody.innerHTML = `<tr><td colspan="6" class="muted">No interviews.</td></tr>`;
    return;
  }
  tbody.innerHTML = rows.map((i) => {
    const c = i.candidate || {};
    const localWhen = i.scheduled_start_local
      ? `${i.scheduled_start_local.replace("T", " ").slice(0, 16)} (${i.timezone})`
      : "—";
    let pay = "—";
    if (i.payment) pay = badge(i.payment.status) + ` ${escapeHtml(i.payment.amount_display)}`;
    return `<tr>
      <td>${escapeHtml(c.name || "")}<br><span class="muted">${escapeHtml(c.email || "")}</span></td>
      <td>${escapeHtml(i.role)}</td>
      <td>${badge(i.status)}</td>
      <td>${localWhen}</td>
      <td>${pay}</td>
      <td>${actionsFor(i)}</td>
    </tr>`;
  }).join("");

  tbody.querySelectorAll("[data-act]").forEach((b) => {
    b.onclick = () => doAction(b.dataset.act, parseInt(b.dataset.id, 10));
  });
}

async function doAction(act, id) {
  try {
    if (act === "approve") {
      await call(`/api/interviews/${id}/approve`, { method: "POST" });
    } else if (act === "start") {
      await call(`/api/interviews/${id}/start`, { method: "POST" });
    } else if (act === "reject" || act === "cancel") {
      const reason = prompt(`Reason for ${act} (optional):`) || null;
      await call(`/api/interviews/${id}/${act}`, { method: "POST", body: { reason } });
    } else if (act === "schedule") {
      const v = prompt("Scheduled time in YOUR local time (YYYY-MM-DDTHH:MM):");
      if (!v) return;
      const iso = localInputToISO(v);
      if (!iso || isNaN(new Date(v).getTime())) return toast("Invalid date", "bad");
      const link = prompt("Meeting link (optional):") || null;
      await call(`/api/interviews/${id}/schedule`, {
        method: "POST",
        body: { scheduled_start: iso, meeting_link: link },
      });
    } else if (act === "complete") {
      const outcome = prompt("Outcome / summary:") || null;
      const ratingRaw = prompt("Rating 1-5 (optional):");
      const rating = ratingRaw ? parseInt(ratingRaw, 10) : null;
      await call(`/api/interviews/${id}/complete`, {
        method: "POST",
        body: { outcome, rating },
      });
    } else if (act === "invoice") {
      const amt = prompt("Invoice amount (e.g. 150.00):");
      if (!amt) return;
      const cents = Math.round(parseFloat(amt) * 100);
      if (!cents || cents <= 0) return toast("Invalid amount", "bad");
      const currency = (prompt("Currency:", "USD") || "USD").toUpperCase();
      await call(`/api/interviews/${id}/payment`, {
        method: "POST",
        body: { amount_cents: cents, currency },
      });
    } else if (act === "notes") {
      const notes = prompt("Private admin notes:") || "";
      await call(`/api/interviews/${id}/admin-notes`, {
        method: "PATCH",
        body: { admin_notes: notes },
      });
    }
    toast("Done");
    load();
  } catch (e) {
    toast(e.message, "bad");
  }
}

function renderNotifs(rows) {
  const box = $("admin-notifs");
  if (!rows.length) { box.innerHTML = `<div class="muted">No notifications.</div>`; return; }
  box.innerHTML = rows.map((n) => `
    <div class="notif ${n.read ? "" : "unread"}">
      <div class="subj">${escapeHtml(n.subject)}</div>
      <div class="muted">${escapeHtml(n.body)} · ${fmt(n.created_at)}</div>
    </div>`).join("");
}

// Boot
if (adminKey) {
  $("admin-key").value = adminKey;
  showDash();
}
