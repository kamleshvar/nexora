"""Nexora feature helpers: documents, retrieval, web access, files and images.

Everything here is deliberately dependency-light so the app still runs on a
small server. Optional libraries are imported lazily and failures return a
friendly FeatureError instead of crashing a chat request.
"""
import base64
import csv
import io
import ipaddress
import json
import os
import re
import socket
import time
import uuid
from urllib.parse import parse_qs, quote, urlparse

import requests

APP_DIR = os.path.dirname(os.path.abspath(__file__))
TAVILY_API_KEY = os.getenv("TAVILY_API_KEY", "")
JINA_BASE = os.getenv("JINA_READER_BASE", "https://r.jina.ai/")
NVIDIA_IMAGE_URL = os.getenv("NVIDIA_IMAGE_URL", "")
NVIDIA_API_KEY = os.getenv("NVIDIA_API_KEY", "")
USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36"

MAX_DOC_CHARS = 300_000
MAX_PAGE_CHARS = 14_000
MAX_FETCH_BYTES = 2 * 1024 * 1024


class FeatureError(Exception):
    pass


# ---------------------------------------------------------------------------
# Text helpers
# ---------------------------------------------------------------------------

MOJIBAKE_MARKERS = ("â€", "Ã", "Â", "â€™", "â€œ", "â€\x9d", "â€“", "â€”")


def repair_text(value):
    """Repair UTF-8 text that was decoded as Latin-1 (for example ``Iâ€™ll``)."""
    if not value:
        return ""
    text = str(value)
    if any(marker in text for marker in MOJIBAKE_MARKERS):
        try:
            candidate = text.encode("latin-1").decode("utf-8")
            if candidate:
                text = candidate
        except (UnicodeEncodeError, UnicodeDecodeError):
            pass
        # Remaining sequences that could not round-trip cleanly.
        for broken, fixed in (
            ("â€™", "’"), ("â€˜", "‘"), ("â€œ", "“"), ("â€\x9d", "”"),
            ("â€“", "–"), ("â€”", "—"), ("â€¦", "…"), ("â€¢", "•"),
            ("Â ", " "), ("Â", ""), ("â€", '"'),
        ):
            text = text.replace(broken, fixed)
    return text


def clean_text(value):
    if not value:
        return ""
    text = repair_text(str(value)).replace("\r\n", "\n").replace("\r", "\n")
    text = re.sub(r"[ \t]+\n", "\n", text)
    text = re.sub(r"\n{4,}", "\n\n\n", text)
    return text.strip()


def estimate_tokens(*parts):
    """Cheap, deterministic token estimate used for credit accounting."""
    total = 0
    for part in parts:
        text = str(part or "")
        total += max(1, int(round(len(text) / 4.0))) if text else 0
    return max(1, total)


# ---------------------------------------------------------------------------
# Community-guideline moderation
# ---------------------------------------------------------------------------

_CSAM_RE = re.compile(
    r"\b(child\s*(porn|sexual|nude)|csam|underage\s*(sex|porn|nude)|"
    r"minor\s*(sex|porn|nude)|loli\s*(porn|sex)|sexual\s*(content|images?)\s*(of|with)\s*(a\s*)?(child|minor|kid))\b",
    re.I,
)
_EXPLICIT_RE = re.compile(
    r"\b(porn|pornography|hardcore\s*sex|explicit\s*sex|sexual\s*roleplay|sexting|"
    r"nsfw\s*(pic|image|photo|video)|nude\s*(pic|image|photo|video)|"
    r"blowjob|handjob|anal\s*sex|vaginal\s*sex|orgy|gangbang|hentai|rule34|"
    r"cum\s*shot|ejaculat(e|ion)\s*(on|in)|dildo|vibrator\s*sex)\b",
    re.I,
)
_THREAT_RE = re.compile(
    r"\b(i\s*(will|am going to|gonna)\s*(kill|murder|shoot|stab|hurt)\s+(you|him|her|them|everyone)|"
    r"shoot\s*up\s*(the|a)\s*(school|mall|church|office)|"
    r"bomb\s*(the|a)\s*(school|mall|church|office|building)|"
    r"mass\s*shooting\s*plan|school\s*shooting\s*plan)\b",
    re.I,
)
_ILLEGAL_RE = re.compile(
    r"\b(how\s*to\s*(make|build)\s*(a\s*)?(bomb|explosive|nerve\s*agent|sarin|ricin|meth|methamphetamine)|"
    r"write\s*(me\s*)?(a\s*)?(ransomware|keylogger|credential\s*stealer|computer\s*virus|malware)|"
    r"steal\s*(passwords?|credit\s*cards?|crypto)|carding\s*tutorial|"
    r"counterfeit\s*(money|currency)|buy\s*(illegal\s*)?(guns?|weapons?)\s*online)\b",
    re.I,
)
_SAFE_CONTEXT_RE = re.compile(
    r"\b(sex\s*education|sexual\s*health|medical|clinical|biology|consent|therapy|"
    r"public\s*health|law|legal|prevention|report(ing)?\s*(abuse|crime)|journalism|research)\b",
    re.I,
)

