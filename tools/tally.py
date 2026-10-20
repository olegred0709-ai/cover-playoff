"""Подсчёт итогов голосования по экспорту чата с ботом.

Telegram Desktop → чат с ботом → ⋮ → «Экспорт истории чата» (JSON или HTML),
затем:  python tools/tally.py путь/к/result.json  (или messages.html)
"""
import html
import json
import re
import sys
from collections import defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
COVERS_JS = ROOT / "docs" / "covers.js"


def load_titles():
    src = COVERS_JS.read_text(encoding="utf-8")
    covers = json.loads(src[src.index("["): src.rindex("]") + 1])
    return {c["id"]: c["title"] for c in covers}


def main(paths):
    sys.stdout.reconfigure(encoding="utf-8")
    titles = load_titles()
    text = html.unescape("\n".join(Path(p).read_text(encoding="utf-8") for p in paths))

    votes = {}  # id устройства → список пар (победитель, проигравший); повторы с одного устройства схлопываются
    for device, pairs in re.findall(r"#data (\S+) ((?:\d+>\d+\s*)+)", text):
        votes[device] = [tuple(map(int, p.split(">"))) for p in pairs.split()]

    if not votes:
        sys.exit("В файле не нашлось ни одного голоса (строк #data).")

    champ = defaultdict(int)
    final = defaultdict(int)
    wins = defaultdict(int)
    losses = defaultdict(int)
    for matches in votes.values():
        w, l = matches[-1]  # последняя пара — финал
        champ[w] += 1
        final[l] += 1
        for w, l in matches:
            wins[w] += 1
            losses[l] += 1

    def win_rate(c):
        games = wins[c] + losses[c]
        return wins[c] / games if games else 0

    order = sorted(titles, key=lambda c: (champ[c], final[c], win_rate(c)), reverse=True)

    print(f"Голосов: {len(votes)}\n")
    print(f"{'#':>2}  {'Обложка':<30} {'🏆':>3} {'🥈':>3}  {'побед в парах':>13}")
    for i, c in enumerate(order, 1):
        print(f"{i:>2}  {titles[c]:<30} {champ[c]:>3} {final[c]:>3}  {wins[c]:>4}/{wins[c] + losses[c]:<3} {win_rate(c):>4.0%}")


if __name__ == "__main__":
    if len(sys.argv) < 2:
        sys.exit(__doc__)
    main(sys.argv[1:])
