"""
Measure pallet layer-count accuracy against a Cosmos NIM.

This is the instrument for answering "did that change help?" Re-run it after any
prompt edit, sampling change, or fine-tune and compare the summary numbers. Without
a fixed harness, prompt tweaking is guesswork — a VLM's layer count varies run to
run even at temperature 0 (vLLM batching), so single observations prove nothing.

Ground truth comes from the filenames: photos of one pallet share a prefix
(Pallet4.1 .. Pallet4.4), and a `-NN` suffix carries the pallet's bag quantity off
the SKU label (Pallet4-60 = 60 bags). Layers are derived as bags / --bags-per-layer.

    # against a local NIM on the GPU box
    python3 eval.py --src ~/vmimg

    # through the auth proxy from elsewhere
    python3 eval.py --src ./imgs --base http://host:22738/v1 --token "$PROXY_TOKEN"

    # does sampling 3x and taking the median beat a single shot?
    python3 eval.py --src ~/vmimg --samples 3

Stdlib only, so it runs on a bare VM.
"""

import argparse
import base64
import json
import os
import re
import statistics
import sys
import time
import urllib.error
import urllib.request
from collections import defaultdict

PROMPT = "\n".join([
    "You are inspecting one face of a warehouse pallet stacked with bags of product.",
    "Bags sag and occlude each other, so DO NOT try to count individual bags.",
    "Instead reason about the visible stack and report:",
    # Keep this list in sync with PALLET_COUNT_PROMPT in api/src/index.ts. An
    # isPalletFace gate was tried and removed — see the note there.
    "- layers: how many horizontal layers (courses) are stacked, as an integer.",
    # Flaps are the primary count: every bag's flap faces exactly one side, so the
    # four faces sum to the pallet total. Unlike layers this needs no bags-per-layer
    # assumption, which makes it directly checkable against the picklist.
    "- bagFlaps: how many individual bag ends (flaps) are visible on this face? A flap is the folded, sewn end of one bag, usually carrying a small printed batch label. Count each visible flap once. Do NOT count the long printed bag faces, and do not count flaps on other pallets. Integer, or null if you cannot tell.",
    "- topLayerFull: is the top layer complete, or short/partial? boolean.",
    "- gaps: are there obvious missing bags or holes in the stack? boolean.",
    "- damage: any torn, crushed, or leaking bags visible? boolean.",
    "- estimatedBags: your best whole-number estimate of total bags on this face, or null if unsure.",
    "- confidence: your confidence from 0 to 1.",
    "- rationale: one short sentence explaining what you saw.",
    "Answer using the following format:<think>Your reasoning.</think>",
    "Immediately after the </think> tag, write ONLY a JSON object with exactly these keys and no extra text.",
])


def extract_json(text):
    """Same rule as extractJsonObject() in api/src/index.ts — see the note there."""
    body = re.sub(r"<think>.*?</think>", " ", text, flags=re.DOTALL | re.IGNORECASE)
    last, start, depth = None, -1, 0
    for i, ch in enumerate(body):
        if ch == "{":
            if depth == 0:
                start = i
            depth += 1
        elif ch == "}" and depth > 0:
            depth -= 1
            if depth == 0 and start >= 0:
                try:
                    c = json.loads(body[start:i + 1])
                    if isinstance(c, dict) and "layers" in c:
                        last = c
                    elif last is None and isinstance(c, dict):
                        last = c
                except json.JSONDecodeError:
                    pass
                start = -1
    return last


def pallet_of(filename):
    """'Pallet4.2.jpg' -> '4';  'Pallet4-60.jpg' -> '4'."""
    m = re.match(r"[Pp]allet\s*(\d+)", os.path.splitext(filename)[0])
    return m.group(1) if m else os.path.splitext(filename)[0]


def is_closeup(filename):
    """'-NN' marks the dedicated bag-flap close-up slot, not one of the four faces."""
    return bool(re.search(r"-\d+$", os.path.splitext(filename)[0]))


def bags_of(filename):
    """Pallet quantity from a '-NN' suffix, else None."""
    stem = os.path.splitext(filename)[0]
    m = re.search(r"-(\d+)$", stem)
    return int(m.group(1)) if m else None


def ask(base, model, token, jpeg, max_tokens, timeout):
    payload = {
        "model": model,
        "messages": [{"role": "user", "content": [
            {"type": "text", "text": PROMPT},
            {"type": "image_url",
             "image_url": {"url": "data:image/jpeg;base64," + base64.b64encode(jpeg).decode()}},
        ]}],
        "max_tokens": max_tokens,
        "temperature": 0,
    }
    headers = {"Content-Type": "application/json"}
    if token:
        headers["Authorization"] = f"Bearer {token}"
    req = urllib.request.Request(
        f"{base.rstrip('/')}/chat/completions", data=json.dumps(payload).encode(), headers=headers
    )
    t0 = time.time()
    with urllib.request.urlopen(req, timeout=timeout) as r:
        out = json.loads(r.read())
    content = (out.get("choices") or [{}])[0].get("message", {}).get("content", "")
    return extract_json(content), time.time() - t0, out.get("usage", {})


