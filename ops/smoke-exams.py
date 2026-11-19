"""Verify the staging app and answer storage through the staging Nginx port."""
import json
from http.cookiejar import CookieJar
from pathlib import Path
from urllib.request import HTTPCookieProcessor, Request, build_opener


ORIGIN = "http://127.0.0.1:8088"
opener = build_opener(HTTPCookieProcessor(CookieJar()))


def request(path, method="GET", data=None):
    body = json.dumps(data).encode() if data is not None else None
    headers = {"Content-Type": "application/json"} if body is not None else {}
    with opener.open(Request(ORIGIN + path, body, headers, method=method), timeout=10) as response:
        return response.read().decode()


def api(path, method="GET", data=None):
    return json.loads(request("/api/" + path, method, data))


assert 'id="examMenu"' in request("/")
assert "function recordExamAnswer" in request("/journal.js?v=6")
catalog = api("exams")
assert catalog["environment"] == "staging"
papers = {paper["id"]: paper for paper in catalog["papers"]}
assert len(papers["beijing-2022-xingce"]["items"]) == 135
assert len(papers["beijing-2022-shenlun"]["items"]) == 4

credentials = dict(line.split("=", 1) for line in Path("/etc/jingkao-staging.env").read_text().splitlines() if line)
account = api("auth/login", "POST", {
    "username": credentials["JINGKAO_ADMIN_USER"],
    "password": credentials["JINGKAO_ADMIN_PASSWORD"],
})["user"]
keys = ["beijing-2022-xingce:26", "beijing-2022-shenlun:1"]
before = api("state")["state"].get("examAnswers", {})
try:
    changes = dict(zip(keys, ["AC", "测试作答"]))
    api("state", "PUT", {"user_id": account["id"], "changes": {"examAnswers": changes}})
    saved = api("state")["state"]["examAnswers"]
    assert all(saved[key] == value for key, value in changes.items())
finally:
    api("state", "PUT", {
        "user_id": account["id"], "changes": {"examAnswers": {key: before.get(key) for key in keys}}
    })
    api("auth/logout", "POST")
print("Staging passed: two papers, 139 item records, login, save and read both answer types.")
