#!/usr/bin/env python3
import hashlib
import http.cookies
import json
import os
import secrets
import sqlite3
import time
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from typing import Optional

DB_PATH = os.environ.get("JINGKAO_DB_PATH", "/var/lib/jingkao/jingkao.sqlite3")
HOST = os.environ.get("JINGKAO_API_HOST", "127.0.0.1")
PORT = int(os.environ.get("JINGKAO_API_PORT", "8000"))
SESSION_DAYS = 30


def now() -> int:
    return int(time.time())


def db_connection():
    os.makedirs(os.path.dirname(DB_PATH), exist_ok=True)
    connection = sqlite3.connect(DB_PATH)
    connection.row_factory = sqlite3.Row
    connection.execute("PRAGMA journal_mode=WAL")
    connection.execute("PRAGMA foreign_keys=ON")
    return connection


def password_hash(password: str, salt: Optional[bytes] = None) -> str:
    salt = salt or secrets.token_bytes(16)
    digest = hashlib.pbkdf2_hmac("sha256", password.encode(), salt, 260_000)
    return f"pbkdf2_sha256$260000${salt.hex()}${digest.hex()}"


def password_matches(password: str, encoded: str) -> bool:
    try:
        algorithm, rounds, salt_hex, digest_hex = encoded.split("$")
        if algorithm != "pbkdf2_sha256":
            return False
        digest = hashlib.pbkdf2_hmac("sha256", password.encode(), bytes.fromhex(salt_hex), int(rounds))
        return secrets.compare_digest(digest.hex(), digest_hex)
    except (ValueError, TypeError):
        return False


def initialize_database():
    with db_connection() as connection:
        connection.executescript(
            """
            CREATE TABLE IF NOT EXISTS users (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                username TEXT NOT NULL UNIQUE,
                password_hash TEXT NOT NULL,
                created_at INTEGER NOT NULL
            );
            CREATE TABLE IF NOT EXISTS study_state (
                user_id INTEGER PRIMARY KEY,
                state_json TEXT NOT NULL,
                updated_at INTEGER NOT NULL,
                FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
            );
            CREATE TABLE IF NOT EXISTS sessions (
                token_hash TEXT PRIMARY KEY,
                user_id INTEGER NOT NULL,
                expires_at INTEGER NOT NULL,
                created_at INTEGER NOT NULL,
                FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
            );
            CREATE INDEX IF NOT EXISTS sessions_expires_at_idx ON sessions(expires_at);
            """
        )
        username = os.environ.get("JINGKAO_ADMIN_USER")
        password = os.environ.get("JINGKAO_ADMIN_PASSWORD")
        if username and password:
            encoded = password_hash(password)
            connection.execute(
                "INSERT INTO users(username, password_hash, created_at) VALUES (?, ?, ?) "
                "ON CONFLICT(username) DO UPDATE SET password_hash = excluded.password_hash",
                (username, encoded, now()),
            )


