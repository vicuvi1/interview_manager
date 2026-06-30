// Candidate portal logic.

const KEY = "im_candidate";
let me = JSON.parse(localStorage.getItem(KEY) || "null");

const $ = (id) => document.getElementById(id);

function showApp() {
  $("signin").classList.add("hidden");
  $("app").classList.remove("hidden");
  $("who").textContent = me.name;
  $("who-tz").textContent = `${me.email} · ${me.timezone}`;
  refresh();
}

function showSignin() {
  $("app").classList.add("hidden");
  $("signin").classList.remove("hidden");
  $("su-tz").value = browserTimezone();
}

$("su-go").onclick = async () => {
  try {
    const c = await api("/api/candidates", {
      method: "POST",
      body: {
        name: $("su-name").value.trim(),
        email: $("su-email").value.trim(),
        timezone: $("su-tz").value.trim() || "UTC",
        phone: $("su-phone").value.trim() || null,
      },
    });
    me = c;
    localStorage.setItem(KEY, JSON.stringify(me));
    showApp();
    toast("Signed in");
  } catch (e) {
    toast(e.message, "bad");
  }
};

$("signout").onclick = () => {
  localStorage.removeItem(KEY);
  me = null;
  showSignin();
};

$("rq-go").onclick = async () => {
  try {
    await api("/api/interviews", {
      method: "POST",
      body: {
        candidate_id: me.id,
        role: $("rq-role").value.trim(),
        preferred_start: localInputToISO($("rq-when").value),
        duration_minutes: parseInt($("rq-dur").value, 10) || 30,
        notes: $("rq-notes").value.trim() || null,
      },
    });
    $("rq-role").value = "";
    $("rq-notes").value = "";
    toast("Interview requested");
    refresh();
  } catch (e) {
    toast(e.message, "bad");
  }
};

async function refresh() {
  const [interviews, notifs] = await Promise.all([
    api(`/api/interviews/by-candidate/${me.id}`),
    api(`/api/candidates/${me.id}/notifications`),
  ]);
  renderInterviews(interviews);
  renderNotifs(notifs);
}

function renderInterviews(rows) {
  const tbody = $("my-interviews");
  if (!rows.length) {
    tbody.innerHTML = `<tr><td colspan="5" class="muted">No interviews yet.</td></tr>`;
    return;
  }
  tbody.innerHTML = rows.map((i) => {
    const pay = i.payment;
    let payCell = "—";
    if (pay) {
      payCell = badge(pay.status) + ` ${escapeHtml(pay.amount_display)}`;
      if (pay.status === "pending") {
        payCell += ` <button class="ghost" data-pay="${pay.id}">Pay</button>`;
      }
    }
    return `<tr>
      <td>${escapeHtml(i.role)}</td>
      <td>${badge(i.status)}</td>
      <td>${fmt(i.scheduled_start_utc)}${i.meeting_link ? `<br><a href="${escapeHtml(i.meeting_link)}" target="_blank">join link</a>` : ""}</td>
      <td>${payCell}</td>
      <td>${i.outcome ? `<span class="muted">${escapeHtml(i.outcome)}</span>` : ""}</td>
    </tr>`;
  }).join("");

  tbody.querySelectorAll("[data-pay]").forEach((btn) => {
    btn.onclick = async () => {
      try {
        await api(`/api/payments/${btn.dataset.pay}/pay`, { method: "POST" });
        toast("Payment sent");
        refresh();
      } catch (e) { toast(e.message, "bad"); }
    };
  });
}

function renderNotifs(rows) {
  const box = $("my-notifs");
  if (!rows.length) {
    box.innerHTML = `<div class="muted">No notifications.</div>`;
    return;
  }
  box.innerHTML = rows.map((n) => `
    <div class="notif ${n.read ? "" : "unread"}">
      <div class="subj">${escapeHtml(n.subject)}</div>
      <div class="muted">${escapeHtml(n.body)} · ${fmt(n.created_at)}</div>
    </div>`).join("");
}

// Boot
if (me) showApp(); else showSignin();
