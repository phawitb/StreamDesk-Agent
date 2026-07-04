import asyncio
import logging
import os
import re
import tempfile
from pathlib import Path
from typing import Callable, Awaitable, Optional

import httpx

logger = logging.getLogger(__name__)

StatusCallback = Callable[[str, str], Awaitable[None]]

DOWNLOAD_DIR = Path.home() / "Downloads" / "StreamDesk"


async def download_hls(
    m3u8_url: str,
    filename: str,
    report_status: StatusCallback,
    output_dir: Path = DOWNLOAD_DIR,
    max_concurrent: int = 10,
) -> Optional[Path]:
    """
    Download an HLS stream by fetching all segments and merging with ffmpeg.
    Handles obfuscated segment extensions (e.g. .jpeg instead of .ts).
    """
    output_dir.mkdir(parents=True, exist_ok=True)

    # Sanitize filename (keep Unicode letters like Thai)
    safe_name = re.sub(r'[<>:"/\\|?*]', '', filename).strip()
    if not safe_name:
        safe_name = "movie"
    output_path = output_dir / f"{safe_name}.mp4"

    await report_status("loading_player", f"กำลังเตรียมดาวน์โหลด: {safe_name}")

    async with httpx.AsyncClient(timeout=30, follow_redirects=True) as client:
        # Fetch m3u8 playlist
        try:
            resp = await client.get(m3u8_url)
            resp.raise_for_status()
            playlist_text = resp.text
        except Exception as e:
            logger.error("Failed to fetch m3u8: %s", e)
            await report_status("error", f"ไม่สามารถดาวน์โหลด playlist: {e}")
            return None

        # Parse segment URLs from playlist
        segments = _parse_segments(playlist_text, m3u8_url)
        total = len(segments)

        if total == 0:
            await report_status("error", "ไม่พบ segments ใน playlist")
            return None

        await report_status("loading_player", f"พบ {total} segments กำลังดาวน์โหลด...")

        # Download all segments to temp dir
        with tempfile.TemporaryDirectory() as tmpdir:
            tmppath = Path(tmpdir)

            # Download with concurrency limit
            semaphore = asyncio.Semaphore(max_concurrent)
            completed = 0
            failed = 0

            async def download_segment(idx: int, url: str):
                nonlocal completed, failed
                seg_path = tmppath / f"seg_{idx:05d}.ts"

                async with semaphore:
                    for retry in range(3):
                        try:
                            r = await client.get(url)
                            r.raise_for_status()
                            seg_path.write_bytes(r.content)
                            completed += 1

                            # Report progress every 5%
                            pct = (completed * 100) // total
                            if completed % max(1, total // 20) == 0 or completed == total:
                                await report_status(
                                    "loading_player",
                                    f"ดาวน์โหลด {pct}% ({completed}/{total})"
                                )
                            return
                        except Exception as e:
                            if retry == 2:
                                logger.warning("Failed to download segment %d: %s", idx, e)
                                failed += 1

            # Launch all downloads
            tasks = [download_segment(i, url) for i, url in enumerate(segments)]
            await asyncio.gather(*tasks)

            if failed > total * 0.1:  # more than 10% failed
                await report_status("error", f"ดาวน์โหลดล้มเหลว {failed}/{total} segments")
                return None

            await report_status("loading_player", "กำลังรวมไฟล์...")

            # Create concat file list for ffmpeg
            concat_file = tmppath / "concat.txt"
            with open(concat_file, "w") as f:
                for i in range(total):
                    seg_path = tmppath / f"seg_{i:05d}.ts"
                    if seg_path.exists():
                        f.write(f"file '{seg_path}'\n")

            # Merge with ffmpeg
            proc = await asyncio.create_subprocess_exec(
                "ffmpeg", "-y",
                "-f", "concat",
                "-safe", "0",
                "-i", str(concat_file),
                "-c", "copy",
                str(output_path),
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
            )
            _, stderr = await proc.communicate()

            if proc.returncode != 0:
                logger.error("ffmpeg merge failed: %s", stderr.decode()[-500:])
                await report_status("error", "ไม่สามารถรวมไฟล์ได้")
                return None

    file_size_mb = output_path.stat().st_size / (1024 * 1024)
    await report_status(
        "loading_player",
        f"ดาวน์โหลดเสร็จ: {safe_name}.mp4 ({file_size_mb:.0f} MB)"
    )
    logger.info("Downloaded to %s (%.0f MB)", output_path, file_size_mb)
    return output_path


def _parse_segments(playlist: str, base_url: str) -> list[str]:
    """Parse segment URLs from m3u8 playlist text."""
    segments = []
    base = base_url.rsplit("/", 1)[0]  # directory of m3u8

    for line in playlist.strip().splitlines():
        line = line.strip()
        if line.startswith("#") or not line:
            continue

        if line.startswith("//"):
            segments.append("https:" + line)
        elif line.startswith("http"):
            segments.append(line)
        elif line.startswith("/"):
            # Absolute path - extract host from base_url
            from urllib.parse import urlparse
            parsed = urlparse(base_url)
            segments.append(f"{parsed.scheme}://{parsed.netloc}{line}")
        else:
            segments.append(f"{base}/{line}")

    return segments
