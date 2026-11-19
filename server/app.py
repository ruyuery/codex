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
from pathlib import Path
from typing import Optional

DB_PATH = os.environ.get("JINGKAO_DB_PATH", "/var/lib/jingkao/jingkao.sqlite3")
HOST = os.environ.get("JINGKAO_API_HOST", "127.0.0.1")
PORT = int(os.environ.get("JINGKAO_API_PORT", "8000"))
SESSION_DAYS = 30
SESSION_SECONDS = SESSION_DAYS * 86400
SESSION_COOKIE = os.environ.get("JINGKAO_SESSION_COOKIE", "jingkao_session")
APP_ENV = os.environ.get("JINGKAO_ENV", "production")
STATE_FIELDS = {"tasks", "topics", "planItems", "planOrder", "actual", "notes", "mood", "focusSessions", "examAnswers"}


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


def seed_exam_catalog(connection):
    path = Path(__file__).with_name("exam-papers.json")
    for paper in json.loads(path.read_text(encoding="utf-8")):
        connection.execute(
            "INSERT OR IGNORE INTO exam_papers(id, year, subject, minutes, edition, source_url) "
            "VALUES (:id, :year, :subject, :minutes, :edition, :source_url)", paper
        )
        for section, first, last, kind, *limit in paper["sections"]:
            connection.executemany(
                "INSERT OR IGNORE INTO exam_items(paper_id, number, section, kind, word_limit) "
                "VALUES (?, ?, ?, ?, ?)",
                ((paper["id"], number, section, kind, limit[0] if limit else None)
                 for number in range(first, last + 1)),
            )


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
            CREATE TABLE IF NOT EXISTS exam_papers (
                id TEXT PRIMARY KEY,
                year INTEGER NOT NULL,
                subject TEXT NOT NULL,
                minutes INTEGER NOT NULL,
                edition TEXT NOT NULL,
                source_url TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS exam_items (
                paper_id TEXT NOT NULL REFERENCES exam_papers(id),
                number INTEGER NOT NULL,
                section TEXT NOT NULL,
                kind TEXT NOT NULL CHECK(kind IN ('single', 'multiple', 'text')),
                word_limit INTEGER,
                PRIMARY KEY (paper_id, number)
            );
            """
        )
        columns = {row["name"] for row in connection.execute("PRAGMA table_info(sessions)")}
        if "remember" not in columns:
            connection.execute("ALTER TABLE sessions ADD COLUMN remember INTEGER NOT NULL DEFAULT 1")
        seed_exam_catalog(connection)
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
        morsel = cookies.get(SESSION_COOKIE)
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

    def session_cookie(self, token, max_age=None):
        cookie = f"{SESSION_COOKIE}={token}; Path=/; HttpOnly; SameSite=Lax"
        if max_age is not None:
            cookie += f"; Max-Age={max_age}"
        if self.headers.get("X-Forwarded-Proto") == "https":
            cookie += "; Secure"
        return {"Set-Cookie": cookie}

    def do_GET(self):
        if self.path == "/api/health":
            self.send_json(HTTPStatus.OK, {"ok": True})
            return
        if self.path == "/api/exams":
            with db_connection() as connection:
                papers = [dict(row) for row in connection.execute(
                    "SELECT * FROM exam_papers ORDER BY year DESC, subject"
                )]
                for paper in papers:
                    paper["items"] = [dict(row) for row in connection.execute(
                        "SELECT number, section, kind, word_limit FROM exam_items "
                        "WHERE paper_id = ? ORDER BY number", (paper["id"],)
                    )]
            self.send_json(HTTPStatus.OK, {"papers": papers, "environment": APP_ENV})
            return
        if self.path == "/api/me":
            user = self.authenticated_user()
            headers = None
            if user:
                token = self.cookie_token()
                timestamp = now()
                with db_connection() as connection:
                    renewed = connection.execute(
                        "UPDATE sessions SET expires_at = ? WHERE token_hash = ? "
                        "AND remember = 1 AND expires_at > ? AND expires_at <= ?",
                        (timestamp + SESSION_SECONDS, token_digest(token),
                         timestamp, timestamp + SESSION_SECONDS // 2),
                    ).rowcount
                if renewed:
                    headers = self.session_cookie(token, SESSION_SECONDS)
            self.send_json(HTTPStatus.OK if user else HTTPStatus.UNAUTHORIZED, {"user": user}, headers)
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
            payload = self.read_json()
            if not isinstance(payload, dict):
                self.send_json(HTTPStatus.BAD_REQUEST, {"error": "无效的登录请求"})
                return
            username = str(payload.get("username", "")).strip()
            password = str(payload.get("password", ""))
            remember = payload.get("remember", True) is True
            with db_connection() as connection:
                row = connection.execute("SELECT id, username, password_hash FROM users WHERE username = ?", (username,)).fetchone()
                valid = bool(row and password_matches(password, row["password_hash"]))
                if valid:
                    token = secrets.token_urlsafe(32)
                    connection.execute(
                        "INSERT INTO sessions(token_hash, user_id, expires_at, created_at, remember) "
                        "VALUES (?, ?, ?, ?, ?)",
                        (token_digest(token), row["id"], now() + SESSION_SECONDS, now(), int(remember)),
                    )
            if not valid:
                self.send_json(HTTPStatus.UNAUTHORIZED, {"error": "用户名或密码不正确"})
                return
            headers = self.session_cookie(token, SESSION_SECONDS if remember else None)
            self.send_json(HTTPStatus.OK, {"user": {"id": row["id"], "username": row["username"]}}, headers)
            return
        if self.path == "/api/auth/logout":
            token = self.cookie_token()
            if token:
                with db_connection() as connection:
                    connection.execute("DELETE FROM sessions WHERE token_hash = ?", (token_digest(token),))
            self.send_json(HTTPStatus.OK, {"ok": True}, self.session_cookie("", 0))
            return
        self.send_json(HTTPStatus.NOT_FOUND, {"error": "未找到接口"})

    def do_PUT(self):
        if self.path != "/api/state":
            self.send_json(HTTPStatus.NOT_FOUND, {"error": "未找到接口"})
            return
        user = self.require_user()
        if not user:
            return
        payload = self.read_json()
        if not isinstance(payload, dict):
            self.send_json(HTTPStatus.BAD_REQUEST, {"error": "无效的学习记录"})
            return
        changes = payload.get("changes")
        state = payload.get("state")
        if changes is not None:
            if payload.get("user_id") != user["id"]:
                self.send_json(HTTPStatus.CONFLICT, {"error": "登录账号已变更"})
                return
            if not isinstance(changes, dict) or any(
                field not in STATE_FIELDS or not isinstance(entries, dict)
                for field, entries in changes.items()
            ):
                self.send_json(HTTPStatus.BAD_REQUEST, {"error": "无效的学习记录"})
                return
        elif not isinstance(state, dict):
            self.send_json(HTTPStatus.BAD_REQUEST, {"error": "state 必须是对象"})
            return
        timestamp = now()
        with db_connection() as connection:
            if changes is not None:
                connection.execute("BEGIN IMMEDIATE")
                row = connection.execute(
                    "SELECT state_json FROM study_state WHERE user_id = ?", (user["id"],)
                ).fetchone()
                state = json.loads(row["state_json"]) if row else {}
                for field, entries in changes.items():
                    records = state.setdefault(field, {})
                    if not isinstance(records, dict):
                        records = state[field] = {}
                    for key, value in entries.items():
                        if value is None:
                            records.pop(key, None)
                        else:
                            records[key] = value
            encoded = json.dumps(state, ensure_ascii=False, separators=(",", ":"))
            connection.execute(
                "INSERT INTO study_state(user_id, state_json, updated_at) VALUES (?, ?, ?) "
                "ON CONFLICT(user_id) DO UPDATE SET state_json = excluded.state_json, updated_at = excluded.updated_at",
                (user["id"], encoded, timestamp),
            )
        self.send_json(HTTPStatus.OK, {"ok": True, "state": state, "updated_at": timestamp})


if __name__ == "__main__":
    initialize_database()
    print(f"Jingkao API listening on {HOST}:{PORT}")
    ThreadingHTTPServer((HOST, PORT), ApiHandler).serve_forever()
