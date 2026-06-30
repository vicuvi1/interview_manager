"""Admin ("caller") mode: drive every interview through its lifecycle."""

from tkinter import messagebox, simpledialog, ttk

from app import service

from .common import guard, pretty, repopulate

STATUSES = [
    "All",
    "requested",
    "approved",
    "scheduled",
    "in_progress",
    "completed",
    "rejected",
    "cancelled",
]


class AdminFrame(ttk.Frame):
    def __init__(self, master):
        super().__init__(master, padding=12)
        self._interviews: dict[int, dict] = {}
        self.columnconfigure(0, weight=1)
        self._build()

    def _build(self):
        top = ttk.Frame(self)
        top.grid(row=0, column=0, sticky="ew")
        ttk.Label(top, text="Filter:").pack(side="left")
        self.filter = ttk.Combobox(top, values=STATUSES, state="readonly", width=14)
        self.filter.set("All")
        self.filter.pack(side="left", padx=6)
        self.filter.bind("<<ComboboxSelected>>", lambda e: self.refresh())
        ttk.Button(top, text="Reload", command=self.refresh).pack(side="left")

        ivf = ttk.LabelFrame(self, text="Interviews", padding=10)
        ivf.grid(row=1, column=0, sticky="nsew", pady=8)
        self.rowconfigure(1, weight=1)
        ivf.columnconfigure(0, weight=1)
        ivf.rowconfigure(0, weight=1)
        cols = ("candidate", "role", "status", "scheduled", "payment")
        self.tree = ttk.Treeview(ivf, columns=cols, show="headings", height=8)
        for c, t, w in [
            ("candidate", "Candidate", 210),
            ("role", "Role", 170),
            ("status", "Status", 100),
            ("scheduled", "Scheduled (their tz)", 170),
            ("payment", "Payment", 150),
        ]:
            self.tree.heading(c, text=t)
            self.tree.column(c, width=w, anchor="w")
        self.tree.grid(row=0, column=0, sticky="nsew")

        actions = ttk.Frame(ivf)
        actions.grid(row=1, column=0, sticky="w", pady=(8, 0))
        for label, cmd in [
            ("Approve", self._approve),
            ("Reject", self._reject),
            ("Schedule", self._schedule),
            ("Start call", self._start),
            ("Complete", self._complete),
            ("Cancel", self._cancel),
            ("Invoice", self._invoice),
            ("Notes", self._notes),
        ]:
            ttk.Button(actions, text=label, command=cmd).pack(side="left", padx=3)

        nf = ttk.LabelFrame(self, text="Admin notifications", padding=10)
        nf.grid(row=2, column=0, sticky="nsew")
        nf.columnconfigure(0, weight=1)
        nf.rowconfigure(0, weight=1)
        ncols = ("subject", "detail", "when")
        self.n_tree = ttk.Treeview(nf, columns=ncols, show="headings", height=5)
        for c, t, w in [
            ("subject", "Subject", 160),
            ("detail", "Detail", 380),
            ("when", "When (UTC)", 140),
        ]:
            self.n_tree.heading(c, text=t)
            self.n_tree.column(c, width=w, anchor="w")
        self.n_tree.grid(row=0, column=0, sticky="nsew")

    # ----- selection -----
    def _selected(self) -> dict | None:
        sel = self.tree.selection()
        return self._interviews.get(int(sel[0])) if sel else None

    def _require_selection(self) -> dict | None:
        interview = self._selected()
        if interview is None:
            messagebox.showinfo("Select first", "Select an interview row.", parent=self)
        return interview

    def _run(self, fn):
        ok, _ = guard(self, fn)
        if ok:
            self.refresh()

    # ----- lifecycle actions -----
    def _approve(self):
        iv = self._require_selection()
        if iv:
            self._run(lambda: service.approve(iv["id"]))

    def _start(self):
        iv = self._require_selection()
        if iv:
            self._run(lambda: service.start_call(iv["id"]))

    def _reject(self):
        iv = self._require_selection()
        if not iv:
            return
        reason = simpledialog.askstring("Reject", "Reason (optional):", parent=self)
        self._run(lambda: service.reject(iv["id"], reason))

    def _cancel(self):
        iv = self._require_selection()
        if not iv:
            return
        reason = simpledialog.askstring("Cancel", "Reason (optional):", parent=self)
        self._run(lambda: service.cancel(iv["id"], reason))

    def _schedule(self):
        iv = self._require_selection()
        if not iv:
            return
        when = simpledialog.askstring(
            "Schedule",
            f"Time in candidate tz ({iv['timezone']})\nYYYY-MM-DD HH:MM:",
            parent=self,
        )
        if not when:
            return
        link = simpledialog.askstring("Schedule", "Meeting link (optional):", parent=self)
        self._run(lambda: service.schedule(iv["id"], when, link))

    def _complete(self):
        iv = self._require_selection()
        if not iv:
            return
        outcome = simpledialog.askstring("Complete", "Outcome / summary:", parent=self)
        rating_raw = simpledialog.askstring("Complete", "Rating 1-5 (optional):", parent=self)
        rating = None
        if rating_raw and rating_raw.strip():
            try:
                rating = int(rating_raw)
            except ValueError:
                messagebox.showerror("Complete", "Rating must be a number 1-5.", parent=self)
                return
        self._run(lambda: service.complete(iv["id"], outcome, rating))

    def _invoice(self):
        iv = self._require_selection()
        if not iv:
            return
        amount = simpledialog.askstring("Invoice", "Amount (e.g. 150.00):", parent=self)
        if not amount:
            return
        try:
            cents = round(float(amount) * 100)
        except ValueError:
            messagebox.showerror("Invoice", "Enter a number like 150.00", parent=self)
            return
        currency = simpledialog.askstring(
            "Invoice", "Currency:", initialvalue="USD", parent=self
        ) or "USD"
        self._run(lambda: service.create_payment(iv["id"], cents, currency))

    def _notes(self):
        iv = self._require_selection()
        if not iv:
            return
        notes = simpledialog.askstring(
            "Private notes",
            "Admin notes:",
            initialvalue=iv.get("admin_notes") or "",
            parent=self,
        )
        if notes is None:
            return
        self._run(lambda: service.set_admin_notes(iv["id"], notes))

    # ----- data -----
    def refresh(self):
        chosen = self.filter.get()
        status = None if chosen == "All" else chosen
        ok, interviews = guard(self, lambda: service.list_interviews(status))
        if ok:
            self._interviews = {i["id"]: i for i in interviews}
            items = []
            for i in interviews:
                cand = i.get("candidate") or {}
                payment = i.get("payment")
                pay_text = (
                    f"{payment['status']} · {payment['amount_display']}"
                    if payment
                    else "—"
                )
                who = f"{cand.get('name', '')} <{cand.get('email', '')}>"
                items.append(
                    (
                        str(i["id"]),
                        (
                            who,
                            i["role"],
                            i["status"],
                            pretty(i["scheduled_start_local"]),
                            pay_text,
                        ),
                    )
                )
            repopulate(self.tree, items)

        ok, notes = guard(self, service.admin_notifications)
        if ok:
            items = [
                (str(n["id"]), (n["subject"], n["body"], pretty(n["created_at"])))
                for n in notes
            ]
            repopulate(self.n_tree, items)
