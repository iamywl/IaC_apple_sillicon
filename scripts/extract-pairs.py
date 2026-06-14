#!/usr/bin/env python3
# extract-pairs.py <md파일> — 각 ```text 출력 블록과 바로 앞 ```bash 명령 블록을 짝지어 출력.
# 스크린샷 교체 작업 시 "어떤 명령을 캡처해야 하나" 를 빠르게 파악하는 용도.
import re, sys
f = sys.argv[1]
s = open(f).read()
lines = s.split("\n")
# 코드펜스 블록 수집: (시작줄, 언어, 내용)
blocks = []
i = 0
while i < len(lines):
    m = re.match(r"^```(\w*)", lines[i])
    if m:
        lang = m.group(1)
        j = i + 1
        body = []
        while j < len(lines) and not re.match(r"^```\s*$", lines[j]):
            body.append(lines[j]); j += 1
        blocks.append((i + 1, lang, "\n".join(body)))
        i = j + 1
    else:
        i += 1
# text 블록마다 직전 bash 블록 찾기
idx = 0
for k, (ln, lang, body) in enumerate(blocks):
    if lang == "text":
        idx += 1
        cmd = ""
        for p in range(k - 1, -1, -1):
            if blocks[p][1] in ("bash", "sh", "shell", "console"):
                cmd = blocks[p][2]; break
            if blocks[p][1] == "text":
                break  # 연속 text 면 명령 공유 안 함
        print(f"===== 블록#{idx} (line {ln}) =====")
        print("[명령]")
        print(cmd if cmd else "  (직전 bash 없음)")
        print("[현재 출력텍스트]")
        print(body)
        print()
