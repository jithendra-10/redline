"""Generates assets/architecture.svg: the Redline workflow with animated, moving arrows.

Every connector is a flowing dashed line with arrowheads that travel along it
(SMIL animateMotion, rotate="auto"), so the diagram reads as a live workflow.
All animation periods divide 3 s, so a 3 s capture loops seamlessly (GIF).
Run: python scripts/architecture.py
"""
import pathlib

W, H = 960, 640
out = pathlib.Path(__file__).resolve().parent.parent / "assets" / "architecture.svg"

CSS = """
    .bg { fill: #fbf8f0; }
    .zone { fill: #ffffff; stroke: #d9d1bd; stroke-width: 1.5; }
    .zone2 { fill: #f3f0e6; stroke: #d9d1bd; stroke-width: 1.5; stroke-dasharray: 6 5; }
    .node { fill: #ffffff; stroke: #cfc6b0; stroke-width: 1.5; }
    .nano { fill: #e8f5ee; stroke: #1f7a4d; stroke-width: 2; }
    .cloud { fill: #e8eefc; stroke: #1d4ed8; stroke-width: 2; }
    .key { fill: #fff4f5; stroke: #c8102e; stroke-width: 2; }
    .zl { font: 700 12.5px system-ui, -apple-system, "Segoe UI", sans-serif; letter-spacing: .12em; fill: #7a7363; }
    .h { font: 700 16px system-ui, -apple-system, "Segoe UI", sans-serif; fill: #1d1b16; }
    .s { font: 400 13px system-ui, -apple-system, "Segoe UI", sans-serif; fill: #5f594c; }
    .m { font: 600 12.5px ui-monospace, "Cascadia Code", Menlo, monospace; fill: #1f7a4d; }
    .lbl { font: 700 11.5px system-ui, -apple-system, "Segoe UI", sans-serif; }
    .g { stroke: #1f7a4d; } .gf { fill: #1f7a4d; }
    .b { stroke: #1d4ed8; } .bf { fill: #1d4ed8; }
    .y { stroke: #8a8475; } .yf { fill: #8a8475; }
    .track { fill: none; stroke-width: 7; opacity: .13; stroke-linecap: round; }
    .flow { fill: none; stroke-width: 2.6; stroke-dasharray: 8 7; stroke-linecap: round; animation: dash .75s linear infinite; }
    .slow { animation-duration: 1.5s; }
    @keyframes dash { to { stroke-dashoffset: -15; } }
    .pulse { animation: pulse 3s ease-in-out infinite; }
    @keyframes pulse { 50% { stroke-width: 4; } }
    @media (prefers-color-scheme: dark) {
      .bg { fill: #14130f; }
      .zone { fill: #1d1b16; stroke: #3a362d; }
      .zone2 { fill: #191813; stroke: #3a362d; }
      .node { fill: #24221b; stroke: #403b31; }
      .nano { fill: #15291e; stroke: #5fd39a; }
      .cloud { fill: #18203a; stroke: #8fb0ff; }
      .key { fill: #2c1418; stroke: #ff5468; }
      .zl { fill: #a39d8e; } .h { fill: #f1ede2; } .s { fill: #b5ae9e; } .m { fill: #5fd39a; }
      .g { stroke: #5fd39a; } .gf { fill: #5fd39a; }
      .b { stroke: #8fb0ff; } .bf { fill: #8fb0ff; }
      .y { stroke: #a39d8e; } .yf { fill: #a39d8e; }
      .track { opacity: .2; }
    }
    @media (prefers-reduced-motion: reduce) { .flow, .pulse { animation: none; } .mover { display: none; } }
"""

parts = []
add = parts.append


def node(x, y, w, h, title, sub, cls="node", subcls="s"):
    add(f'  <rect class="{cls}" x="{x}" y="{y}" width="{w}" height="{h}" rx="11"/>')
    add(f'  <text class="h" x="{x+16}" y="{y+29}">{title}</text>')
    for i, line in enumerate(sub if isinstance(sub, list) else [sub]):
        c = subcls if i == 0 else "s"
        add(f'  <text class="{c}" x="{x+16}" y="{y+51+i*19}">{line}</text>')


n_path = 0


def arrow(d, color, period=1.5, heads=2, slow=False, label=None):
    """A connector: faint track + flowing dashes + arrowheads moving along it."""
    global n_path
    n_path += 1
    pid = f"p{n_path}"
    add(f'  <path class="track {color}" d="{d}"/>')
    add(f'  <path id="{pid}" class="flow {color}{" slow" if slow else ""}" d="{d}"/>')
    add(f'  <g class="mover">')
    for k in range(heads):
        begin = -period * k / heads
        add(f'    <path class="{color}f" d="M-8,-6.5 L6,0 L-8,6.5 L-4.5,0 z">'
            f'<animateMotion dur="{period}s" begin="{begin:.3f}s" repeatCount="indefinite" rotate="auto">'
            f'<mpath href="#{pid}"/></animateMotion></path>')
    add('  </g>')
    if label:
        x, y, text = label
        add(f'  <text class="lbl {color}f" x="{x}" y="{y}">{text}</text>')


