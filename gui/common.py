"""Small shared helpers for the Tkinter views."""

from tkinter import messagebox

from app.service import ServiceError


def pretty(iso: str | None, fallback: str = "—") -> str:
    """Trim an ISO timestamp to a friendly 'YYYY-MM-DD HH:MM'."""
    if not iso:
        return fallback
    return iso[:16].replace("T", " ")


def guard(parent, fn):
    """Run a service call, surfacing errors in a dialog.

    Returns (ok: bool, result). On error, ok is False and a messagebox shows.
    """
    try:
        return True, fn()
    except ServiceError as exc:
        messagebox.showerror("Couldn't do that", str(exc), parent=parent)
    except Exception as exc:  # pragma: no cover - unexpected
        messagebox.showerror(
            "Unexpected error", f"{type(exc).__name__}: {exc}", parent=parent
        )
    return False, None


def repopulate(tree, items):
    """Replace a Treeview's rows, preserving the selection where possible.

    items: list of (iid: str, values: tuple).
    """
    previous = [i for i in tree.selection()]
    tree.delete(*tree.get_children())
    for iid, values in items:
        tree.insert("", "end", iid=iid, values=values)
    keep = [i for i in previous if tree.exists(i)]
    if keep:
        tree.selection_set(keep)
