"""Candidate mode: sign in, request interviews, track status, pay, read notices."""

import tkinter as tk
from tkinter import ttk

from app import service
from app.config import get_settings

from .common import guard, pretty, repopulate


class CandidateFrame(ttk.Frame):
    def __init__(self, master):
        super().__init__(master, padding=12)
        self.candidate: dict | None = None
        self._interviews: dict[int, dict] = {}
        self.columnconfigure(0, weight=1)
        self._build_signin()
        self._build_main()

    # ----- layout -----
    def _build_signin(self):
        self.signin = ttk.LabelFrame(self, text="Sign in / Register", padding=10)
        self.signin.grid(row=0, column=0, sticky="ew")
        ttk.Label(self.signin, text="Name").grid(row=0, column=0, sticky="w")
        ttk.Label(self.signin, text="Email").grid(row=0, column=1, sticky="w")
        ttk.Label(self.signin, text="Timezone (IANA)").grid(row=0, column=2, sticky="w")
        self.in_name = ttk.Entry(self.signin, width=20)
        self.in_email = ttk.Entry(self.signin, width=26)
        self.in_tz = ttk.Entry(self.signin, width=20)
        self.in_name.grid(row=1, column=0, padx=4, pady=2)
        self.in_email.grid(row=1, column=1, padx=4, pady=2)
        self.in_tz.grid(row=1, column=2, padx=4, pady=2)
        self.in_tz.insert(0, get_settings().default_timezone)
        ttk.Button(self.signin, text="Continue", command=self._sign_in).grid(
            row=1, column=3, padx=6
        )

    def _build_main(self):
        self.main = ttk.Frame(self)
        self.main.columnconfigure(0, weight=1)

        bar = ttk.Frame(self.main)
        bar.grid(row=0, column=0, sticky="ew", pady=(0, 8))
        self.welcome = ttk.Label(bar, text="", font=("Segoe UI", 11, "bold"))
        self.welcome.pack(side="left")
        ttk.Button(bar, text="Switch candidate", command=self._sign_out).pack(side="right")

        req = ttk.LabelFrame(self.main, text="Request an interview", padding=10)
        req.grid(row=1, column=0, sticky="ew")
        req.columnconfigure(1, weight=1)
        ttk.Label(req, text="Role / topic").grid(row=0, column=0, sticky="w")
        self.r_role = ttk.Entry(req)
        self.r_role.grid(row=0, column=1, columnspan=3, sticky="ew", padx=4, pady=2)
        ttk.Label(req, text="Preferred time").grid(row=1, column=0, sticky="w")
        self.r_when = ttk.Entry(req)
        self.r_when.grid(row=1, column=1, sticky="ew", padx=4)
        ttk.Label(req, text="YYYY-MM-DD HH:MM (your tz)").grid(row=1, column=2, sticky="w")
        ttk.Label(req, text="Duration (min)").grid(row=2, column=0, sticky="w")
        self.r_dur = ttk.Spinbox(req, from_=5, to=480, increment=5, width=6)
        self.r_dur.set(30)
        self.r_dur.grid(row=2, column=1, sticky="w", padx=4)
        ttk.Label(req, text="Notes").grid(row=3, column=0, sticky="nw")
        self.r_notes = tk.Text(req, height=3)
        self.r_notes.grid(row=3, column=1, columnspan=3, sticky="ew", padx=4, pady=2)
        ttk.Button(req, text="Submit request", command=self._request).grid(
            row=4, column=1, sticky="w", pady=(6, 0)
        )

        ivf = ttk.LabelFrame(self.main, text="My interviews", padding=10)
        ivf.grid(row=2, column=0, sticky="nsew", pady=8)
        self.main.rowconfigure(2, weight=1)
        ivf.columnconfigure(0, weight=1)
        ivf.rowconfigure(0, weight=1)
        cols = ("role", "status", "scheduled", "payment")
        self.iv_tree = ttk.Treeview(ivf, columns=cols, show="headings", height=6)
        for c, t, w in [
            ("role", "Role", 200),
            ("status", "Status", 110),
            ("scheduled", "Scheduled (your tz)", 170),
            ("payment", "Payment", 170),
        ]:
            self.iv_tree.heading(c, text=t)
            self.iv_tree.column(c, width=w, anchor="w")
        self.iv_tree.grid(row=0, column=0, sticky="nsew")
        ttk.Button(ivf, text="Pay selected invoice", command=self._pay).grid(
            row=1, column=0, sticky="w", pady=(6, 0)
        )

        nf = ttk.LabelFrame(self.main, text="Notifications", padding=10)
        nf.grid(row=3, column=0, sticky="nsew")
        nf.columnconfigure(0, weight=1)
        nf.rowconfigure(0, weight=1)
        ncols = ("subject", "detail", "when")
        self.n_tree = ttk.Treeview(nf, columns=ncols, show="headings", height=5)
        for c, t, w in [
            ("subject", "Subject", 160),
            ("detail", "Detail", 360),
            ("when", "When (UTC)", 140),
        ]:
            self.n_tree.heading(c, text=t)
            self.n_tree.column(c, width=w, anchor="w")
        self.n_tree.grid(row=0, column=0, sticky="nsew")

    # ----- actions -----
    def _sign_in(self):
        ok, candidate = guard(
            self,
            lambda: service.register_candidate(
                self.in_name.get(), self.in_email.get(), self.in_tz.get()
            ),
        )
        if ok:
            self.candidate = candidate
            self.signin.grid_remove()
            self.main.grid(row=0, column=0, sticky="nsew")
            self.rowconfigure(0, weight=1)
            self.welcome.config(
                text=f"Welcome, {candidate['name']}  ·  {candidate['email']}  ·  "
                f"{candidate['timezone']}"
            )
            self.refresh()

    def _sign_out(self):
        self.candidate = None
        self._interviews = {}
        self.main.grid_remove()
        self.signin.grid()

    def _request(self):
        if not self.candidate:
            return
        try:
            dur = int(self.r_dur.get())
        except ValueError:
            dur = 30
        notes = self.r_notes.get("1.0", "end").strip()
        ok, _ = guard(
            self,
            lambda: service.request_interview(
                self.candidate["id"],
                self.r_role.get(),
                preferred_local=self.r_when.get(),
                duration_minutes=dur,
                notes=notes,
            ),
        )
        if ok:
            self.r_role.delete(0, "end")
            self.r_when.delete(0, "end")
            self.r_notes.delete("1.0", "end")
            self.refresh()

    def _pay(self):
        sel = self.iv_tree.selection()
        if not sel:
            return
        interview = self._interviews.get(int(sel[0]))
        payment = interview.get("payment") if interview else None
        if not payment or payment["status"] != "pending":
            return
        ok, _ = guard(self, lambda: service.pay(payment["id"]))
        if ok:
            self.refresh()

    def refresh(self):
        if not self.candidate:
            return
        ok, interviews = guard(
            self, lambda: service.list_candidate_interviews(self.candidate["id"])
        )
        if ok:
            self._interviews = {i["id"]: i for i in interviews}
            items = []
            for i in interviews:
                payment = i.get("payment")
                pay_text = (
                    f"{payment['status']} · {payment['amount_display']}"
                    if payment
                    else "—"
                )
                items.append(
                    (
                        str(i["id"]),
                        (
                            i["role"],
                            i["status"],
                            pretty(i["scheduled_start_local"]),
                            pay_text,
                        ),
                    )
                )
            repopulate(self.iv_tree, items)

        ok, notes = guard(
            self, lambda: service.candidate_notifications(self.candidate["id"])
        )
        if ok:
            items = [
                (str(n["id"]), (n["subject"], n["body"], pretty(n["created_at"])))
                for n in notes
            ]
            repopulate(self.n_tree, items)