# zones
add(f'  <rect class="bg" width="{W}" height="{H}" rx="16"/>')
add('  <rect class="zone" x="16" y="16" width="624" height="608" rx="14"/>')
add('  <text class="zl" x="36" y="44">YOUR LAPTOP · CHROME</text>')
add('  <rect class="zone2" x="660" y="16" width="284" height="608" rx="14"/>')
add('  <text class="zl" x="680" y="44">OUTSIDE THE LAPTOP</text>')

# laptop nodes
node(36, 66, 180, 72, "① You paste / type", "ChatGPT · Gemini · Claude")
node(246, 66, 180, 72, "② Redline holds it", "content script, nothing sent")
node(456, 66, 168, 72, "③ On-device worker", "Firebase AI Logic")
node(246, 186, 180, 72, "Pattern rules", "emails · phones · IDs · $")
node(456, 186, 168, 72, "🔒 Gemini Nano", "ONLY_ON_DEVICE", cls="nano pulse", subcls="m")
add('  <rect class="key" x="246" y="306" width="378" height="76" rx="11"/>')
add('  <text class="h" x="262" y="335">④ Placeholders that keep meaning</text>')
add('  <text class="m" x="262" y="361">[PERSON_1 · client]  [FINANCIAL_1 · $1M–10M]</text>')
node(456, 430, 168, 72, "⑤ Send", "the redacted version")
node(456, 536, 168, 72, "⑥ Show real names", "restored in this tab only")

# outside nodes
node(680, 66, 244, 72, "Remote Config", "org policy, live in seconds")
node(680, 176, 244, 72, "Firestore audit log", "counts only, never text")
node(680, 288, 244, 106, "☁ Gemini in the cloud", ["PREFER_IN_CLOUD", "re-identification check", "falls back to Nano if offline"],
     cls="cloud", subcls="m bf")
node(680, 430, 244, 72, "AI chatbot", "sees placeholders only")

# legend + notes
add('  <text class="zl" x="36" y="214">LEGEND</text>')
for i, (c, t) in enumerate([("g", "raw text, stays here"), ("b", "redacted text only"), ("y", "policy &amp; counts")]):
    y = 240 + i * 30
    arrow(f"M36 {y} H92", c, heads=1, slow=(c != "g"))
    add(f'  <text class="s" x="102" y="{y+4}">{t}</text>')
add('  <text class="s" x="36" y="358">Patterns are exact and</text>')
add('  <text class="s" x="36" y="376">always win; Nano finds</text>')
add('  <text class="s" x="36" y="394">names, orgs, diagnoses.</text>')
add('  <text class="s" x="36" y="440">The mapping</text>')
add('  <text class="m" x="36" y="460">PERSON_1 → Priya Shah</text>')
add('  <text class="s" x="36" y="480">never leaves the tab.</text>')

# raw text, on the laptop (green, fast)
arrow("M218 102 H242", "g", period=0.75, heads=1)
arrow("M428 102 H452", "g", period=0.75, heads=1)
arrow("M540 140 V182", "g", period=0.75, heads=1)
arrow("M500 140 C500 164 336 160 336 182", "g", period=1.5)
arrow("M336 260 V302", "g", period=0.75, heads=1)
arrow("M540 260 V302", "g", period=0.75, heads=1)
arrow("M540 384 V426", "g", period=0.75, heads=1)

# redacted text leaves the laptop (blue)
arrow("M626 466 H676", "b", period=0.75, heads=1)
add('  <text class="lbl bf" x="627" y="458" style="font-size:10.5px">redacted</text>')
arrow("M802 504 V572 H628", "b", period=1.5, heads=3, label=(648, 564, "reply with placeholders"))
arrow("M626 326 H676", "b", period=1.5, slow=True)
arrow("M680 364 H628", "b", period=1.5, slow=True)
add('  <text class="lbl bf" x="627" y="318" style="font-size:10.5px">risk check</text>')

# policy in, counts out (grey)
arrow("M680 102 H628", "y", period=1.5, slow=True)
arrow("M600 140 C600 200 640 212 676 212", "y", period=1.5, slow=True)

svg = f'''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {W} {H}" width="{W}" height="{H}" role="img" aria-labelledby="t d">
  <title id="t">How Redline works</title>
  <desc id="d">Animated workflow. Raw text from an AI chat box goes from the content script to an on-device worker, where pattern rules and Gemini Nano (ONLY_ON_DEVICE) replace sensitive details with meaning-preserving placeholders. Only redacted text is sent to the AI chatbot; its reply is re-hydrated locally. Redacted text may go to Gemini in the cloud (PREFER_IN_CLOUD, falling back to Nano) for a re-identification check. Remote Config delivers policy; Firestore receives counts only.</desc>
  <style>{CSS}  </style>
{chr(10).join(parts)}
</svg>
'''
out.write_text(svg, encoding="utf-8")
print(f"wrote {out} ({len(svg)} bytes, {n_path} animated connectors)")
