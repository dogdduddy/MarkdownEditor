#!/usr/bin/env python3
"""MD Lens save helper (Chrome native messaging host).

Chrome starts this program when the MD Lens extension asks to save, and only
that extension may talk to it (see allowed_origins in the installed manifest).
It does exactly one thing: overwrite an existing Markdown/text file in place.
"""
import json
import os
import shutil
import struct
import sys
import tempfile

VERSION = "1"
EXTENSIONS = {".md", ".markdown", ".mdown", ".mkd", ".mkdn", ".mdwn", ".mdtxt", ".txt"}


def read_message():
    header = sys.stdin.buffer.read(4)
    if len(header) < 4:
        return None
    (length,) = struct.unpack("<I", header)
    return json.loads(sys.stdin.buffer.read(length).decode("utf-8"))


def send_message(message):
    data = json.dumps(message).encode("utf-8")
    sys.stdout.buffer.write(struct.pack("<I", len(data)) + data)
    sys.stdout.buffer.flush()


def normalize(text):
    return text.lstrip("﻿").replace("\r\n", "\n")


def write(message):
    path = message.get("path")
    text = message.get("text")
    if not isinstance(path, str) or not isinstance(text, str) or not os.path.isabs(path):
        return {"ok": False, "error": "bad-request", "message": "path and text are required"}
    path = os.path.realpath(path)
    if os.path.splitext(path)[1].lower() not in EXTENSIONS:
        return {"ok": False, "error": "not-allowed", "message": "only Markdown/text files can be saved"}
    # Overwrite only: this helper never creates new files.
    if not os.path.isfile(path):
        return {"ok": False, "error": "not-found", "message": "file does not exist: " + path}

    base = message.get("base")
    if isinstance(base, str) and not message.get("force"):
        with open(path, "r", encoding="utf-8", errors="replace", newline="") as f:
            if normalize(f.read()) != normalize(base):
                return {"ok": False, "error": "conflict", "message": "file changed on disk"}

    # Write next to the file, then swap, so a crash cannot leave it half-written.
    directory = os.path.dirname(path)
    fd, tmp = tempfile.mkstemp(prefix=".mdlens-", dir=directory)
    try:
        with os.fdopen(fd, "w", encoding="utf-8", newline="") as f:
            f.write(text)
        shutil.copymode(path, tmp)
        os.replace(tmp, path)
    except BaseException:
        try:
            os.unlink(tmp)
        except OSError:
            pass
        raise
    return {"ok": True}


def main():
    while True:
        message = read_message()
        if message is None:
            return
        try:
            op = message.get("op")
            if op == "ping":
                send_message({"ok": True, "version": VERSION})
            elif op == "write":
                send_message(write(message))
            else:
                send_message({"ok": False, "error": "bad-request", "message": "unknown op"})
        except Exception as error:  # report instead of dying silently
            send_message({"ok": False, "error": "failed", "message": str(error)})


if __name__ == "__main__":
    main()