MODERATION_TERMS = {
    "csam": "sexual content involving minors",
    "explicit": "explicit sexual content",
    "threat": "credible threats or planned violence",
    "illegal": "instructions for weapons, drugs or malware",
}


def moderation_check(text):
    """Return ``(blocked, reason)`` for severe community-guideline violations."""
    value = str(text or "")
    if not value.strip():
        return False, ""
    if _CSAM_RE.search(value):
        return True, MODERATION_TERMS["csam"]
    if _THREAT_RE.search(value):
        return True, MODERATION_TERMS["threat"]
    if _ILLEGAL_RE.search(value):
        return True, MODERATION_TERMS["illegal"]
    if _EXPLICIT_RE.search(value) and not _SAFE_CONTEXT_RE.search(value):
        return True, MODERATION_TERMS["explicit"]
    return False, ""


def safe_name(value, fallback="User", limit=60):
    text = re.sub(r"[\x00-\x1f\x7f<>\"'`]", " ", str(value or ""))
    text = re.sub(r"\s+", " ", text).strip()
    return (text[:limit] or fallback)


def safe_filename(value, fallback="nexora-file"):
    text = re.sub(r"[^A-Za-z0-9._ -]", "", str(value or "")).strip()
    text = re.sub(r"\s+", "-", text)
    text = text.strip(".-")
    return (text[:80] or fallback)


def _human_size(size):
    if size < 1024:
        return f"{size} B"
    if size < 1024 * 1024:
        return f"{size / 1024:.0f} KB"
    return f"{size / (1024 * 1024):.1f} MB"


# ---------------------------------------------------------------------------
# Document extraction
# ---------------------------------------------------------------------------

ALLOWED_DOC_EXTENSIONS = {
    "pdf": "pdf", "docx": "docx", "txt": "text", "md": "text",
    "csv": "csv", "json": "json", "xlsx": "xlsx", "xlsm": "xlsx",
}


def extract_document(filename, raw):
    """Return (text, kind, warning). Raises FeatureError for unsupported input."""
    ext = (filename.rsplit(".", 1)[-1] if "." in filename else "").lower()
    kind = ALLOWED_DOC_EXTENSIONS.get(ext)
    if not kind:
        raise FeatureError("Unsupported file type. Upload PDF, DOCX, TXT, MD, CSV, JSON or XLSX.")
    if not raw:
        raise FeatureError("The uploaded file is empty.")

    try:
        if kind == "pdf":
            text = _extract_pdf(raw)
        elif kind == "docx":
            text = _extract_docx(raw)
        elif kind in ("csv", "text", "json"):
            text = _decode_text(raw)
        elif kind == "xlsx":
            text = _extract_xlsx(raw)
        else:
            text = ""
    except FeatureError:
        raise
    except Exception as exc:
        raise FeatureError(f"Could not read that file: {str(exc)[:120]}")

    text = clean_text(text)[:MAX_DOC_CHARS]
    warning = ""
    if not text:
        warning = "No readable text was found. Scanned PDFs need OCR, which is not enabled."
    return text, kind, warning


def _decode_text(raw):
    for encoding in ("utf-8-sig", "utf-8", "utf-16", "latin-1"):
        try:
            return raw.decode(encoding)
        except UnicodeDecodeError:
            continue
    return raw.decode("utf-8", errors="replace")


