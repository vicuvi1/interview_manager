"""Interview Manager - Launcher / Updater (a tiny deployer).

Run this with any system Python (it only uses the standard library). On start it:
  1. pulls the latest code from GitHub (if this is a git clone),
  2. creates a local virtual environment if one doesn't exist,
  3. installs / updates the requirements,
and then enables a "Launch App" button that starts the desktop app.

    python launcher.py        (or double-click "Start Interview Manager.bat")
"""

import os
import queue
import shutil
import subprocess
import sys
import threading
import tkinter as tk
from tkinter import scrolledtext, ttk

PROJECT_DIR = os.path.dirname(os.path.abspath(__file__))
VENV_DIR = os.path.join(PROJECT_DIR, "venv")
REQUIREMENTS = os.path.join(PROJECT_DIR, "requirements.txt")


def venv_python() -> str:
    if os.name == "nt":
        return os.path.join(VENV_DIR, "Scripts", "python.exe")
    return os.path.join(VENV_DIR, "bin", "python")


def venv_pythonw() -> str:
    """Windowless interpreter (no console flash) for launching the GUI app."""
    if os.name == "nt":
        candidate = os.path.join(VENV_DIR, "Scripts", "pythonw.exe")
        if os.path.exists(candidate):
            return candidate
    return venv_python()


class Launcher(tk.Tk):
    def __init__(self):
        super().__init__()
        self.title("Interview Manager - Launcher")
        self.geometry("700x480")
        self.minsize(560, 380)
        self.queue: queue.Queue = queue.Queue()
        self._running = False

        top = ttk.Frame(self, padding=10)
        top.pack(fill="x")
        ttk.Label(top, text="Interview Manager", font=("Segoe UI", 14, "bold")).pack(
            side="left"
        )
        self.status = ttk.Label(top, text="Starting...")
        self.status.pack(side="right")

        btns = ttk.Frame(self, padding=(10, 0))
        btns.pack(fill="x")
        self.btn_setup = ttk.Button(btns, text="Update & install", command=self.start_setup)
        self.btn_setup.pack(side="left")
        self.btn_launch = ttk.Button(
            btns, text="Launch App", command=self.launch, state="disabled"
        )
        self.btn_launch.pack(side="left", padx=6)
        ttk.Button(btns, text="Quit", command=self.destroy).pack(side="right")

        self.log = scrolledtext.ScrolledText(
            self, height=18, state="disabled", wrap="word"
        )
        self.log.pack(fill="both", expand=True, padx=10, pady=10)

        self.after(100, self._drain)
        self.after(400, self.start_setup)  # auto-run setup on start

    # ----- logging via a thread-safe queue -----
    def _write(self, text: str):
        self.log.configure(state="normal")
        self.log.insert("end", text + "\n")
        self.log.see("end")
        self.log.configure(state="disabled")

    def _drain(self):
        try:
            while True:
                kind, payload = self.queue.get_nowait()
                if kind == "log":
                    self._write(payload)
                elif kind == "status":
                    self.status.config(text=payload)
                elif kind == "done":
                    self._on_done(payload)
        except queue.Empty:
            pass
        self.after(100, self._drain)

    # ----- setup pipeline (runs off the UI thread) -----
    def start_setup(self):
        if self._running:
            return
        self._running = True
        self.btn_setup.config(state="disabled")
        self.btn_launch.config(state="disabled")
        self.queue.put(("status", "Working..."))
        threading.Thread(target=self._setup_worker, daemon=True).start()

    def _run(self, args, label) -> int:
        self.queue.put(("log", "$ " + " ".join(args)))
        try:
            proc = subprocess.Popen(
                args,
                cwd=PROJECT_DIR,
                stdout=subprocess.PIPE,
                stderr=subprocess.STDOUT,
                text=True,
                bufsize=1,
            )
        except FileNotFoundError as exc:
            self.queue.put(("log", "  ! " + str(exc)))
            return 1
        for line in proc.stdout:
            self.queue.put(("log", "  " + line.rstrip()))
        proc.wait()
        self.queue.put(("log", "  -> {} exit {}".format(label, proc.returncode)))
        return proc.returncode

    def _setup_worker(self):
        try:
            if os.path.isdir(os.path.join(PROJECT_DIR, ".git")) and shutil.which("git"):
                self.queue.put(("log", "Updating from GitHub..."))
                self._run(["git", "pull", "--ff-only"], "git pull")

            if not os.path.exists(venv_python()):
                self.queue.put(("log", "Creating virtual environment..."))
                if self._run([sys.executable, "-m", "venv", VENV_DIR], "venv") != 0:
                    self.queue.put(("done", False))
                    return

            self.queue.put(("log", "Installing / updating requirements..."))
            self._run([venv_python(), "-m", "pip", "install", "--upgrade", "pip"], "pip")
            rc = self._run(
                [venv_python(), "-m", "pip", "install", "-r", REQUIREMENTS], "pip install"
            )
            self.queue.put(("done", rc == 0))
        except Exception as exc:  # pragma: no cover - defensive
            self.queue.put(("log", "ERROR: " + str(exc)))
            self.queue.put(("done", False))

    def _on_done(self, success: bool):
        self._running = False
        self.btn_setup.config(state="normal")
        if success:
            self.btn_launch.config(state="normal")
            self.status.config(text="Ready")
            self._write("\nReady. Click 'Launch App' to start.")
        else:
            self.status.config(text="Setup failed")
            self._write("\nSetup failed - see the log above.")

    # ----- launch -----
    def launch(self):
        interpreter = venv_pythonw()
        if not os.path.exists(venv_python()):
            self._write("Not installed yet - click 'Update & install' first.")
            return
        self._write("Launching app...")
        try:
            subprocess.Popen(
                [interpreter, os.path.join(PROJECT_DIR, "run_app.py")], cwd=PROJECT_DIR
            )
        except Exception as exc:
            self._write("Failed to launch: " + str(exc))


if __name__ == "__main__":
    Launcher().mainloop()
