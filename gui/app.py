"""Main window: Candidate / Admin mode toggle + periodic auto-refresh.

Both modes read and write the same local SQLite database, so a request made in
Candidate mode appears in Admin mode (and vice-versa) on the next refresh —
that is how the two sides "communicate" with no server involved.
"""

import tkinter as tk
from tkinter import messagebox, simpledialog, ttk

from app import service
from app.config import get_settings

from .admin import AdminFrame
from .candidate import CandidateFrame


class MainApp(tk.Tk):
    REFRESH_MS = 4000

    def __init__(self):
        super().__init__()
        settings = get_settings()
        self.title(settings.app_name)
        self.geometry("920x700")
        self.minsize(780, 580)

        header = ttk.Frame(self, padding=(12, 8))
        header.pack(side="top", fill="x")
        ttk.Label(
            header, text=settings.app_name, font=("Segoe UI", 14, "bold")
        ).pack(side="left")
        self.mode = tk.StringVar(value="candidate")
        ttk.Button(header, text="Candidate", command=lambda: self.show("candidate")).pack(
            side="right", padx=(4, 0)
        )
        ttk.Button(header, text="Admin", command=lambda: self.show("admin")).pack(
            side="right"
        )

        body = ttk.Frame(self)
        body.pack(side="top", fill="both", expand=True)
        body.rowconfigure(0, weight=1)
        body.columnconfigure(0, weight=1)
        self.candidate_view = CandidateFrame(body)
        self.admin_view = AdminFrame(body)
        self.candidate_view.grid(row=0, column=0, sticky="nsew")
        self.admin_view.grid(row=0, column=0, sticky="nsew")
        self.admin_unlocked = False

        ttk.Label(
            self,
            text=f"Shared database: {settings.database_url}",
            relief="sunken",
            anchor="w",
            padding=4,
        ).pack(side="bottom", fill="x")

        self.show("candidate")
        self.after(self.REFRESH_MS, self._tick)

    def show(self, mode: str):
        if mode == "admin":
            if not self.admin_unlocked:
                password = simpledialog.askstring(
                    "Admin login", "Admin password:", show="*", parent=self
                )
                if password is None:
                    return
                if not service.verify_admin(password):
                    messagebox.showerror("Admin login", "Incorrect password.", parent=self)
                    return
                self.admin_unlocked = True
            self.admin_view.tkraise()
            self.mode.set("admin")
            self.admin_view.refresh()
        else:
            self.candidate_view.tkraise()
            self.mode.set("candidate")

    def _tick(self):
        try:
            if self.mode.get() == "admin" and self.admin_unlocked:
                self.admin_view.refresh()
            elif self.mode.get() == "candidate":
                self.candidate_view.refresh()
        except Exception:
            pass  # never let the refresh loop crash the UI
        self.after(self.REFRESH_MS, self._tick)