def _extract_pdf(raw):
    text = ""
    try:
        from pypdf import PdfReader

        reader = PdfReader(io.BytesIO(raw))
        pages = []
        for page in reader.pages[:60]:
            try:
                pages.append(page.extract_text() or "")
            except Exception:
                continue
        text = "\n\n".join(pages)
    except Exception:
        text = ""
    if len(text.strip()) < 40:
        try:
            from pdfminer.high_level import extract_text

            text = extract_text(io.BytesIO(raw)) or text
        except Exception:
            pass
    return text


def _extract_docx(raw):
    from docx import Document

    document = Document(io.BytesIO(raw))
    parts = [paragraph.text for paragraph in document.paragraphs if paragraph.text.strip()]
    for table_index, table in enumerate(document.tables[:20], start=1):
        rows = []
        for row in table.rows[:200]:
            cells = [cell.text.strip() for cell in row.cells]
            if any(cells):
                rows.append(" | ".join(cells))
        if rows:
            parts.append(f"\nTable {table_index}:\n" + "\n".join(rows))
    return "\n".join(parts)


def _extract_xlsx(raw):
    from openpyxl import load_workbook

    workbook = load_workbook(io.BytesIO(raw), read_only=True, data_only=True)
    parts = []
    for sheet in workbook.worksheets[:12]:
        parts.append(f"### Sheet: {sheet.title}")
        for row_index, row in enumerate(sheet.iter_rows(values_only=True)):
            if row_index > 1500:
                parts.append("… (truncated)")
                break
            cells = ["" if cell is None else str(cell) for cell in row[:40]]
            if any(cells):
                parts.append(" | ".join(cells))
    try:
        workbook.close()
    except Exception:
        pass
    return "\n".join(parts)


# ---------------------------------------------------------------------------
# Chunking + SQLite FTS retrieval
# ---------------------------------------------------------------------------

def chunk_text(text, size=1700, overlap=180):
    text = clean_text(text)
    if not text:
        return []
    chunks = []
    start = 0
    while start < len(text):
        end = min(start + size, len(text))
        if end < len(text):
            # Prefer a paragraph or sentence boundary.
            window = text[start:end]
            cut = max(window.rfind("\n\n"), window.rfind(". "), window.rfind("\n"))
            if cut > size * 0.55:
                end = start + cut + 1
        piece = text[start:end].strip()
        if piece:
            chunks.append(piece)
        if end >= len(text):
            break
        start = max(end - overlap, start + 1)
    return chunks


def index_document(conn, file_id, user_id, conversation_id, text):
    conn.execute("DELETE FROM file_chunks WHERE file_id = ?", (file_id,))
    conn.execute("DELETE FROM file_chunks_fts WHERE file_id = ?", (file_id,))
    count = 0
    for index, chunk in enumerate(chunk_text(text)):
        cursor = conn.execute(
            "INSERT INTO file_chunks (file_id, user_id, conversation_id, chunk_index, content) "
            "VALUES (?, ?, ?, ?, ?)",
            (file_id, user_id, conversation_id, index, chunk),
        )
        conn.execute(
            "INSERT INTO file_chunks_fts (rowid, content, file_id, user_id, conversation_id) "
            "VALUES (?, ?, ?, ?, ?)",
            (cursor.lastrowid, chunk, file_id, user_id or "", conversation_id or ""),
        )
        count += 1
    return count


def _fts_query(query):
    words = [w for w in re.findall(r"[A-Za-z0-9_]{3,}", query or "")][:12]
    if not words:
        return ""
    return " OR ".join(f'"{word}"' for word in words)


def retrieve_chunks(conn, user_id, file_ids, query, limit=10):
    """Return the most relevant chunks for the attached files."""
    if not file_ids:
        return []
    placeholders = ",".join("?" for _ in file_ids)
    params = list(file_ids)
    match = _fts_query(query)
    rows = []
    if match:
        try:
            rows = conn.execute(
                f"SELECT c.file_id, c.content FROM file_chunks_fts f "
                f"JOIN file_chunks c ON c.id = f.rowid "
                f"WHERE file_chunks_fts MATCH ? AND c.user_id = ? "
                f"AND c.file_id IN ({placeholders}) "
                f"ORDER BY rank LIMIT ?",
                [match, user_id] + params + [limit],
            ).fetchall()
        except Exception:
            rows = []
    if not rows:
        # Fallback: first chunks of each file, useful for short docs and generic asks.
        rows = conn.execute(
            f"SELECT file_id, content FROM file_chunks WHERE user_id = ? "
            f"AND file_id IN ({placeholders}) ORDER BY file_id, chunk_index LIMIT ?",
            [user_id] + params + [limit],
        ).fetchall()
    return [dict(row) for row in rows]


