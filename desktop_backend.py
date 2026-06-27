"""Desktop backend entrypoint for The Cursed Canvas.

This is the PyInstaller target. It starts the Flask app on localhost without
the development reloader and prints a stable URL marker for Electron.
"""

import os
import sys
import multiprocessing


def _load_flask_app():
    os.environ.setdefault("CURSED_CANVAS_DESKTOP", "1")
    from app import _DEFAULT_PORT, _check_port_free, app as flask_app

    return _DEFAULT_PORT, _check_port_free, flask_app


def _pick_port(default_port, check_port_free):
    configured = os.getenv("CURSED_CANVAS_PORT")
    if configured:
        return int(configured)
    if len(sys.argv) > 1:
        return int(sys.argv[1])

    port = default_port
    for _ in range(20):
        if check_port_free(port):
            return port
        port += 1
    raise RuntimeError("Could not find a free localhost port.")


def main():
    multiprocessing.freeze_support()
    default_port, check_port_free, flask_app = _load_flask_app()
    port = _pick_port(default_port, check_port_free)
    url = f"http://127.0.0.1:{port}"
    print(f"DESKTOP_SERVER_URL={url}", flush=True)
    flask_app.run(debug=False, use_reloader=False, host="127.0.0.1", port=port)


if __name__ == "__main__":
    main()