def main():
    p = argparse.ArgumentParser(description="Pallet layer-count accuracy harness.")
    p.add_argument("--src", required=True, help="folder of pre-resized pallet JPEGs")
    p.add_argument("--base", default="http://127.0.0.1:8000/v1")
    p.add_argument("--model", default="nvidia/cosmos3-nano-reasoner")
    p.add_argument("--token", default=os.environ.get("PROXY_TOKEN", ""))
    p.add_argument("--max-tokens", type=int, default=1536)
    p.add_argument("--samples", type=int, default=1,
                   help="requests per image; >1 takes the median (the model is not deterministic)")
    p.add_argument("--bags-per-layer", type=int, default=6,
                   help="used with the filename bag count to derive expected layers")
    p.add_argument("--timeout", type=int, default=300)
    p.add_argument("--out", default="eval-results.json")
    args = p.parse_args()

    names = sorted(n for n in os.listdir(args.src) if n.lower().endswith((".jpg", ".jpeg", ".png")))
    if not names:
        sys.exit(f"no images in {args.src}")

    # Expected layers per pallet, from any face that carries a -NN bag count.
    expected = {}
    for n in names:
        b = bags_of(n)
        if b:
            expected[pallet_of(n)] = round(b / args.bags_per_layer)

    per_pallet = defaultdict(list)
    per_pallet_flaps = defaultdict(list)
    # Bag total per pallet straight off the SKU label, for scoring flap sums.
    expected_bags = {}
    for n in names:
        b = bags_of(n)
        if b:
            expected_bags[pallet_of(n)] = b
    rows, latencies = [], []

    print(f"model={args.model} base={args.base} samples={args.samples}\n")
    print(f"{'file':<20}{'layers':>7}{'exp':>5}{'sec':>7}  note")
    print("-" * 52)

    for n in names:
        path = os.path.join(args.src, n)
        with open(path, "rb") as fh:
            jpeg = fh.read()

        votes, secs, face_flags, flap_votes = [], [], [], []
        err = ""
        for _ in range(args.samples):
            try:
                parsed, elapsed, _usage = ask(
                    args.base, args.model, args.token, jpeg, args.max_tokens, args.timeout
                )
            except urllib.error.HTTPError as e:
                err = f"HTTP {e.code} {e.read().decode(errors='replace')[:120]}"
                break
            except Exception as e:  # noqa: BLE001
                err = str(e)[:120]
                break
            secs.append(elapsed)
            # Only recorded if the prompt actually asks for it, so the gate report
            # stays silent rather than reporting a field nobody returned.
            if parsed is not None and "isPalletFace" in parsed:
                face_flags.append(parsed["isPalletFace"])
            if parsed and isinstance(parsed.get("layers"), int):
                votes.append(parsed["layers"])
            if parsed and isinstance(parsed.get("bagFlaps"), int):
                flap_votes.append(parsed["bagFlaps"])

        # Majority verdict on "is this even a pallet face". False means the count
        # should be thrown away rather than voted on.
        is_face = None
        if face_flags:
            is_face = face_flags.count(True) >= face_flags.count(False)

        pid = pallet_of(n)
        exp = expected.get(pid)
        if not votes:
            print(f"{n:<20}{'-':>7}{exp if exp else '-':>5}{'-':>7}  {err or 'unparseable'}")
            rows.append({"file": n, "pallet": pid, "error": err or "unparseable"})
            continue

        layers = int(statistics.median(votes))
        latencies.extend(secs)
        # A photo the model says is not a pallet face contributes nothing to the
        # pallet's vote — that is the whole point of the gate.
        if is_face is not False:
            per_pallet[pid].append(layers)
        spread = f" spread={sorted(votes)}" if len(set(votes)) > 1 else ""
        if is_face is False:
            mark = "  [gated: not a pallet face]"
        elif exp is None:
            mark = ""
        else:
            mark = "  ok" if layers == exp else f"  MISS by {layers - exp:+d}"
        print(f"{n:<20}{layers:>7}{exp if exp else '-':>5}{statistics.mean(secs):>7.1f}{mark}{spread}")
        flaps = int(statistics.median(flap_votes)) if flap_votes else None
        # Only the four FACE photos contribute to the sum. A '-NN' file is the
        # dedicated bag-flap close-up slot; counting it would double-count bags
        # already counted on whichever face they belong to.
        if flaps is not None and is_face is not False and not is_closeup(n):
            per_pallet_flaps[pid].append(flaps)
        rows.append({"file": n, "pallet": pid, "layers": layers, "votes": votes,
                     "expected": exp, "isPalletFace": is_face, "bagFlaps": flaps})

    # --- summary -----------------------------------------------------------
    # Gate check. In this dataset a '-NN' suffix marks a deliberate close-up of a
    # bag label (Pallet4-60.jpg), so those SHOULD be gated out; PalletN.M files are
    # real pallet faces and should pass.
    # Only meaningful when the prompt actually asked for the flag; otherwise every
    # value is None and the report would invent a 0/N failure out of nothing.
    gated = [r for r in rows if r.get("isPalletFace") is not None]
    if gated:
        print("\n--- isPalletFace gate ---")
        closeups = [r for r in gated if re.search(r"-\d+$", os.path.splitext(r["file"])[0])]
        faces = [r for r in gated if r not in closeups]
        if closeups:
            caught = sum(1 for r in closeups if r["isPalletFace"] is False)
            print(f"  close-ups correctly rejected: {caught}/{len(closeups)}")
            missed = [r["file"] for r in closeups if r["isPalletFace"] is not False]
            if missed:
                print(f"    still counted (bad): {', '.join(missed)}")
        if faces:
            kept = sum(1 for r in faces if r["isPalletFace"] is not False)
            print(f"  real faces kept:              {kept}/{len(faces)}")
            lost = [r["file"] for r in faces if r["isPalletFace"] is False]
            if lost:
                print(f"    wrongly rejected (bad): {', '.join(lost)}")

    print("\n--- per-face accuracy (gated photos excluded) ---")
    scored = [
        r for r in rows
        if r.get("expected") and "layers" in r and r.get("isPalletFace") is not False
    ]
    if scored:
        hits = sum(1 for r in scored if r["layers"] == r["expected"])
        within1 = sum(1 for r in scored if abs(r["layers"] - r["expected"]) <= 1)
        print(f"  exact:    {hits}/{len(scored)} ({100*hits/len(scored):.0f}%)")
        print(f"  within 1: {within1}/{len(scored)} ({100*within1/len(scored):.0f}%)")

    print("\n--- per-pallet, voting across faces ---")
    pallet_hits = pallet_scored = 0
    for pid in sorted(per_pallet, key=lambda x: (len(x), x)):
        vals = per_pallet[pid]
        vote = int(statistics.median(vals))
        exp = expected.get(pid)
        tied = len(set(vals)) > 1 and vals.count(vote) * 2 <= len(vals)
        note = ""
        if exp is not None:
            pallet_scored += 1
            if vote == exp and not tied:
                pallet_hits += 1
                note = "ok"
            else:
                note = "TIE" if tied else f"MISS by {vote - exp:+d}"
        print(f"  pallet {pid:<3} faces={vals} -> {vote}  expected={exp if exp else '-'}  {note}")
    if pallet_scored:
        print(f"  pallets correct: {pallet_hits}/{pallet_scored}")

    # Flaps are scored differently from layers: every bag's flap faces exactly one
    # side, so the four faces should SUM to the pallet total. No bags-per-layer
    # assumption, so this is checkable straight against the SKU label.
    if per_pallet_flaps:
        print("\n--- bag flaps, summed across faces ---")
        hits = scored_n = 0
        for pid in sorted(per_pallet_flaps):
            vals = per_pallet_flaps[pid]
            total = sum(vals)
            exp = expected_bags.get(pid)
            note = ""
            if exp:
                scored_n += 1
                err_pct = 100 * (total - exp) / exp
                if total == exp:
                    hits += 1
                    note = "ok"
                else:
                    note = f"{total - exp:+d} ({err_pct:+.0f}%)"
            print(f"  pallet {pid:<3} faces={vals} sum={total:<4} expected={exp if exp else '-':<4} {note}")
        if scored_n:
            print(f"  exact pallet totals: {hits}/{scored_n}")

    if latencies:
        print(f"\n--- latency ---\n  mean {statistics.mean(latencies):.1f}s  "
              f"max {max(latencies):.1f}s  (Static Web Apps cuts off at 45s)")

    with open(args.out, "w", encoding="utf-8") as fh:
        json.dump({"model": args.model, "samples": args.samples,
                   "bagsPerLayer": args.bags_per_layer, "results": rows,
                   "perPallet": {k: v for k, v in per_pallet.items()}}, fh, indent=2)
    print(f"\nwrote {args.out}")


if __name__ == "__main__":
    main()