# ---------------------------------------------------------------------------
# Web access
# ---------------------------------------------------------------------------

def _is_safe_public_url(url):
    try:
        parsed = urlparse(url)
        if parsed.scheme not in ("http", "https"):
            return False
        if not parsed.hostname or parsed.username or parsed.password:
            return False
        if parsed.port not in (None, 80, 443):
            return False
        host = parsed.hostname.lower().strip(".")
        if host in ("localhost", "localhost.localdomain") or host.endswith(".local"):
            return False
        infos = socket.getaddrinfo(host, parsed.port or (443 if parsed.scheme == "https" else 80))
        addresses = {info[4][0] for info in infos}
        for address in addresses:
            ip = ipaddress.ip_address(address)
            if not ip.is_global or ip.is_multicast:
                return False
        return bool(addresses)
    except Exception:
        return False


def _jina_read(target_url, timeout=50):
    response = requests.get(
        JINA_BASE + target_url,
        headers={"User-Agent": USER_AGENT, "Accept": "text/plain"},
        timeout=timeout,
    )
    if response.status_code >= 400:
        raise FeatureError(f"Reader error {response.status_code}")
    return response.text


def _strip_jina_header(text):
    text = text or ""
    text = re.sub(r"^Title:\s*.*\n+", "", text)
    text = re.sub(r"^URL Source:\s*.*\n+", "", text)
    text = re.sub(r"^Markdown Content:\s*\n+", "", text)
    return text.strip()


def fetch_page(url, max_chars=MAX_PAGE_CHARS):
    if not _is_safe_public_url(url):
        raise FeatureError("That URL is not allowed.")
    title = ""
    text = ""
    try:
        raw = _jina_read(url)
        title_match = re.search(r"^Title:\s*(.+)$", raw, re.M)
        if title_match:
            title = title_match.group(1).strip()
        text = _strip_jina_header(raw)
    except Exception:
        text = ""
    if len(text) < 200:
        try:
            response = requests.get(
                url,
                headers={"User-Agent": USER_AGENT, "Accept": "text/html,application/xhtml+xml"},
                timeout=(8, 20),
                stream=True,
                allow_redirects=False,
            )
            if response.status_code in (301, 302, 303, 307, 308):
                location = response.headers.get("Location", "")
                response.close()
                if location and _is_safe_public_url(location):
                    return fetch_page(location, max_chars)
                raise FeatureError("Unsafe redirect.")
            response.raise_for_status()
            content = b""
            for block in response.iter_content(65536):
                content += block
                if len(content) > MAX_FETCH_BYTES:
                    break
            response.close()
            text = _readable_text(_decode_text(content))
        except Exception:
            if not text:
                raise FeatureError("Could not read that page.")
    text = clean_text(text)[:max_chars]
    return {"title": safe_name(title or urlparse(url).hostname, "Web page", 120), "url": url, "text": text}


def _readable_text(html_text):
    try:
        from lxml import html as lxml_html

        document = lxml_html.fromstring(html_text)
        for node in document.xpath("//script|//style|//noscript|//nav|//footer|//header|//form|//svg"):
            node.drop_tree()
        candidates = document.xpath("//article") or document.xpath("//main") or [document.body]
        best = ""
        for node in candidates:
            if node is None:
                continue
            value = " ".join(node.text_content().split())
            if len(value) > len(best):
                best = value
        return best
    except Exception:
        return re.sub(r"<[^>]+>", " ", html_text)


