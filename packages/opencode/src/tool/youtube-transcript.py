import argparse
import html
import re
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path
from urllib.parse import urlparse

YOUTUBE_HOSTS = frozenset({"youtube.com", "www.youtube.com", "m.youtube.com", "music.youtube.com", "youtu.be"})
LANGUAGE_PATTERN = re.compile(r"^[A-Za-z]{2,3}(?:[-_][A-Za-z0-9]{2,8})?$")
SEQUENCE_PATTERN = re.compile(r"^\s*\d+\s*$")
TIMESTAMP_PATTERN = re.compile(r"^\s*\d{1,2}:\d{2}:\d{2}[,.]\d{3}\s*-->\s*")
TAG_PATTERN = re.compile(r"<[^>]*>")
MAX_TRANSCRIPT_BYTES = 4 * 1024 * 1024
YTDLP_TIMEOUT_SECONDS = 120


class TranscriptError(Exception):
    pass


def validate_url(value: str) -> str:
    parsed = urlparse(value)
    host = (parsed.hostname or "").lower().rstrip(".")
    if parsed.scheme != "https" or host not in YOUTUBE_HOSTS:
        raise TranscriptError("URL must be an HTTPS YouTube URL")
    if host == "youtu.be" and not parsed.path.strip("/"):
        raise TranscriptError("YouTube URL is missing a video path")
    return value


def validate_language(value: str) -> str:
    if not LANGUAGE_PATTERN.fullmatch(value):
        raise TranscriptError("Language must be a short code such as en or pt-BR")
    return value


def run_yt_dlp(executable: str, arguments: list[str]) -> subprocess.CompletedProcess[str]:
    try:
        return subprocess.run(
            [executable, *arguments],
            capture_output=True,
            check=False,
            text=True,
            timeout=YTDLP_TIMEOUT_SECONDS,
        )
    except subprocess.TimeoutExpired as error:
        raise TranscriptError("yt-dlp timed out while fetching subtitles") from error


def find_subtitle(directory: Path, language: str) -> Path | None:
    suffix = f".{language}.srt".lower()
    for candidate in sorted(directory.glob("*.srt")):
        if candidate.name.lower().endswith(suffix):
            return candidate
    return None


def strip_srt(content: str) -> str:
    lines: list[str] = []
    seen: set[str] = set()
    for raw_line in content.replace("\r", "").splitlines():
        line = raw_line.strip()
        if not line or SEQUENCE_PATTERN.fullmatch(line) or TIMESTAMP_PATTERN.match(line):
            continue
        line = html.unescape(TAG_PATTERN.sub("", line)).strip()
        if line and line not in seen:
            seen.add(line)
            lines.append(line)
    result = "\n".join(lines)
    if len(result.encode("utf-8")) > MAX_TRANSCRIPT_BYTES:
        raise TranscriptError("Transcript exceeds the 4 MB output limit")
    return result


def extract_transcript(url: str, language: str) -> str:
    validate_url(url)
    validate_language(language)
    executable = shutil.which("yt-dlp")
    if executable is None:
        raise TranscriptError("yt-dlp is required but was not found on PATH")

    with tempfile.TemporaryDirectory(prefix="ocx-youtube-") as directory:
        output = Path(directory) / "transcript"
        common = ["--skip-download", "--no-progress", "--no-warnings", "--sub-lang", language, "--convert-subs", "srt", "-o", str(output), url]
        run_yt_dlp(executable, ["--write-auto-subs", *common])
        subtitle = find_subtitle(Path(directory), language)
        if subtitle is None:
            run_yt_dlp(executable, ["--write-subs", *common])
            subtitle = find_subtitle(Path(directory), language)
        if subtitle is None:
            raise TranscriptError(f"No subtitles available for language: {language}")
        result = strip_srt(subtitle.read_text(encoding="utf-8-sig"))
        if not result:
            raise TranscriptError("Subtitle file contained no transcript text")
        return result


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("url")
    parser.add_argument("language", nargs="?", default="en")
    args = parser.parse_args()
    try:
        sys.stdout.write(extract_transcript(args.url, args.language))
        sys.stdout.write("\n")
        return 0
    except TranscriptError as error:
        print(str(error), file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