def token_digest(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


class ApiHandler(BaseHTTPRequestHandler):
    server_version = "JingkaoAPI/1.0"

    def log_message(self, format, *args):
        print(f"[{self.log_date_time_string()}] {format % args}")

    def send_json(self, status: int, payload: dict, extra_headers: Optional[dict] = None):
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        for key, value in (extra_headers or {}).items():
            self.send_header(key, value)
        self.end_headers()
        self.wfile.write(body)

    def read_json(self):
        try:
            length = int(self.headers.get("Content-Length", "0"))
            if length > 2_000_000:
                return None
            return json.loads(self.rfile.read(length).decode("utf-8"))
        except (ValueError, UnicodeDecodeError, json.JSONDecodeError):
            return None

    def cookie_token(self):
        cookies = http.cookies.SimpleCookie(self.headers.get("Cookie", ""))
        morsel = cookies.get("jingkao_session")
        return morsel.value if morsel else None

    def authenticated_user(self):
        token = self.cookie_token()
        if not token:
            return None
        with db_connection() as connection:
            row = connection.execute(
                "SELECT users.id, users.username FROM sessions JOIN users ON users.id = sessions.user_id "
                "WHERE sessions.token_hash = ? AND sessions.expires_at > ?",
                (token_digest(token), now()),
            ).fetchone()
            connection.execute("DELETE FROM sessions WHERE expires_at <= ?", (now(),))
            return dict(row) if row else None

    def require_user(self):
        user = self.authenticated_user()
        if not user:
            self.send_json(HTTPStatus.UNAUTHORIZED, {"error": "请先登录"})
        return user

    def do_GET(self):
        if self.path == "/api/health":
            self.send_json(HTTPStatus.OK, {"ok": True})
            return
        if self.path == "/api/me":
            user = self.authenticated_user()
            self.send_json(HTTPStatus.OK if user else HTTPStatus.UNAUTHORIZED, {"user": user} if user else {"user": None})
            return
        if self.path == "/api/state":
            user = self.require_user()
            if not user:
                return
            with db_connection() as connection:
                row = connection.execute("SELECT state_json, updated_at FROM study_state WHERE user_id = ?", (user["id"],)).fetchone()
            payload = json.loads(row["state_json"]) if row else {}
            self.send_json(HTTPStatus.OK, {"state": payload, "updated_at": row["updated_at"] if row else None})
            return
        self.send_json(HTTPStatus.NOT_FOUND, {"error": "未找到接口"})

    def do_POST(self):
        if self.path == "/api/auth/login":
            payload = self.read_json() or {}
            username = str(payload.get("username", "")).strip()
            password = str(payload.get("password", ""))
            with db_connection() as connection:
                row = connection.execute("SELECT id, username, password_hash FROM users WHERE username = ?", (username,)).fetchone()
                valid = bool(row and password_matches(password, row["password_hash"]))
                if valid:
                    token = secrets.token_urlsafe(32)
                    connection.execute(
                        "INSERT INTO sessions(token_hash, user_id, expires_at, created_at) VALUES (?, ?, ?, ?)",
                        (token_digest(token), row["id"], now() + SESSION_DAYS * 86400, now()),
                    )
            if not valid:
                self.send_json(HTTPStatus.UNAUTHORIZED, {"error": "用户名或密码不正确"})
                return
            cookie = f"jingkao_session={token}; Path=/; HttpOnly; SameSite=Lax; Max-Age={SESSION_DAYS * 86400}"
            self.send_json(HTTPStatus.OK, {"user": {"id": row["id"], "username": row["username"]}}, {"Set-Cookie": cookie})
            return
        if self.path == "/api/auth/logout":
            token = self.cookie_token()
            if token:
                with db_connection() as connection:
                    connection.execute("DELETE FROM sessions WHERE token_hash = ?", (token_digest(token),))
            self.send_json(HTTPStatus.OK, {"ok": True}, {"Set-Cookie": "jingkao_session=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0"})
            return
        self.send_json(HTTPStatus.NOT_FOUND, {"error": "未找到接口"})

    def do_PUT(self):
        if self.path != "/api/state":
            self.send_json(HTTPStatus.NOT_FOUND, {"error": "未找到接口"})
            return
        user = self.require_user()
        if not user:
            return
        payload = self.read_json() or {}
        state = payload.get("state")
        if not isinstance(state, dict):
            self.send_json(HTTPStatus.BAD_REQUEST, {"error": "state 必须是对象"})
            return
        encoded = json.dumps(state, ensure_ascii=False, separators=(",", ":"))
        with db_connection() as connection:
            connection.execute(
                "INSERT INTO study_state(user_id, state_json, updated_at) VALUES (?, ?, ?) "
                "ON CONFLICT(user_id) DO UPDATE SET state_json = excluded.state_json, updated_at = excluded.updated_at",
                (user["id"], encoded, now()),
            )
        self.send_json(HTTPStatus.OK, {"ok": True, "updated_at": now()})


if __name__ == "__main__":
    initialize_database()
    print(f"Jingkao API listening on {HOST}:{PORT}")
    ThreadingHTTPServer((HOST, PORT), ApiHandler).serve_forever()

