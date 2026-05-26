#!/usr/bin/env python3
"""
merge-enhance.py — produce a clean assets/ahdd-enhance.js that combines
origin/main (latest nav/SERVICES updates) with feature/chatbot-callback-handoff
(escalation flow). Run from the repo root.

Outputs the merged file to assets/ahdd-enhance.js (overwrites in place).
"""
import subprocess, sys, re, pathlib

repo = pathlib.Path(__file__).resolve().parent.parent
target = repo / 'assets' / 'ahdd-enhance.js'

def git_show(ref, path):
    r = subprocess.run(['git', 'show', f'{ref}:{path}'], cwd=repo,
                       capture_output=True, text=True, check=True)
    return r.stdout

main_src = git_show('origin/main', 'assets/ahdd-enhance.js')
ours_src = git_show('origin/feature/chatbot-callback-handoff', 'assets/ahdd-enhance.js')

# 1) Header comment — replace main's header with ours (lists feature #5)
ours_header = re.search(
    r'/\* ───.*?── \*/',
    ours_src, re.DOTALL).group(0)
main_header = re.search(
    r'/\* ───.*?── \*/',
    main_src, re.DOTALL).group(0)
merged = main_src.replace(main_header, ours_header, 1)

# 2) Replace the quick-pick click handler in main with ours.
#    Main's handler is the simple one (just snd.click()); ours intercepts
#    'Talk to a human' to start escalation.
main_click = re.search(
    r"b\.addEventListener\('click', function\(\)\{\s*"
    r"if \(inp && snd\) \{\s*"
    r"inp\.value = q\.text;\s*"
    r"// hide quick picks after first use\s*"
    r"qp\.style\.display='none';\s*"
    r"snd\.click\(\);\s*"
    r"\}\s*"
    r"\}\);",
    merged)
if not main_click:
    print("FATAL: could not locate quick-pick click handler in main version", file=sys.stderr)
    sys.exit(1)

new_click = (
    "b.addEventListener('click', function(){\n"
    "          if (!inp || !snd) return;\n"
    "          // Intercept \"Talk to a human\" — start the callback escalation\n"
    "          // flow locally instead of round-tripping to the LLM.\n"
    "          if (q.label === 'Talk to a human') {\n"
    "            qp.style.display = 'none';\n"
    "            startEscalation({ seedFromQuickPick: true });\n"
    "            return;\n"
    "          }\n"
    "          inp.value = q.text;\n"
    "          // hide quick picks after first use\n"
    "          qp.style.display='none';\n"
    "          snd.click();\n"
    "        });"
)
merged = merged[:main_click.start()] + new_click + merged[main_click.end():]

# 3) Insert bindEscalationInterceptors call before the closing brace of
#    enhanceChatbot — locate the "If already open at load" comment and add
#    our line after the greet() call that follows.
old_tail = (
    "    // If already open at load (rare), greet now\n"
    "    if (win.classList.contains('open')) greet();\n"
    "  }\n"
)
new_tail = (
    "    // If already open at load (rare), greet now\n"
    "    if (win.classList.contains('open')) greet();\n"
    "\n"
    "    /* ── ESCALATION: Talk-to-a-human → Callback Request ──── */\n"
    "    bindEscalationInterceptors(inp, snd);\n"
    "  }\n"
)
if old_tail not in merged:
    print("FATAL: could not locate enhanceChatbot tail in main version", file=sys.stderr)
    sys.exit(1)
merged = merged.replace(old_tail, new_tail, 1)

# 4) Extract the full ESCALATION block from our version — from the
#    "CHATBOT ESCALATION FLOW" comment to the closing brace of
#    submitCallback (the function right before "/* ── 3. TECHNOLOGY:").
m = re.search(
    r'(  /\* ─{50,}\n     CHATBOT ESCALATION FLOW.*?^  \}\n\n)'
    r'  /\* ── 3\. TECHNOLOGY',
    ours_src, re.DOTALL | re.MULTILINE)
if not m:
    print("FATAL: could not extract escalation block from our version", file=sys.stderr)
    sys.exit(1)
escalation_block = m.group(1)

# 5) Insert escalation block before "/* ── 3. TECHNOLOGY:" in merged
marker = "  /* ── 3. TECHNOLOGY:"
idx = merged.find(marker)
if idx < 0:
    print("FATAL: could not find TECHNOLOGY marker in merged content", file=sys.stderr)
    sys.exit(1)
merged = merged[:idx] + escalation_block + merged[idx:]

target.write_text(merged)
print(f"wrote {target} — {len(merged.splitlines())} lines")