def search_web(query, limit=5):
    query = clean_text(query)[:400]
    if not query:
        return []
    if TAVILY_API_KEY:
        try:
            response = requests.post(
                "https://api.tavily.com/search",
                json={
                    "api_key": TAVILY_API_KEY,
                    "query": query,
                    "max_results": limit,
                    "search_depth": "basic",
                    "include_answer": False,
                },
                timeout=30,
            )
            if response.ok:
                data = response.json()
                return [
                    {
                        "title": safe_name(item.get("title"), "Source", 140),
                        "url": item.get("url", ""),
                        "snippet": clean_text(item.get("content", ""))[:320],
                    }
                    for item in data.get("results", [])[:limit]
                    if item.get("url")
                ]
        except Exception:
            pass

    # Keyless fallback: DuckDuckGo Lite through Jina's reader proxy.
    try:
        raw = _jina_read(
            "https://lite.duckduckgo.com/lite/?q=" + quote(query), timeout=45
        )
    except Exception:
        return []
    body = _strip_jina_header(raw)
    pattern = re.compile(r"^\s*\d+\.\s*\[([^\]]+)\]\(([^)]+)\)\s*$", re.M)
    matches = list(pattern.finditer(body))
    results = []
    for index, match in enumerate(matches[:limit]):
        title = re.sub(r"\*\*", "", match.group(1)).strip()
        url = match.group(2).strip()
        if "duckduckgo.com/l/" in url:
            try:
                target = parse_qs(urlparse(url).query).get("uddg", [""])[0]
                url = target or url
            except Exception:
                pass
        start = match.end()
        end = matches[index + 1].start() if index + 1 < len(matches) else len(body)
        snippet = clean_text(body[start:end])
        snippet = re.sub(r"\*\*", "", snippet)
        snippet = "\n".join(line for line in snippet.splitlines() if not re.match(r"^[\w.-]+\.[a-z]{2,}$", line.strip()))
        if url.startswith("http"):
            results.append({"title": safe_name(title, "Source", 140), "url": url, "snippet": snippet[:320]})
    return results


# ---------------------------------------------------------------------------
# Artifact generation
# ---------------------------------------------------------------------------

def _strip_fence(text):
    text = (text or "").strip()
    if text.startswith("```"):
        text = re.sub(r"^```[a-zA-Z0-9_-]*\s*\n?", "", text)
        text = re.sub(r"\n?```\s*$", "", text)
    return text.strip()


def _md_blocks(markdown):
    """Very small markdown block parser used by PDF and DOCX writers."""
    lines = _strip_fence(markdown).splitlines()
    blocks = []
    paragraph = []
    in_code = False
    code_lines = []
    table_rows = []

    def flush_paragraph():
        nonlocal paragraph
        if paragraph:
            blocks.append(("p", " ".join(line.strip() for line in paragraph)))
            paragraph = []

    def flush_table():
        nonlocal table_rows
        if table_rows:
            blocks.append(("table", table_rows))
            table_rows = []

    for line in lines:
        stripped = line.strip()
        if stripped.startswith("```"):
            flush_paragraph()
            if in_code:
                blocks.append(("code", "\n".join(code_lines)))
                code_lines = []
                in_code = False
            else:
                in_code = True
            continue
        if in_code:
            code_lines.append(line)
            continue
        if not stripped:
            flush_paragraph()
            flush_table()
            continue
        if re.match(r"^\|.*\|$", stripped):
            flush_paragraph()
            cells = [cell.strip() for cell in stripped.strip("|").split("|")]
            if not all(re.match(r"^:?-{2,}:?$", cell) for cell in cells):
                table_rows.append(cells)
            continue
        flush_table()
        heading = re.match(r"^(#{1,4})\s+(.*)$", stripped)
        if heading:
            flush_paragraph()
            blocks.append(("h", (len(heading.group(1)), heading.group(2).strip())))
            continue
        bullet = re.match(r"^[-*+]\s+(.*)$", stripped)
        if bullet:
            flush_paragraph()
            blocks.append(("li", bullet.group(1).strip()))
            continue
        numbered = re.match(r"^\d+[.)]\s+(.*)$", stripped)
        if numbered:
            flush_paragraph()
            blocks.append(("oli", numbered.group(1).strip()))
            continue
        paragraph.append(line)
    if in_code and code_lines:
        blocks.append(("code", "\n".join(code_lines)))
    flush_paragraph()
    flush_table()
    return blocks


def _inline_pdf(text):
    text = str(text or "")
    text = text.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")
    text = re.sub(r"`([^`]+)`", r"<font face='Courier'>\1</font>", text)
    text = re.sub(r"\*\*([^*]+)\*\*", r"<b>\1</b>", text)
    text = re.sub(r"(^|[^*])\*([^*]+)\*", r"\1<i>\2</i>", text)
    text = re.sub(r"\[([^\]]+)\]\((https?://[^)]+)\)", r"<link href='\2'>\1</link>", text)
    # Reportlab's standard fonts cannot draw emoji / astral characters.
    return "".join(ch for ch in text if ord(ch) < 0x2500)


