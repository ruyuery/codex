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
assert 'id="examStart"' in request("/")
assert "function bindExamMode" in request("/exam-mode.js?v=1")
catalog = api("exams")
assert catalog["environment"] == "staging"
papers = {paper["id"]: paper for paper in catalog["papers"]}
assert len(papers["beijing-2022-xingce"]["items"]) == 135
assert len(papers["beijing-2022-shenlun"]["items"]) == 4
sample_id = "jingkao-original-mini-01"
assert papers[sample_id]["ready"]
questions = api("exams/" + sample_id + "/practice")["questions"]
assert len(questions) == 8
assert questions[4]["answer"] == "AC"
assert all(question["stem"] and question["options"] and question["analysis"] for question in questions)
assert "answer" not in papers[sample_id]["items"][0]

credentials = dict(line.split("=", 1) for line in Path("/etc/jingkao-staging.env").read_text().splitlines() if line)
account = api("auth/login", "POST", {
    "username": credentials["JINGKAO_ADMIN_USER"],
    "password": credentials["JINGKAO_ADMIN_PASSWORD"],
})["user"]
keys = ["beijing-2022-xingce:26", "beijing-2022-shenlun:1"]
before = api("state")["state"]
changes = {
    "examAnswers": dict(zip(keys, ["AC", "测试作答"])),
    "examPrivatePapers": {"smoke-test-paper": {"id": "smoke-test-paper", "questions": questions[:1]}},
    "examResults": {"smoke-test-result": {"paperId": sample_id, "scores": {"total": 8, "wrong": 1}}},
}
try:
    api("state", "PUT", {"user_id": account["id"], "changes": changes})
    saved = api("state")["state"]
    for field, entries in changes.items():
        assert all(saved[field][key] == value for key, value in entries.items())
    assert "smoke-test-paper" not in request("/api/exams")
finally:
    api("state", "PUT", {
        "user_id": account["id"], "changes": {
            field: {key: before.get(field, {}).get(key) for key in entries}
            for field, entries in changes.items()
        },
    })
    api("auth/logout", "POST")
print("Staging passed: legacy papers, practice questions, account-scoped imports and persisted scores.")
