#!/usr/bin/env bash
# capture-shot.sh — 실제 터미널 화면을 캡처해 PNG 로 저장(생성/렌더 금지, 진짜 캡처만).
# 사용법: capture-shot.sh "<셸 명령>" "<출력 png 경로>" [열수=160]
# 환경변수 CAP_SETUP: 화면에 표시하지 않고 먼저 실행할 준비 명령(예: export KUBECONFIG=...)
# 방식: 명령을 임시 스크립트로 써서 Terminal.app 새 창이 실제 실행
#       → 완료 파일로 감지(센티넬을 화면에 안 띄움) → 실제 시각 줄 수만큼 창 높이 자동 맞춤
#       → 그 창만 캡처 → 닫기. 결과적으로 '$ 명령 + 실제 출력'이 여백 없이 꽉 차게 잡힘.
set -uo pipefail
CMD="${1:?명령 필요}"
OUT="${2:?출력 경로 필요}"
COLS="${3:-160}"
mkdir -p "$(dirname "$OUT")"
RUN="/tmp/shotrun_$$.sh"
DONE="/tmp/shotdone_$$"
rm -f "$DONE"

# 실행 스크립트 생성(인용 안전: 명령을 그대로 한 줄로 기록). 센티넬은 화면 대신 파일로.
{
  printf 'clear\n'
  if [ -n "${CAP_SETUP:-}" ]; then
    printf '%s\n' "$CAP_SETUP"                  # 준비 명령(프롬프트 비표시)
  fi
  printf 'printf "%%s\\n\\n" %q\n' "\$ $CMD"   # 프롬프트처럼 명령 표시
  printf '%s\n' "$CMD"                          # 실제 실행
  printf 'touch %q\n' "$DONE"                   # 완료 표시(화면 비표시)
} > "$RUN"

# Terminal 새 창에서 실행 + 폭 지정(높이는 넉넉히, 뒤에서 줄임)
WIN_ID=$(osascript <<EOF 2>/dev/null
tell application "Terminal"
  activate
  do script "zsh $RUN"
  delay 0.2
  set w to front window
  set number of columns of w to $COLS
  set number of rows of w to 50
  return id of w
end tell
EOF
)
[ -z "$WIN_ID" ] && { echo "ERR: Terminal 창 ID 못 얻음"; rm -f "$RUN"; exit 1; }

# 완료 감지(완료 파일) — 최대 60초
done=0
for i in $(seq 1 120); do
  [ -f "$DONE" ] && { done=1; break; }
  sleep 0.5
done
sleep 0.4  # 마지막 출력/프롬프트 렌더 안정화

# 창의 실제 내용 → 끝 빈 줄 제거 후, 각 줄 wrap 반영해 시각 줄 수 합산
CONTENTS=$(osascript -e "tell application \"Terminal\" to get contents of front window" 2>/dev/null)
LINES=$(printf '%s\n' "$CONTENTS" \
  | sed -e 's/[[:space:]]*$//' \
  | awk '{ buf[++n]=$0; if(NF)last=n } END{ for(i=1;i<=last;i++) print buf[i] }' \
  | awk -v w="$COLS" '{ L=length($0); if(L<1)L=1; rows=int((L+w-1)/w); if(rows<1)rows=1; t+=rows } END{ print t+0 }')
ROWS=$(( LINES + 1 ))
[ "$ROWS" -lt 3 ] && ROWS=3
[ "$ROWS" -gt 50 ] && ROWS=50
# 캡처 직전에 열·행을 함께 재설정(초기 열 설정 레이스 방지)
osascript >/dev/null 2>&1 <<EOF
tell application "Terminal"
  set number of columns of (every window whose id is $WIN_ID) to $COLS
  set number of rows of (every window whose id is $WIN_ID) to $ROWS
end tell
EOF
sleep 0.5

screencapture -x -o -l"$WIN_ID" "$OUT" 2>/dev/null
osascript -e "tell application \"Terminal\" to close (every window whose id is $WIN_ID)" saving no >/dev/null 2>&1 || true
rm -f "$RUN" "$DONE"

if [ -f "$OUT" ]; then
  DIM=$(sips -g pixelWidth -g pixelHeight "$OUT" 2>/dev/null | grep pixel | awk '{print $2}' | paste -sd x -)
  [ "$done" = 1 ] && echo "OK: $OUT ($DIM)" || echo "WARN(완료 미감지, 캡처는 됨): $OUT ($DIM)"
else
  echo "ERR: 캡처 실패"; exit 1
fi