def _pdf_bytes(content, title="Nexora document"):
    from reportlab.lib import colors
    from reportlab.lib.enums import TA_LEFT
    from reportlab.lib.pagesizes import A4
    from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
    from reportlab.lib.units import mm
    from reportlab.platypus import (
        ListFlowable, ListItem, PageBreak, Paragraph, Preformatted, SimpleDocTemplate, Spacer, Table, TableStyle,
    )

    buffer = io.BytesIO()
    doc = SimpleDocTemplate(
        buffer, pagesize=A4, leftMargin=18 * mm, rightMargin=18 * mm,
        topMargin=18 * mm, bottomMargin=18 * mm, title=title,
    )
    styles = getSampleStyleSheet()
    body = ParagraphStyle("NexBody", parent=styles["BodyText"], fontSize=10.5, leading=15.5, spaceAfter=7)
    small = ParagraphStyle("NexSmall", parent=body, fontSize=9, textColor=colors.HexColor("#4b5563"))
    h1 = ParagraphStyle("NexH1", parent=styles["Heading1"], fontSize=19, leading=24, spaceAfter=10, textColor=colors.HexColor("#111827"))
    h2 = ParagraphStyle("NexH2", parent=styles["Heading2"], fontSize=14, leading=19, spaceBefore=8, textColor=colors.HexColor("#1f2937"))
    code = ParagraphStyle("NexCode", parent=body, fontName="Courier", fontSize=8.5, leading=11, backColor=colors.HexColor("#f3f4f6"), borderPadding=6)

    story = []
    blocks = _md_blocks(content)
    for block in blocks:
        kind = block[0]
        if kind == "h":
            level, text = block[1]
            story.append(Paragraph(_inline_pdf(text), h1 if level == 1 else h2))
        elif kind == "p":
            story.append(Paragraph(_inline_pdf(block[1]), body))
        elif kind == "li":
            story.append(ListFlowable([ListItem(Paragraph(_inline_pdf(block[1]), body), leftIndent=10)], bulletType="bullet", start="•"))
        elif kind == "oli":
            story.append(ListFlowable([ListItem(Paragraph(_inline_pdf(block[1]), body), leftIndent=10)], bulletType="1"))
        elif kind == "code":
            story.append(Preformatted(block[1][:6000], code))
        elif kind == "table":
            rows = [[Paragraph(_inline_pdf(cell), small) for cell in row] for row in block[1][:60]]
            if rows:
                table = Table(rows, repeatRows=1)
                table.setStyle(TableStyle([
                    ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#eef2ff")),
                    ("GRID", (0, 0), (-1, -1), 0.4, colors.HexColor("#c7d2fe")),
                    ("VALIGN", (0, 0), (-1, -1), "TOP"),
                    ("LEFTPADDING", (0, 0), (-1, -1), 5),
                    ("RIGHTPADDING", (0, 0), (-1, -1), 5),
                ]))
                story.append(table)
                story.append(Spacer(1, 6))
    if not story:
        story.append(Paragraph("This document is empty.", body))
    story.append(Spacer(1, 14))
    story.append(Paragraph("Generated by Nexora AI · techorigin.online", small))
    doc.build(story)
    return buffer.getvalue()


def _docx_bytes(content):
    from docx import Document
    from docx.shared import Pt

    document = Document()
    styles = document.styles
    styles["Normal"].font.name = "Calibri"
    styles["Normal"].font.size = Pt(11)
    for block in _md_blocks(content):
        kind = block[0]
        if kind == "h":
            level, text = block[1]
            document.add_heading(text[:300], level=min(level, 4))
        elif kind == "p":
            document.add_paragraph(block[1])
        elif kind == "li":
            document.add_paragraph(block[1], style="List Bullet")
        elif kind == "oli":
            document.add_paragraph(block[1], style="List Number")
        elif kind == "code":
            paragraph = document.add_paragraph()
            run = paragraph.add_run(block[1][:12000])
            run.font.name = "Consolas"
            run.font.size = Pt(9)
        elif kind == "table":
            rows = block[1][:60]
            if rows:
                columns = max(len(row) for row in rows)
                table = document.add_table(rows=len(rows), cols=columns)
                table.style = "Light Grid Accent 1"
                for r, row in enumerate(rows):
                    for c in range(columns):
                        table.cell(r, c).text = row[c] if c < len(row) else ""
    buffer = io.BytesIO()
    document.save(buffer)
    return buffer.getvalue()


