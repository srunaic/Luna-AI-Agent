import json
import os
import subprocess
from datetime import datetime
from typing import Any, Dict, List

import requests
from django.core.management.base import BaseCommand, CommandError

from memory.chroma_client import get_collection
from memory.embeddings import hashing_embedding


def _run_git(args: List[str], cwd: str) -> str:
    proc = subprocess.run(["git", *args], cwd=cwd, capture_output=True, text=True)
    if proc.returncode != 0:
        raise CommandError(f"git {' '.join(args)} failed: {proc.stderr.strip()}")
    return proc.stdout


def _ingest_documents(docs: List[Dict[str, Any]]) -> int:
    col = get_collection()
    ids, texts, metas, embeds = [], [], [], []

    for d in docs:
        did = d["id"]
        text = d["text"]
        meta = d.get("metadata") or {}
        ids.append(did)
        texts.append(text)
        metas.append(meta)
        embeds.append(hashing_embedding(text))

    if not ids:
        return 0
    col.upsert(ids=ids, documents=texts, metadatas=metas, embeddings=embeds)
    return len(ids)


class Command(BaseCommand):
    help = "Ingest local git commit history (and optionally GitHub issues) into ChromaDB memory."

    def add_arguments(self, parser):
        parser.add_argument(
            "--repo-root",
            default=os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", "..", "..")),
            help="Path to the git repo root. Default: project root",
        )
        parser.add_argument("--max-commits", type=int, default=500, help="Max number of commits to ingest")
        parser.add_argument(
            "--include-github-issues",
            action="store_true",
            help="Also ingest GitHub issues via API (requires --github-repo and GITHUB_TOKEN)",
        )
        parser.add_argument("--github-repo", default="", help="GitHub repo in owner/name form")
        parser.add_argument("--github-issues-max", type=int, default=200, help="Max issues to ingest")

    def handle(self, *args, **opts):
        repo_root: str = opts["repo_root"]
        max_commits: int = opts["max_commits"]
        include_issues: bool = bool(opts["include_github_issues"])
        github_repo: str = opts["github_repo"]
        github_issues_max: int = opts["github_issues_max"]

        fmt = "%H%x1f%an%x1f%ae%x1f%ad%x1f%s%x1f%b%x1e"
        out = _run_git(["log", f"-n{max_commits}", f"--pretty=format:{fmt}", "--date=iso-strict"], cwd=repo_root)

        docs: List[Dict[str, Any]] = []
        for rec in out.split("\x1e"):
            rec = rec.strip()
            if not rec:
                continue
            parts = rec.split("\x1f")
            if len(parts) < 6:
                continue
            sha, author, email, date_str, subject, body = parts[0], parts[1], parts[2], parts[3], parts[4], parts[5]
            try:
                dt = datetime.fromisoformat(date_str.replace("Z", "+00:00"))
                iso = dt.isoformat()
            except Exception:
                iso = date_str

            text = f"[commit] {subject}\n\n{body}".strip()
            docs.append(
                {
                    "id": f"git:commit:{sha}",
                    "text": text,
                    "metadata": {"source": "git", "type": "commit", "sha": sha, "author": author, "email": email, "date": iso},
                }
            )

        n_commits = _ingest_documents(docs)
        self.stdout.write(self.style.SUCCESS(f"Ingested commits: {n_commits}"))

        if include_issues:
            if not github_repo:
                raise CommandError("--include-github-issues requires --github-repo owner/name")
            token = os.environ.get("GITHUB_TOKEN", "").strip()
            if not token:
                raise CommandError("GITHUB_TOKEN env var is required to ingest GitHub issues.")

            headers = {
                "Authorization": f"Bearer {token}",
                "Accept": "application/vnd.github+json",
                "X-GitHub-Api-Version": "2022-11-28",
            }

            issues_docs: List[Dict[str, Any]] = []
            page = 1
            per_page = 100
            fetched = 0
            while fetched < github_issues_max:
                url = f"https://api.github.com/repos/{github_repo}/issues"
                resp = requests.get(
                    url,
                    headers=headers,
                    params={"state": "all", "per_page": per_page, "page": page, "sort": "updated", "direction": "desc"},
                    timeout=30,
                )
                if resp.status_code != 200:
                    raise CommandError(f"GitHub issues fetch failed: {resp.status_code} {resp.text[:500]}")

                items = resp.json()
                if not items:
                    break

                for it in items:
                    if "pull_request" in it:
                        continue
                    num = it.get("number")
                    title = it.get("title") or ""
                    body = it.get("body") or ""
                    user = (it.get("user") or {}).get("login")
                    updated_at = it.get("updated_at")
                    state = it.get("state")

                    text = f"[issue #{num}] {title}\n\n{body}".strip()
                    issues_docs.append(
                        {
                            "id": f"github:issue:{github_repo}#{num}",
                            "text": text,
                            "metadata": {"source": "github", "type": "issue", "repo": github_repo, "number": num, "user": user, "state": state, "updated_at": updated_at},
                        }
                    )
                    fetched += 1
                    if fetched >= github_issues_max:
                        break

                page += 1

            n_issues = _ingest_documents(issues_docs)
            self.stdout.write(self.style.SUCCESS(f"Ingested issues: {n_issues}"))

        try:
            from django.conf import settings

            self.stdout.write(
                json.dumps(
                    {"LUNA_CHROMA_PATH": getattr(settings, "LUNA_CHROMA_PATH", None), "LUNA_CHROMA_COLLECTION": getattr(settings, "LUNA_CHROMA_COLLECTION", None)},
                    ensure_ascii=False,
                )
            )
        except Exception:
            pass
