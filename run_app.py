"""Launch the Interview Manager desktop app.

    python run_app.py

Creates the database (if needed) and opens the window. No server, no browser.
"""

from app.database import init_db


def main() -> None:
    init_db()
    from gui.app import MainApp  # imported after the DB exists

    MainApp().mainloop()


if __name__ == "__main__":
    main()