def _table_rows_from_csv(text):
    reader = csv.reader(io.StringIO(_strip_fence(text)))
    return [row for row in reader if any(str(cell).strip() for cell in row)]


def _csv_text(content):
    text = _strip_fence(content)
    blocks = _md_blocks(text)
    tables = [block[1] for block in blocks if block[0] == "table"]
    if tables and len(tables[0]) > 1:
        output = io.StringIO()
        writer = csv.writer(output)
        writer.writerows(tables[0])
        return output.getvalue()
    if "," in text.splitlines()[0] if text.splitlines() else False:
        return text if text.endswith("\n") else text + "\n"
    # Last resort: turn prose lines into a single-column CSV.
    output = io.StringIO()
    writer = csv.writer(output)
    for line in text.splitlines():
        if line.strip():
            writer.writerow([line.strip()])
    return output.getvalue()


def _xlsx_bytes(content):
    from openpyxl import Workbook
    from openpyxl.styles import Font, PatternFill

    workbook = Workbook()
    sheet = workbook.active
    sheet.title = "Data"
    rows = _table_rows_from_csv(content)
    if not rows:
        rows = [["Content"], [_strip_fence(content)[:30000]]]
    for row in rows[:5000]:
        sheet.append([str(cell)[:500] for cell in row[:80]])
    for cell in sheet[1]:
        cell.font = Font(bold=True, color="FFFFFF")
        cell.fill = PatternFill("solid", fgColor="6D5CFF")
    buffer = io.BytesIO()
    workbook.save(buffer)
    return buffer.getvalue()


def build_artifact(fmt, filename, content, out_dir):
    fmt = (fmt or "pdf").lower().strip(".")
    if fmt in ("excel", "xls"):
        fmt = "xlsx"
    if fmt not in ("pdf", "docx", "csv", "xlsx"):
        raise FeatureError("Unsupported file format. Choose PDF, DOCX, CSV or XLSX.")
    content = _strip_fence(content)
    if not content:
        raise FeatureError("There was no content to put in the file.")
    base = safe_filename(filename or "nexora-file", "nexora-file")
    base = re.sub(r"\.(pdf|docx|csv|xlsx)$", "", base, flags=re.I)
    filename = f"{base}.{fmt}"
    os.makedirs(out_dir, exist_ok=True)
    stored = f"{uuid.uuid4().hex}-{filename}"
    path = os.path.join(out_dir, stored)

    if fmt == "pdf":
        data, mime = _pdf_bytes(content, title=base), "application/pdf"
    elif fmt == "docx":
        data, mime = _docx_bytes(content), "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
    elif fmt == "csv":
        data, mime = _csv_text(content).encode("utf-8-sig"), "text/csv; charset=utf-8"
    else:
        data, mime = _xlsx_bytes(content), "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"

    with open(path, "wb") as handle:
        handle.write(data)
    return {"filename": filename, "stored": stored, "path": path, "mime": mime, "size": len(data), "format": fmt}


# ---------------------------------------------------------------------------
# Image generation
# ---------------------------------------------------------------------------

