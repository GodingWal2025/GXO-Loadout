"""
Measure the multi-face pallet assessment — flaps, interior, boxes, condition.

Sends all of a pallet's face photos in ONE request (Cosmos takes up to 5 images) and
scores the result against the bag total in the filenames. Ground truth here is
directly checkable, unlike layers: every bag's flap faces exactly one side, so the
faces should SUM to the pallet quantity, with no bags-per-layer assumption.

Runs against the NIM directly (or via the auth proxy). Each capability can be
switched off, because adding fields to this model's prompt has degraded other
fields before — isolate before believing.

    python3 eval_assess.py --src ~/vmimg
    python3 eval_assess.py --src ./imgs --base http://host:22738/v1 --token "$PROXY_TOKEN"
    python3 eval_assess.py --src ./imgs --no-boxes      # is the tally better alone?
    python3 eval_assess.py --src ./imgs --no-condition  # does condition cost accuracy?

Stdlib only.
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

FACE_ORDER = ["1", "2", "3", "4"]  # PalletN.1 .. PalletN.4


def pallet_of(name):
    m = re.match(r"[Pp]allet\s*(\d+)", os.path.splitext(name)[0])
    return m.group(1) if m else None


def face_of(name):
    """'Pallet4.2.jpg' -> '2'. None for the '-NN' bag-flap close-up slot."""
    stem = os.path.splitext(name)[0]
    if re.search(r"-\d+$", stem):
        return None
    m = re.match(r"[Pp]allet\s*\d+\.(\d+)$", stem)
    return m.group(1) if m else None


def bags_of(name):
    m = re.search(r"-(\d+)$", os.path.splitext(name)[0])
    return int(m.group(1)) if m else None


def extract_json(text):
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
                    if isinstance(c, dict) and ("faces" in c or "visibleBagTotal" in c):
                        last = c
                    elif last is None and isinstance(c, dict):
                        last = c
                except json.JSONDecodeError:
                    pass
                start = -1
    return last


def build_prompt(boxes, interior, condition):
    """Mirror buildAssessPrompt() in api/src/index.ts — keep the two in sync."""
    lines = [
        "You are inspecting ONE warehouse pallet stacked with bags of product.",
        "You are given several photos of the SAME pallet from different sides, labelled in order.",
        "They show one rigid object, so reason across them together: a bag counted on one side must not be counted again on another.",
        "",
        "Report a JSON object with these keys:",
        "- faces: an array with one entry per photo, in the order given, each { index, bagFlaps, layers }.",
        "    * bagFlaps: the number of individual bag ENDS (flaps) visible on that side. A flap is the folded, sewn end of one bag, usually carrying a small printed batch label. Do NOT count the long printed bag faces, and ignore other pallets in the background.",
        "    * layers: how many horizontal courses are stacked, as seen on that side.",
    ]
    if boxes:
        lines.append(
            "    * flapBoxes: one box per visible flap, as [x1, y1, x2, y2] NORMALISED to 0-1 of that photo's width and height. Be exhaustive and do not merge adjacent flaps into one box. bagFlaps must equal the number of boxes."
        )
    lines.append("- visibleBagTotal: the sum of bagFlaps across all faces, as an integer.")
    if interior:
        lines += [
            "- interiorBags: bags fully enclosed by the outer ring and therefore not visible on ANY face, as an integer (0 if the stack is only one bag deep).",
            "- estimatedPalletTotal: visibleBagTotal + interiorBags.",
        ]
    if condition:
        lines += [
            "- leaning: is the stack visibly tilted or slumped to one side? boolean.",
            "- overhang: does any bag or course extend past the edge of the wooden pallet? boolean.",
            "- wrapIntact: is the stretch wrap fully intact, i.e. NOT torn, cut, or hanging loose? boolean.",
            "- loadStable: taken as a whole, would this load stay put during normal transit? boolean.",
            "- conditionNotes: one short sentence on anything physically wrong, or null if nothing is.",
        ]
    lines += [
        "- gaps: are there obvious missing bags or holes in the stack? boolean.",
        "- damage: any torn, crushed, or leaking bags visible? boolean.",
        "- topLayerFull: is the top course complete rather than short/partial? boolean.",
        "- confidence: your confidence from 0 to 1.",
        "- rationale: one short sentence explaining what you saw.",
        "Answer using the following format:<think>Your reasoning.</think>",
        "Immediately after the </think> tag, write ONLY the JSON object and no extra text.",
    ]
    return "\n".join(lines)


def main():
    p = argparse.ArgumentParser(description="Multi-face pallet assessment harness.")
    p.add_argument("--src", required=True, help="folder of pre-resized pallet JPEGs")
    p.add_argument("--base", default="http://127.0.0.1:8000/v1")
    p.add_argument("--model", default="nvidia/cosmos3-nano-reasoner")
    p.add_argument("--token", default=os.environ.get("PROXY_TOKEN", ""))
    p.add_argument("--max-tokens", type=int, default=4096)
    p.add_argument("--timeout", type=int, default=600)
    p.add_argument("--no-boxes", action="store_true")
    p.add_argument("--no-interior", action="store_true")
    p.add_argument("--no-condition", action="store_true")
    p.add_argument("--out", default="assess-results.json")
    args = p.parse_args()

    want = (not args.no_boxes, not args.no_interior, not args.no_condition)
    prompt = build_prompt(*want)

    # Group the four face photos per pallet; the '-NN' close-up only supplies truth.
    groups, truth = defaultdict(dict), {}
    for n in sorted(os.listdir(args.src)):
        if not n.lower().endswith((".jpg", ".jpeg", ".png")):
            continue
        pid = pallet_of(n)
        if not pid:
            continue
        b = bags_of(n)
        if b:
            truth[pid] = b
        f = face_of(n)
        if f:
            groups[pid][f] = os.path.join(args.src, n)

    if not groups:
        sys.exit(f"no PalletN.M face photos found in {args.src}")

    print(f"model={args.model}  boxes={want[0]} interior={want[1]} condition={want[2]}\n")
    rows, latencies = [], []

    for pid in sorted(groups, key=int):
        faces = [groups[pid][f] for f in FACE_ORDER if f in groups[pid]]
        if not faces:
            continue

        content = [{"type": "text", "text": prompt}]
        for i, path in enumerate(faces):
            with open(path, "rb") as fh:
                b64 = base64.b64encode(fh.read()).decode()
            content.append({"type": "text", "text": f"Photo {i} ({os.path.basename(path)}):"})
            content.append({"type": "image_url", "image_url": {"url": f"data:image/jpeg;base64,{b64}"}})

        headers = {"Content-Type": "application/json"}
        if args.token:
            headers["Authorization"] = f"Bearer {args.token}"
        req = urllib.request.Request(
            f"{args.base.rstrip('/')}/chat/completions",
            data=json.dumps({
                "model": args.model,
                "messages": [{"role": "user", "content": content}],
                "max_tokens": args.max_tokens,
                "temperature": 0,
            }).encode(),
            headers=headers,
        )

        t0 = time.time()
        try:
            with urllib.request.urlopen(req, timeout=args.timeout) as r:
                out = json.loads(r.read())
        except urllib.error.HTTPError as e:
            print(f"pallet {pid}: HTTP {e.code} {e.read().decode(errors='replace')[:160]}")
            continue
        except Exception as e:  # noqa: BLE001
            print(f"pallet {pid}: {e}")
            continue
        el = time.time() - t0
        latencies.append(el)

        raw = (out.get("choices") or [{}])[0].get("message", {}).get("content", "")
        parsed = extract_json(raw)
        if not parsed:
            print(f"pallet {pid}: unparseable ({len(raw)} chars) {raw[:120]!r}")
            rows.append({"pallet": pid, "raw": raw[:2000]})
            continue

        pf = parsed.get("faces") or []
        tallies = [f.get("bagFlaps") for f in pf if isinstance(f.get("bagFlaps"), int)]
        boxcounts = [len(f.get("flapBoxes") or []) for f in pf]
        tally_sum = sum(tallies)
        box_sum = sum(boxcounts)
        exp = truth.get(pid)

        def score(v):
            if not exp or not v:
                return ""
            return "ok" if v == exp else f"{v - exp:+d} ({100*(v-exp)/exp:+.0f}%)"

        print(f"pallet {pid}  {len(faces)} faces  {el:5.1f}s")
        print(f"   flap tallies {tallies} sum={tally_sum:<4} expected={exp}  {score(tally_sum)}")
        if want[0]:
            print(f"   boxes located {boxcounts} sum={box_sum:<4} {score(box_sum)}")
        if want[1]:
            print(f"   interior={parsed.get('interiorBags')} total={parsed.get('estimatedPalletTotal')}"
                  f"  {score(parsed.get('estimatedPalletTotal'))}")
        if want[2]:
            print(f"   lean={parsed.get('leaning')} overhang={parsed.get('overhang')} "
                  f"wrapIntact={parsed.get('wrapIntact')} stable={parsed.get('loadStable')}")
            if parsed.get("conditionNotes"):
                print(f"   notes: {parsed['conditionNotes']}")
        print(f"   layers per face {[f.get('layers') for f in pf]}")

        rows.append({
            "pallet": pid, "faces": len(faces), "seconds": round(el, 1), "expected": exp,
            "flapTallies": tallies, "flapTallySum": tally_sum,
            "boxCounts": boxcounts, "boxSum": box_sum,
            "interiorBags": parsed.get("interiorBags"),
            "estimatedPalletTotal": parsed.get("estimatedPalletTotal"),
            "leaning": parsed.get("leaning"), "overhang": parsed.get("overhang"),
            "wrapIntact": parsed.get("wrapIntact"), "loadStable": parsed.get("loadStable"),
            "conditionNotes": parsed.get("conditionNotes"),
            "layers": [f.get("layers") for f in pf],
        })

    scored = [r for r in rows if r.get("expected")]
    if scored:
        print("\n--- summary ---")
        for key, label in (("flapTallySum", "flap tally"), ("boxSum", "located boxes"),
                           ("estimatedPalletTotal", "tally + interior")):
            vals = [(r[key], r["expected"]) for r in scored if isinstance(r.get(key), int) and r[key]]
            if not vals:
                continue
            exact = sum(1 for v, e in vals if v == e)
            mape = statistics.mean(100 * abs(v - e) / e for v, e in vals)
            print(f"  {label:<18} exact {exact}/{len(vals)}   mean abs error {mape:.0f}%")
    if latencies:
        print(f"\n  latency mean {statistics.mean(latencies):.1f}s  max {max(latencies):.1f}s"
              f"   (Static Web Apps cuts off at 45s)")

    with open(args.out, "w", encoding="utf-8") as fh:
        json.dump({"model": args.model, "boxes": want[0], "interior": want[1],
                   "condition": want[2], "results": rows}, fh, indent=2)
    print(f"\nwrote {args.out}")


if __name__ == "__main__":
    main()
