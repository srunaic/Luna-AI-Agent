"""
Luna RL Controller (MVP)

Goal:
- Keep Ollama as the text/code generation engine.
- Add a lightweight Reinforcement Learning (Q-learning) controller that selects
  a "strategy card" (discrete action) before the LLM call.
- Receive user feedback (?몟/?몠/?닿껐?? as reward to update Q(s,a).

Why stdlib only?
- Packaged builds already depend on Python for Django; adding pip deps for FastAPI
  is fragile. This server uses only Python stdlib (http.server).
"""

from __future__ import annotations

import argparse
import json
import os
import random
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from typing import Any, Dict, List, Optional, Tuple


def _json_dumps(obj: Any) -> bytes:
    return json.dumps(obj, ensure_ascii=False, separators=(",", ":")).encode("utf-8")


def _stable_key(state: Dict[str, Any]) -> str:
    # Stable, compact state key for Q-table
    return json.dumps(state or {}, ensure_ascii=False, sort_keys=True, separators=(",", ":"))


class QTable:
    def __init__(
        self,
        alpha: float = 0.25,
        gamma: float = 0.9,
        epsilon: float = 0.15,
        epsilon_min: float = 0.02,
        epsilon_decay: float = 0.9995,
    ) -> None:
        self.alpha = float(alpha)
        self.gamma = float(gamma)
        self.epsilon = float(epsilon)
        self.epsilon_min = float(epsilon_min)
        self.epsilon_decay = float(epsilon_decay)

        self._lock = threading.Lock()
        self._q: Dict[str, Dict[str, float]] = {}
        self._stats = {
            "started_at": time.time(),
            "select_calls": 0,
            "feedback_calls": 0,
            "last_save_at": None,
            "last_error": None,
        }

    def load(self, path: str) -> None:
        try:
            if not os.path.exists(path):
                return
            with open(path, "r", encoding="utf-8") as f:
                data = json.load(f)
            if isinstance(data, dict):
                self._q = {str(k): {str(ak): float(av) for ak, av in (v or {}).items()} for k, v in data.items()}
        except Exception as e:
            self._stats["last_error"] = f"load: {e}"

    def save(self, path: str) -> None:
        try:
            os.makedirs(os.path.dirname(path), exist_ok=True)
            tmp = path + ".tmp"
            with open(tmp, "w", encoding="utf-8") as f:
                json.dump(self._q, f, ensure_ascii=False, indent=2, sort_keys=True)
            os.replace(tmp, path)
            self._stats["last_save_at"] = time.time()
        except Exception as e:
            self._stats["last_error"] = f"save: {e}"

    def select_action(self, state: Dict[str, Any], actions: List[str]):
        sk = _stable_key(state)
        actions = [a for a in actions if isinstance(a, str) and a.strip()]
        if not actions:
            return "korean_step_by_step", {}

        with self._lock:
            self._stats["select_calls"] += 1
            row = self._q.setdefault(sk, {})
            for a in actions:
                row.setdefault(a, 0.0)

            explore = random.random() < self.epsilon
            if explore:
                chosen = random.choice(actions)
            else:
                chosen = max(actions, key=lambda a: row.get(a, 0.0))

            self.epsilon = max(self.epsilon_min, self.epsilon * self.epsilon_decay)
            qvals = {a: float(row.get(a, 0.0)) for a in actions}
            return chosen, qvals

    def update(
        self,
        state: Dict[str, Any],
        action: str,
        reward: float,
        next_state: Optional[Dict[str, Any]] = None,
        next_actions: Optional[List[str]] = None,
        done: bool = True,
    ) -> None:
        sk = _stable_key(state)
        a = str(action)
        r = float(reward)
        nsk = _stable_key(next_state) if isinstance(next_state, dict) else None
        next_actions = next_actions or []

        with self._lock:
            self._stats["feedback_calls"] += 1
            row = self._q.setdefault(sk, {})
            old = float(row.get(a, 0.0))

            if done or not nsk:
                target = r
            else:
                nrow = self._q.setdefault(nsk, {})
                for na in next_actions:
                    if isinstance(na, str) and na.strip():
                        nrow.setdefault(na, 0.0)
                max_next = max([float(nrow.get(na, 0.0)) for na in next_actions], default=0.0)
                target = r + self.gamma * max_next

            new = (1.0 - self.alpha) * old + self.alpha * target
            row[a] = float(new)

    def status(self) -> Dict[str, Any]:
        with self._lock:
            return {
                "alpha": self.alpha,
                "gamma": self.gamma,
                "epsilon": self.epsilon,
                "epsilon_min": self.epsilon_min,
                "epsilon_decay": self.epsilon_decay,
                "states": len(self._q),
                "stats": dict(self._stats),
            }


class RLHandler(BaseHTTPRequestHandler):
    server_version = "LunaRL/0.1"

    def _send(self, code: int, obj: Any) -> None:
        body = _json_dumps(obj)
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _read_json(self) -> Any:
        ln = int(self.headers.get("Content-Length", "0") or "0")
        raw = self.rfile.read(ln) if ln > 0 else b"{}"
        try:
            return json.loads(raw.decode("utf-8"))
        except Exception:
            return {}

    def log_message(self, fmt: str, *args: Any) -> None:
        if os.environ.get("LUNA_RL_VERBOSE") == "1":
            super().log_message(fmt, *args)

    def do_GET(self) -> None:
        if self.path == "/health":
            self._send(200, {"ok": True})
            return
        if self.path == "/status":
            st = self.server.qtable.status()  # type: ignore[attr-defined]
            self._send(200, {"ok": True, "status": st})
            return
        self._send(404, {"ok": False, "error": "not_found"})

    def do_POST(self) -> None:
        if self.path == "/select_action":
            data = self._read_json() or {}
            state = data.get("state") or {}
            actions = data.get("actions") or []
            chosen, qvals = self.server.qtable.select_action(state, actions)  # type: ignore[attr-defined]
            self._send(200, {"ok": True, "action": chosen, "q": qvals})
            return

        if self.path == "/feedback":
            data = self._read_json() or {}
            state = data.get("state") or {}
            action = data.get("action") or ""
            reward = data.get("reward") or 0.0
            next_state = data.get("next_state")
            next_actions = data.get("next_actions") or []
            done = bool(data.get("done", True))

            self.server.qtable.update(state, action, reward, next_state, next_actions, done)  # type: ignore[attr-defined]
            self.server.save_if_due()  # type: ignore[attr-defined]
            self._send(200, {"ok": True})
            return

        self._send(404, {"ok": False, "error": "not_found"})


class RLServer(ThreadingHTTPServer):
    def __init__(self, server_address: Tuple[str, int], qtable: QTable, save_path: str) -> None:
        super().__init__(server_address, RLHandler)
        self.qtable = qtable
        self.save_path = save_path
        self._last_save = 0.0

    def save_if_due(self) -> None:
        now = time.time()
        if now - self._last_save < 2.0:
            return
        self._last_save = now
        self.qtable.save(self.save_path)


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--host", default="127.0.0.1")
    ap.add_argument("--port", type=int, default=int(os.environ.get("LUNA_RL_PORT", "8765")))
    ap.add_argument("--data-dir", default=os.environ.get("LUNA_RL_DATA_DIR", "./.luna_rl"))
    args = ap.parse_args()

    data_dir = os.path.abspath(args.data_dir)
    save_path = os.path.join(data_dir, "q_table.json")

    qt = QTable()
    qt.load(save_path)

    srv = RLServer((args.host, int(args.port)), qt, save_path)
    srv.serve_forever(poll_interval=0.25)


if __name__ == "__main__":
    main()
