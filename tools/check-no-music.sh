#!/bin/sh
# Fails if any audio, video, lyric or subtitle file (or anything under local-music/) is tracked by git.
# Run before every commit:  sh tools/check-no-music.sh
# git matches the names itself, over the whole repo from any folder in it, so accented or odd names are caught too
top=$(git rev-parse --show-toplevel) || exit 1
set -- ':(icase)local-music'
for ext in mp3 m4a m4p m4b aac wav aif aiff caf flac ogg oga opus wma mka mp4 webm lrc srt vtt ttml; do
  set -- "$@" ":(icase)*.$ext"
done
bad=$(git -C "$top" ls-files -- "$@") || exit 1
if [ -n "$bad" ]; then
  echo "These files must not be in git:"; printf '%s\n' "$bad"; exit 1
fi
echo "ok: no audio or lyric files tracked"