def generate_image(prompt, out_dir, aspect="1:1"):
    prompt = clean_text(prompt)[:1200]
    if not prompt:
        raise FeatureError("Describe the image you want to generate.")
    os.makedirs(out_dir, exist_ok=True)
    filename = f"{uuid.uuid4().hex}.jpg"
    path = os.path.join(out_dir, filename)
    errors = []

    if NVIDIA_IMAGE_URL and NVIDIA_API_KEY:
        try:
            response = requests.post(
                NVIDIA_IMAGE_URL,
                headers={"Authorization": f"Bearer {NVIDIA_API_KEY}", "Content-Type": "application/json"},
                json={"prompt": prompt, "aspect_ratio": aspect},
                timeout=120,
            )
            response.raise_for_status()
            payload = response.json()
            artifacts = payload.get("artifacts") or []
            encoded = artifacts[0].get("base64") if artifacts else None
            if not encoded and payload.get("image"):
                encoded = payload["image"]
            if encoded:
                raw = base64.b64decode(encoded.split(",")[-1])
                with open(path, "wb") as handle:
                    handle.write(raw)
                return {"filename": f"nexora-image-{int(time.time())}.jpg", "stored": filename, "path": path,
                        "mime": "image/jpeg", "size": len(raw), "format": "image"}
        except Exception as exc:
            errors.append(str(exc)[:100])

    width, height = (1024, 1024)
    if aspect in ("16:9", "landscape"):
        width, height = 1280, 720
    elif aspect in ("9:16", "portrait"):
        width, height = 768, 1280
    for model in ("flux", "turbo"):
        try:
            url = (
                "https://image.pollinations.ai/prompt/" + quote(prompt, safe="")
                + f"?width={width}&height={height}&nologo=true&model={model}&seed={int(time.time())}"
            )
            response = requests.get(url, timeout=120)
            if response.ok and response.content[:2] == b"\xff\xd8":
                with open(path, "wb") as handle:
                    handle.write(response.content)
                return {"filename": f"nexora-image-{int(time.time())}.jpg", "stored": filename, "path": path,
                        "mime": "image/jpeg", "size": len(response.content), "format": "image"}
            errors.append(f"pollinations {response.status_code}")
        except Exception as exc:
            errors.append(str(exc)[:100])
    raise FeatureError("Image generation is unavailable right now. " + (errors[-1] if errors else ""))


# ---------------------------------------------------------------------------
# Intent helpers
# ---------------------------------------------------------------------------

FILE_INTENT = re.compile(
    r"\b(create|make|generate|build|write|export|prepare|produce|download)\b[^.\n]{0,80}?"
    r"\b(pdf|docx|word(?:\s+doc(?:ument)?)?|csv|excel|xlsx|spreadsheet)\b",
    re.I,
)
IMAGE_INTENT = re.compile(
    r"^\s*(?:please\s+)?(?:can\s+you\s+)?(?:generate|create|make|draw|paint|render|design)\s+"
    r"(?:me\s+)?(?:an?\s+)?(?:image|picture|photo|illustration|artwork|poster|logo)\b",
    re.I,
)
WEB_INTENT = re.compile(
    r"\b(search|look\s+up|google|browse|find\s+(?:online|on the web)|latest|current|today|news|"
    r"on\s+the\s+internet|from\s+the\s+web|sources?|cite)\b",
    re.I,
)


def detect_file_format(text):
    if not FILE_INTENT.search(text or ""):
        return None
    lowered = (text or "").lower()
    for token, fmt in (("xlsx", "xlsx"), ("excel", "xlsx"), ("spreadsheet", "xlsx"),
                       ("csv", "csv"), ("docx", "docx"), ("word", "docx"), ("pdf", "pdf")):
        if token in lowered:
            return fmt
    return "pdf"


def wants_image(text, flagged=False):
    return bool(flagged or IMAGE_INTENT.search(text or ""))


# ---------------------------------------------------------------------------
# Landing-page previews for advertisements
# ---------------------------------------------------------------------------

def capture_site_screenshot(url, out_dir, width=1000, height=640):
    """Capture a small screenshot of a public landing page with Playwright."""
    if not _is_safe_public_url(url):
        raise FeatureError("That advertisement link is not allowed.")
    os.makedirs(out_dir, exist_ok=True)
    filename = f"site-{uuid.uuid4().hex}.png"
    path = os.path.join(out_dir, filename)
    try:
        from playwright.sync_api import sync_playwright
    except ImportError:
        raise FeatureError("Landing-page previews need Playwright installed.")
    try:
        with sync_playwright() as play:
            browser = play.chromium.launch(headless=True)
            page = browser.new_page(viewport={"width": width, "height": height}, device_scale_factor=1)
            try:
                page.goto(url, wait_until="domcontentloaded", timeout=45000)
            except Exception:
                pass
            page.wait_for_timeout(2600)
            page.screenshot(path=path, type="png", full_page=False)
            browser.close()
    except Exception as exc:
        raise FeatureError(f"Could not capture that page: {str(exc)[:140]}")
    if not os.path.isfile(path) or os.path.getsize(path) < 3000:
        raise FeatureError("The page preview came back empty.")
    try:
        from PIL import Image

        image = Image.open(path)
        image.thumbnail((1000, 700))
        if image.mode not in ("RGB", "RGBA"):
            image = image.convert("RGB")
        image.save(path, format="PNG", optimize=True)
    except Exception:
        pass
    return {"filename": filename, "path": path, "size": os.path.getsize(path)}
