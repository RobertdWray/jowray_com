#!/usr/bin/env python3
"""
rank_correspondents.py: who did she actually write to, and for how long?

Reads a local copy of a mailbox and ranks the people she corresponded with, so
the family can review the list before anyone is emailed.

Reads:
  * a Thunderbird account folder (the mbox files under ImapMail/<server>;
    offline sync must have downloaded the messages)
  * any mbox file (readpst output, Google Takeout, an Apple Mail export)
  * a Maildir, or a folder of .eml files

It reads headers only, never message bodies. Mail files are opened read-only.
Standard library only (Python 3.9+), and nothing leaves your machine.

STEP 1, rank (macOS, Thunderbird, her Hotmail account):

  python3 rank_correspondents.py \\
      --exclude ~/jo-mail-review/exclude.txt \\
      --contacts ~/Downloads/contacts.csv \\
      ~/Library/Thunderbird/Profiles/*/ImapMail/outlook.office365.com

  Writes to --out (default ~/jo-mail-review):
    correspondents.csv  one row per person, best first, with an empty "notify"
                        column for the family to fill in (y = send)
    mail.sqlite         messages, participants and people tables, plus the
                        views her_sent and received_personal, for your own SQL

  --exclude is a text file of addresses ("kay@aol.com") or domains ("@aol.com"
  or "aol.com"), one per line, # for comments: family, people already told.
  A person is dropped if any of their addresses match.

  --contacts is her address book exported as CSV (Outlook.com: People, Manage
  contacts, Export contacts). It adds names and an "in her address book" flag.

STEP 2, after the family has marked the notify column:

  python3 rank_correspondents.py send-list ~/jo-mail-review/correspondents.csv \\
      --gap 30-90 --hours 9-19 --start "2026-11-07 09:00"

  Writes send_list.csv (email, first_name, name, send_at) in rank order. Each
  send_at is a random 30-90 minutes after the one before, only between 9:00
  and 19:00 on this computer's clock. In Thunderbird's Mail Merge dialog, set
  Deliver Mode to Send Later and At to {{send_at}} (needs the Send Later
  add-on). Leave out --gap for a plain list without times.

How the score works (the constants below are the knobs):
  Every message adds weight to the people on it. Older mail counts for less: it
  halves every --half-life years, counted back from the newest message. Mail
  that went both ways gets a 25% bonus.
    she wrote to them   4 (just them), 3 (2-3 people), 1.5 (4-8), 0.75 (9-20),
                        0.25 (more: chain forwards)
    they wrote to her   1.5 (to 1-2 people), 1 (3-5), 0.5 (6-15), 0.15 (more),
                        0.3 if she was only Bcc'd
  Mailing-list, bulk and automated mail (List-*, Precedence, Auto-Submitted,
  bulk-sender headers, noreply@ and friends) adds nothing. Junk, Drafts,
  Outbox and Templates are skipped. Addresses that share the same full name
  count as one person, and the most recently used one becomes send_to.
"""

from __future__ import annotations

import argparse
import collections
import csv
import datetime as dt
import email.header
import email.parser
import email.policy
import email.utils
import hashlib
import itertools
import os
import random
import re
import sqlite3
import sys
import time
from dataclasses import dataclass
from pathlib import Path

# ---- scoring knobs -----------------------------------------------------------
SENT_WEIGHTS = ((1, 4.0), (3, 3.0), (8, 1.5), (20, 0.75))  # (up to n recipients, weight)
SENT_WEIGHT_MASS = 0.25
RECV_WEIGHTS = ((2, 1.5), (5, 1.0), (15, 0.5))  # (up to n To+Cc addresses, weight)
RECV_WEIGHT_MASS = 0.15
BCC_ONLY_WEIGHT = 0.3
TWO_WAY_BONUS = 1.25
DIRECT_MAX = 3  # "she wrote directly" = to at most this many people
DEFAULT_HALF_LIFE = 10.0
YEAR_SECONDS = 365.2425 * 86400

# ---- parsing -------------------------------------------------------------------
HEADER_PARSER = email.parser.BytesHeaderParser(policy=email.policy.compat32)
ENVELOPE = re.compile(rb"^From \S+.*\b\d{4}\s*$")
ASCTIME = re.compile(
    r"(?:\w{3}\s+)?(\w{3})\s+(\d{1,2})\s+(\d{1,2}):(\d{2}):(\d{2})\s+(?:([+-]\d{4})\s+)?(\d{4})"
)
MONTHS = {m: i for i, m in enumerate("jan feb mar apr may jun jul aug sep oct nov dec".split(), 1)}
ADDR_RE = re.compile(r"^[^@\s<>()\[\],;:\"]+@[a-z0-9-]+(\.[a-z0-9-]+)*\.[a-z]{2,}$")
GMAIL_DOMAINS = {"gmail.com", "googlemail.com"}
MAX_HEADER_LINES = 3000
NOW = time.time()
MIN_TS = dt.datetime(1990, 1, 1, tzinfo=dt.timezone.utc).timestamp()
SKIP_SUFFIXES = {
    ".msf", ".dat", ".json", ".html", ".htm", ".txt", ".csv", ".log", ".js", ".ini", ".sqlite",
    ".db", ".lock", ".png", ".jpg", ".jpeg", ".gif", ".pdf", ".xml", ".plist", ".pst", ".ost",
    ".olm", ".zip", ".gz", ".py", ".sh",
}

SENT_RE = re.compile(r"^sent\b", re.I)
JUNK_RE = re.compile(r"^(junk|spam|bulk)\b", re.I)
DRAFT_RE = re.compile(r"^(drafts?|templates?|outbox|unsent)\b", re.I)

BULK_HEADERS = (
    "list-id", "list-unsubscribe", "list-post", "list-help", "feedback-id", "x-campaign",
    "x-campaignid", "x-rpcampaign", "x-cmae-messageid", "x-sfmc-stack", "x-csa-complaints",
    "x-autoreply", "x-autorespond",
)
BULK_HEADER_PREFIXES = ("x-mailgun", "x-mailchimp", "x-mc-", "x-sg-", "x-ses-")
GMAIL_BULK_LABELS = {"category promotions", "category social", "category updates", "category forums"}

ROLE_LOCAL = re.compile(
    r"""^(
        no-?reply|do-?not-?reply|donotreply|do_not_reply|mailer-daemon|postmaster|bounces?|
        notifications?|notify|alerts?|newsletters?|news|info|support|help|service|
        customer-?service|care|billing|accounts?|updates?|marketing|promo(tions)?|offers|
        deals|sales|orders?|receipts?|statements?|digest|reminders?|team|hello|contact|
        admin|webmaster|feedback|surveys?|rewards|members(hip)?|auto-?confirm|
        confirm(ation)?|reservations?|shipping|delivery|invitations?|automated|system
    )([-+._].*)?$""",
    re.X | re.I,
)
ESP_SUBDOMAIN = re.compile(
    r"^(e|em|email|mail[a-z]*|news|newsletter|info|mkt|marketing|reply|replies|bounces?|"
    r"notifications?|alerts?|updates|send|sender|campaign|txn|transactional)\d*\.[^.]+\.[^.]+",
    re.I,
)
AUTOMATED_DOMAINS = (
    "facebookmail.com", "linkedin.com", "twitter.com", "instagram.com", "pinterest.com",
    "nextdoor.com", "youtube.com", "amazon.com", "amazonses.com", "paypal.com", "ebay.com",
    "etsy.com", "evite.com", "paperlesspost.com", "punchbowl.com", "jacquielawson.com",
    "americangreetings.com", "bluemountain.com", "123greetings.com", "shutterfly.com",
    "snapfish.com", "ancestry.com", "classmates.com", "change.org", "signupgenius.com",
    "constantcontact.com", "mailchimp.com", "mcsv.net", "sendgrid.net", "mandrillapp.com",
    "groupon.com", "livingsocial.com", "craigslist.org", "zoom.us", "docusign.net",
    "dropbox.com", "microsoft.com", "google.com", "apple.com", "uber.com", "lyft.com",
)
TITLES = {"mr", "mrs", "ms", "miss", "dr", "rev", "fr", "sister", "sr", "prof", "pastor"}
YES = {"y", "yes", "x", "1", "true", "✓", "✔"}

CSV_COLUMNS = [
    "rank", "notify", "name", "first_name", "send_to", "score", "she_wrote", "she_wrote_direct",
    "they_wrote", "first_year", "last_year", "years_active", "other_addresses", "names_seen",
    "recent_subjects", "flags",
]


def warn(msg: str) -> None:
    print(f"warning: {msg}", file=sys.stderr)


def die(msg: str) -> None:
    print(f"error: {msg}", file=sys.stderr)
    sys.exit(2)


# ---- small text helpers ----------------------------------------------------------
def unfold(v: str) -> str:
    return re.sub(r"\r?\n(?=[ \t])", "", v).replace("\r", "").replace("\n", " ")


def raw_to_text(v: str) -> str:
    """Header values arrive as ASCII with raw 8-bit bytes escaped; recover them."""
    try:
        b = v.encode("ascii", "surrogateescape")
    except UnicodeEncodeError:
        return v
    for enc in ("utf-8", "cp1252"):
        try:
            return b.decode(enc)
        except UnicodeDecodeError:
            pass
    return b.decode("latin-1")


def decode_words(s: str) -> str:
    """Decode RFC 2047 encoded words (=?utf-8?q?...?=)."""
    if "=?" not in s:
        return s
    try:
        return str(email.header.make_header(email.header.decode_header(s)))
    except Exception:
        return s


def canon(addr: str | None) -> str | None:
    """Lowercase, validate, and fold Gmail dots and +tags so one inbox has one key."""
    if not addr:
        return None
    a = addr.strip().strip("<>").strip().lower()
    if a.startswith("mailto:"):
        a = a[7:]
    a = a.strip(" '\"")
    if not ADDR_RE.match(a):
        return None
    local, _, domain = a.rpartition("@")
    if domain in GMAIL_DOMAINS:
        local = local.split("+", 1)[0].replace(".", "")
        domain = "gmail.com"
    return f"{local}@{domain}"


def clean_name(name: str, raw_addr: str) -> str:
    n = decode_words(name or "")
    n = re.sub(r"\S+@\S+", " ", n)
    n = " ".join(n.replace('"', " ").split()).strip(" '()<>,;")
    if not n or n.lower() == raw_addr.lower():
        return ""
    return n


def name_key(name: str | None) -> str | None:
    """'Smith, Margaret A.' and 'Margaret Smith' -> 'margaret smith'. None if under two words."""
    if not name:
        return None
    n = re.sub(r"\(.*?\)|\[.*?\]", " ", name.lower())
    if "," in n:
        last, _, rest = n.partition(",")
        n = f"{rest} {last}"
    tokens = [t.strip("'") for t in re.findall(r"[^\W\d_]+(?:'[^\W\d_]+)?", n)]
    tokens = [t for t in tokens if len(t) > 1 and t not in TITLES]
    return " ".join(tokens) if len(tokens) >= 2 else None


def first_name_of(name: str) -> str:
    if not name:
        return ""
    n = re.sub(r"\(.*?\)|\[.*?\]", " ", name)
    if "," in n:
        n = n.partition(",")[2]
    toks = n.split()
    while toks and toks[0].lower().rstrip(".") in TITLES:
        toks.pop(0)
    if not toks:
        return ""
    f = toks[0].strip("'\".,;")
    if len(toks) == 1 and re.search(r"[\d_.@]", f):
        return ""  # looks like a username, not a name
    if f.isupper() or f.islower():
        f = f.capitalize()
    return f


def looks_automated(addr: str) -> bool:
    local, _, domain = addr.rpartition("@")
    if ROLE_LOCAL.match(local) or ESP_SUBDOMAIN.match(domain):
        return True
    return any(domain == d or domain.endswith("." + d) for d in AUTOMATED_DOMAINS)


def parse_addrs(values: list[str]) -> list[tuple[str, str]]:
    try:
        return email.utils.getaddresses(values, strict=False)
    except TypeError:  # Python without the strict= parameter
        return email.utils.getaddresses(values)


def norm_subject(s: str) -> str:
    return re.sub(r"^((re|fw|fwd|aw|tr|antw)\s*(\[\d+\])?\s*:\s*)+", "", s, flags=re.I).strip()


# ---- dates -------------------------------------------------------------------------
def _sane(ts: float | None) -> float | None:
    return ts if ts is not None and MIN_TS <= ts <= NOW + 2 * 86400 else None


def date_ts(s: str) -> float | None:
    if not s:
        return None
    try:
        d = email.utils.parsedate_to_datetime(s.strip())
    except (TypeError, ValueError, IndexError, OverflowError):
        return None
    if d is None:
        return None
    if d.tzinfo is None:
        d = d.replace(tzinfo=dt.timezone.utc)
    try:
        return _sane(d.timestamp())
    except (OverflowError, OSError, ValueError):
        return None


def envelope_ts(s: str | None) -> float | None:
    if not s:
        return None
    m = ASCTIME.search(s)
    if not m:
        return None
    mon, day, hh, mm, ss, tz, year = m.groups()
    month = MONTHS.get(mon.lower()[:3])
    if not month:
        return None
    try:
        ts = dt.datetime(int(year), month, int(day), int(hh), int(mm), int(ss),
                         tzinfo=dt.timezone.utc).timestamp()
    except ValueError:
        return None
    if tz:
        sign = 1 if tz[0] == "+" else -1
        ts -= sign * (int(tz[1:3]) * 3600 + int(tz[3:5]) * 60)
    return _sane(ts)


def iso(ts: float | None) -> str | None:
    if ts is None:
        return None
    return dt.datetime.fromtimestamp(ts, dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def year_of(ts: float | None) -> int | None:
    return time.gmtime(ts).tm_year if ts is not None else None


# ---- finding and reading mail -----------------------------------------------------
def sniff(p: Path) -> str | None:
    if p.name.startswith(".") or p.suffix.lower() in SKIP_SUFFIXES:
        return None
    if p.suffix.lower() == ".eml":
        return "eml"
    try:
        if p.stat().st_size == 0:
            return "empty"
        with open(p, "rb") as f:
            head = f.read(5)
    except OSError:
        return None
    return "mbox" if head == b"From " else None


def folder_label(root: Path, p: Path) -> str:
    try:
        rel = p.relative_to(root).parts
    except ValueError:
        rel = (p.name,)
    if not rel:
        rel = (p.name,)
    comps = []
    for c in rel:
        if c.lower().endswith(".eml"):
            continue
        if c.endswith(".sbd"):
            c = c[:-4]
        if c.lower().endswith(".mbox"):
            c = c[:-5]
        comps.append(c.lstrip("."))
    if len(comps) > 1 and comps[-1].lower() == "mbox":  # readpst and Apple Mail name the file "mbox"
        comps = comps[:-1]
    return "/".join(c for c in comps if c) or root.name or "mail"


def folder_kind(label: str) -> str:
    comps = [c.strip("[] ") for c in re.split(r"[/\\]", label) if c.strip("[] ")]
    if comps and JUNK_RE.match(comps[-1]):
        return "junk"
    if any(DRAFT_RE.match(c) for c in comps):
        return "drafts"
    if any(SENT_RE.match(c) for c in comps):
        return "sent"
    return "other"


def discover(paths: list[str], empty_indexed: list[str]):
    """Yield (kind, path, folder label) for every mail source under the given paths."""
    for arg in paths:
        root = Path(arg).expanduser()
        if not root.exists():
            warn(f"not found, skipping: {root}")
            continue
        if root.is_file():
            kind = sniff(root)
            if kind in ("mbox", "eml"):
                yield kind, root, folder_label(root.parent, root)
            else:
                warn(f"not an mbox or .eml file, skipping: {root}")
            continue
        for dirpath, dirnames, filenames in os.walk(root):
            d = Path(dirpath)
            dirnames.sort()
            if (d / "cur").is_dir() and (d / "new").is_dir():
                yield "maildir", d, folder_label(root, d)
                dirnames[:] = [x for x in dirnames if x not in ("cur", "new", "tmp")]
                continue  # files at a Maildir's top level are bookkeeping, not mail
            for fn in sorted(filenames):
                p = d / fn
                kind = sniff(p)
                if kind == "empty":
                    msf = p.with_name(p.name + ".msf")
                    if msf.is_file() and msf.stat().st_size > 4096:
                        empty_indexed.append(folder_label(root, p))
                elif kind:
                    yield kind, p, folder_label(root, p)


def read_header_file(p: Path) -> bytes:
    lines = []
    with open(p, "rb") as f:
        for line in f:
            if line in (b"\n", b"\r\n") or len(lines) >= MAX_HEADER_LINES:
                break
            lines.append(line)
    return b"".join(lines)


def read_mbox(path: Path):
    """Stream (header block, envelope text) for each message. Read-only, low memory."""
    with open(path, "rb") as f:
        prev_blank, collecting, buf, env = True, False, [], None
        for line in f:
            if line.startswith(b"From ") and (prev_blank or ENVELOPE.match(line)):
                if collecting and buf:
                    yield b"".join(buf), env
                buf, collecting = [], True
                env = line[5:].decode("ascii", "replace").strip()
                prev_blank = False
                continue
            blank = line in (b"\n", b"\r\n")
            if collecting:
                if blank or len(buf) >= MAX_HEADER_LINES:
                    yield b"".join(buf), env
                    buf, collecting = [], False
                else:
                    buf.append(line)
            prev_blank = blank
        if collecting and buf:
            yield b"".join(buf), env


def read_source(kind: str, path: Path):
    if kind == "mbox":
        yield from read_mbox(path)
    elif kind == "eml":
        yield read_header_file(path), None
    elif kind == "maildir":
        for sub in ("cur", "new"):
            d = path / sub
            if d.is_dir():
                for f in sorted(d.iterdir()):
                    if f.is_file() and not f.name.startswith("."):
                        yield read_header_file(f), None


# ---- one message's headers --------------------------------------------------------
@dataclass
class Msg:
    key: str
    ts: float | None
    from_addr: str | None
    from_name: str
    subject: str
    parts: list  # (role, name, raw address, canonical address)
    n_to_cc: int
    bulk: bool
    list_post: str | None
    expunged: bool
    label_kind: str | None


def is_bulk(h: dict, first) -> bool:
    if any(k in h for k in BULK_HEADERS):
        return True
    if any(k.startswith(BULK_HEADER_PREFIXES) for k in h):
        return True
    if first("precedence").lower() in ("bulk", "list", "junk"):
        return True
    auto = first("auto-submitted").lower()
    return bool(auto) and auto != "no"


def parse_message(header_bytes: bytes, env: str | None) -> Msg | None:
    if not header_bytes.strip():
        return None
    try:
        msg = HEADER_PARSER.parsebytes(header_bytes)
    except Exception:
        return None
    h: dict[str, list[str]] = {}
    for k, v in msg.raw_items():
        h.setdefault(k.lower(), []).append(unfold(str(v)))

    def first(name: str) -> str:
        vals = h.get(name)
        return raw_to_text(vals[0]).strip() if vals else ""

    parts = []
    for role in ("from", "to", "cc", "bcc"):
        vals = [raw_to_text(v) for v in h.get(role, ())]
        if not vals:
            continue
        for name, addr in parse_addrs(vals):
            key = canon(addr)
            if key:
                raw = addr.strip().strip("<>").strip().lower()
                parts.append((role, clean_name(name, raw), raw, key))
    if not parts:
        return None
    sender = next((p for p in parts if p[0] == "from"), None)
    subject = " ".join(decode_words(first("subject")).split())[:300]
    received = [raw_to_text(v) for v in h.get("received", ())]
    ts = date_ts(first("date"))
    if ts is None and received and ";" in received[0]:
        ts = date_ts(received[0].rsplit(";", 1)[1])
    if ts is None:
        ts = envelope_ts(env)
    mid = first("message-id").strip().strip("<>").strip().lower()
    if mid:
        key = "mid:" + mid
    else:
        blob = "|".join([first("date"), sender[2] if sender else "", subject,
                         ",".join(sorted(p[3] for p in parts))])
        key = "sha1:" + hashlib.sha1(blob.encode("utf-8", "replace")).hexdigest()
    bulk = is_bulk(h, first)
    label_kind = None
    labels = {x.strip().strip('"').lower() for x in first("x-gmail-labels").split(",") if x.strip()}
    if labels:
        if "spam" in labels:
            label_kind = "junk"
        elif any(x.startswith("draft") for x in labels):
            label_kind = "drafts"
        elif "sent" in labels:
            label_kind = "sent"
        if labels & GMAIL_BULK_LABELS:
            bulk = True
    m = re.search(r"mailto:([^>\s,?]+)", first("list-post"), re.I)
    list_post = canon(m.group(1)) if m else None
    expunged = False
    status = first("x-mozilla-status")
    if status:
        try:
            expunged = bool(int(status, 16) & 0x0008)  # Thunderbird: deleted, not yet compacted
        except ValueError:
            pass
    n_to_cc = len({p[3] for p in parts if p[0] in ("to", "cc")})
    return Msg(key, ts, sender[3] if sender else None, sender[1] if sender else "", subject,
               parts, n_to_cc, bulk, list_post, expunged, label_kind)


# ---- load everything into SQLite -------------------------------------------------
SCHEMA = """
CREATE TABLE messages (
  id INTEGER PRIMARY KEY,
  msg_key TEXT NOT NULL UNIQUE,   -- Message-ID, or a hash when there is none
  folder TEXT,
  folder_kind TEXT,               -- sent | other
  date TEXT,                      -- ISO 8601 UTC, NULL when unknown
  ts REAL,                        -- seconds since the epoch
  year INTEGER,
  from_addr TEXT,                 -- canonical address (lowercase, Gmail dots folded)
  from_name TEXT,
  subject TEXT,
  n_to_cc INTEGER,
  is_bulk INTEGER,
  list_post TEXT,
  is_from_self INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE participants (
  message_id INTEGER NOT NULL REFERENCES messages(id),
  role TEXT NOT NULL,             -- from | to | cc | bcc
  addr TEXT NOT NULL,             -- canonical
  addr_raw TEXT,                  -- as written
  name TEXT
);
CREATE TABLE self_addresses (addr TEXT PRIMARY KEY);
"""
VIEWS = """
CREATE INDEX ix_part_msg ON participants(message_id);
CREATE INDEX ix_part_addr ON participants(addr);
CREATE INDEX ix_msg_from ON messages(from_addr);
CREATE VIEW her_sent AS
  SELECT m.id AS message_id, m.date, m.year, m.subject, p.role, p.addr, p.name, m.n_to_cc
  FROM messages m JOIN participants p ON p.message_id = m.id
  WHERE m.is_from_self = 1 AND p.role IN ('to', 'cc', 'bcc')
    AND p.addr NOT IN (SELECT addr FROM self_addresses);
CREATE VIEW received_personal AS
  SELECT m.id AS message_id, m.date, m.year, m.subject, m.from_addr AS addr, m.from_name AS name
  FROM messages m
  WHERE m.is_from_self = 0 AND m.is_bulk = 0 AND m.folder_kind <> 'sent';
"""


def load_sources(conn: sqlite3.Connection, paths: list[str]):
    counts: collections.Counter = collections.Counter()
    folders: collections.Counter = collections.Counter()
    empty_indexed: list[str] = []
    seen: set[str] = set()
    msg_rows, part_rows = [], []
    next_id = 1

    def flush():
        conn.executemany("INSERT INTO messages (id, msg_key, folder, folder_kind, date, ts, year, "
                         "from_addr, from_name, subject, n_to_cc, is_bulk, list_post) "
                         "VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)", msg_rows)
        conn.executemany("INSERT INTO participants VALUES (?,?,?,?,?)", part_rows)
        msg_rows.clear()
        part_rows.clear()

    for kind, path, label in discover(paths, empty_indexed):
        default_kind = folder_kind(label)
        for header_bytes, env in read_source(kind, path):
            counts["read"] += 1
            if counts["read"] % 20000 == 0:
                print(f"  ... {counts['read']:,} messages read", file=sys.stderr)
            m = parse_message(header_bytes, env)
            if m is None:
                counts["unreadable"] += 1
                continue
            if m.expunged:
                counts["deleted copies"] += 1
                continue
            fk = m.label_kind or default_kind
            if fk in ("junk", "drafts"):
                counts[fk] += 1
                continue
            if m.key in seen:
                counts["duplicates"] += 1
                continue
            seen.add(m.key)
            folders[label] += 1
            mid, next_id = next_id, next_id + 1
            msg_rows.append((mid, m.key, label, fk, iso(m.ts), m.ts, year_of(m.ts), m.from_addr,
                             m.from_name, m.subject, m.n_to_cc, int(m.bulk), m.list_post))
            part_rows.extend((mid, role, key, raw, name) for role, name, raw, key in m.parts)
            if len(msg_rows) >= 5000:
                flush()
    flush()
    conn.commit()
    return counts, folders, empty_indexed


def resolve_self(conn: sqlite3.Connection, given: list[str] | None):
    if given:
        addrs = {canon(a) for a in given}
        if None in addrs:
            die("one of the --self addresses is not a valid email address")
        return addrs, "as given"
    rows = conn.execute("SELECT from_addr, COUNT(*) FROM messages WHERE folder_kind = 'sent' "
                        "AND from_addr IS NOT NULL GROUP BY from_addr ORDER BY 2 DESC").fetchall()
    if rows:
        top_addr, top = rows[0]
        addrs = {a for a, c in rows if c >= max(10, 0.05 * top)} | {top_addr}
        her_names = {name_key(n) for (n,) in conn.execute(
            "SELECT DISTINCT from_name FROM messages WHERE from_addr = ?", (top_addr,))} - {None}
        for a, n in conn.execute("SELECT DISTINCT from_addr, from_name FROM messages "
                                 "WHERE folder_kind = 'sent' AND from_addr IS NOT NULL"):
            if name_key(n) in her_names:  # an alias she sent from under her own name
                addrs.add(a)
        return addrs, "from her Sent folder"
    rows = conn.execute("SELECT addr, COUNT(*) FROM participants WHERE role IN ('to', 'cc') "
                        "GROUP BY addr ORDER BY 2 DESC LIMIT 1").fetchall()
    if rows:
        warn("no Sent folder found, so nothing she wrote can be counted. Guessed her address "
             "from To: headers; check it, and make sure the Sent folder was downloaded.")
        return {rows[0][0]}, "guessed from To: headers"
    die("could not work out her address; pass --self")


# ---- scoring ----------------------------------------------------------------------
class AddrStats:
    __slots__ = ("sent_score", "recv_score", "she_wrote", "she_wrote_direct", "they_wrote",
                 "first_ts", "last_ts", "years", "names", "raw_last", "subjects")

    def __init__(self):
        self.sent_score = self.recv_score = 0.0
        self.she_wrote = self.she_wrote_direct = self.they_wrote = 0
        self.first_ts = self.last_ts = None
        self.years: set[int] = set()
        self.names: collections.Counter = collections.Counter()
        self.raw_last: dict[str, float] = {}
        self.subjects: list[tuple[float, str]] = []

    def touch(self, ts, raw, name, subject):
        if ts is not None:
            self.first_ts = ts if self.first_ts is None else min(self.first_ts, ts)
            self.last_ts = ts if self.last_ts is None else max(self.last_ts, ts)
            self.years.add(time.gmtime(ts).tm_year)
        if name:
            self.names[name] += 1
        self.raw_last[raw] = max(self.raw_last.get(raw, -1.0), ts or 0.0)
        if subject:
            self.subjects.append((ts or 0.0, subject))
            if len(self.subjects) > 40:
                self.subjects.sort(reverse=True)
                del self.subjects[10:]


def sent_weight(n: int) -> float:
    for limit, w in SENT_WEIGHTS:
        if n <= limit:
            return w
    return SENT_WEIGHT_MASS


def recv_weight(n: int) -> float:
    for limit, w in RECV_WEIGHTS:
        if n <= limit:
            return w
    return RECV_WEIGHT_MASS


def score_addresses(conn, self_addrs: set[str], half_life: float, ref_ts: float):
    stats: dict[str, AddrStats] = {}
    ignored = collections.Counter()
    rows = conn.execute(
        "SELECT m.id, m.ts, m.from_addr, m.is_from_self, m.is_bulk, m.folder_kind, m.subject, "
        "p.role, p.addr, p.addr_raw, p.name "
        "FROM messages m JOIN participants p ON p.message_id = m.id ORDER BY m.id")
    for _, group in itertools.groupby(rows, key=lambda r: r[0]):
        group = list(group)
        _, ts, from_addr, is_self, bulk, fk, subject = group[0][:7]
        decay = 0.5 ** (max(0.0, (ref_ts - ts) / YEAR_SECONDS) / half_life) if ts else 0.5
        if is_self:
            recips: dict[str, tuple[str, str]] = {}
            for r in group:
                role, addr, raw, name = r[7:11]
                if role in ("to", "cc", "bcc") and addr not in self_addrs:
                    if addr not in recips or (name and not recips[addr][1]):
                        recips[addr] = (raw, name)
            if not recips:
                continue
            n = len(recips)
            w = sent_weight(n) * decay
            for addr, (raw, name) in recips.items():
                s = stats.setdefault(addr, AddrStats())
                s.sent_score += w
                s.she_wrote += 1
                s.she_wrote_direct += n <= DIRECT_MAX
                s.touch(ts, raw, name, subject)
            continue
        if bulk:
            ignored["bulk"] += 1
            continue
        if not from_addr or from_addr in self_addrs or fk == "sent":
            continue
        if looks_automated(from_addr):
            ignored["automated"] += 1
            continue
        to_cc, raw, name = set(), from_addr, ""
        for r in group:
            role, addr, r_raw, r_name = r[7:11]
            if role in ("to", "cc"):
                to_cc.add(addr)
            elif role == "from" and addr == from_addr:
                raw, name = r_raw, r_name
        w = recv_weight(len(to_cc)) if to_cc & self_addrs else BCC_ONLY_WEIGHT
        s = stats.setdefault(from_addr, AddrStats())
        s.recv_score += w * decay
        s.they_wrote += 1
        s.touch(ts, raw, name, subject)
    return stats, ignored


# ---- people ---------------------------------------------------------------------
def load_exclusions(path: str | None):
    addrs, domains = set(), set()
    if not path:
        return addrs, domains
    p = Path(path).expanduser()
    if not p.is_file():
        die(f"--exclude file not found: {p}")
    for line in p.read_text(encoding="utf-8", errors="replace").splitlines():
        line = line.split("#", 1)[0].strip().lower()
        if not line:
            continue
        if "@" in line and not line.startswith("@"):
            k = canon(line)
            if k:
                addrs.add(k)
            else:
                warn(f"--exclude: not an email address, ignored: {line}")
        else:
            domains.add(line.lstrip("@"))
    return addrs, domains


def is_excluded(addr: str, excl) -> bool:
    addrs, domains = excl
    if addr in addrs:
        return True
    dom = addr.rpartition("@")[2]
    return any(dom == d or dom.endswith("." + d) for d in domains)


def read_text_any(p: Path) -> str:
    data = p.read_bytes()
    if data.startswith((b"\xff\xfe", b"\xfe\xff")):
        return data.decode("utf-16")
    for enc in ("utf-8-sig", "cp1252"):
        try:
            return data.decode(enc)
        except UnicodeDecodeError:
            pass
    return data.decode("latin-1")


def load_contacts(path: str | None) -> dict[str, str]:
    book: dict[str, str] = {}
    if not path:
        return book
    p = Path(path).expanduser()
    if not p.is_file():
        die(f"--contacts file not found: {p}")
    reader = csv.DictReader(read_text_any(p).splitlines())
    headers = reader.fieldnames or []
    email_cols = [c for c in headers if re.search(r"e-?mail", c, re.I)
                  and not re.search(r"type|display", c, re.I)]
    if not email_cols:
        warn(f"--contacts: no email column found in {p.name}; ignoring it")
        return book
    for row in reader:
        name = " ".join(x for x in ((row.get("First Name") or "").strip(),
                                    (row.get("Last Name") or "").strip()) if x)
        if not name:
            for c in ("Display Name", "Name", "Full Name", "Nickname"):
                if (row.get(c) or "").strip():
                    name = row[c].strip()
                    break
        for c in email_cols:
            for a in re.split(r"[;,\s]+", row.get(c) or ""):
                k = canon(a)
                if k:
                    book[k] = name
    return book


def build_people(stats, book, excl, self_addrs, own_keys, list_addrs, min_received):
    for addr in book:
        stats.setdefault(addr, AddrStats())
    groups: dict[tuple, list] = {}
    for addr, s in stats.items():
        nm = book.get(addr) or (s.names.most_common(1)[0][0] if s.names else "")
        k = name_key(nm)
        groups.setdefault(("name", k) if k else ("addr", addr), []).append((addr, s, nm))

    people, dropped, own_other = [], collections.Counter(), []
    for gk, members in groups.items():
        addrs = [m[0] for m in members]
        if any(a in self_addrs for a in addrs):
            continue
        if gk[0] == "name" and gk[1] in own_keys:
            own_other.extend(max(s.raw_last, key=s.raw_last.get) if s.raw_last else a
                             for a, s, _ in members)
            continue
        if any(is_excluded(a, excl) for a in addrs):
            dropped["excluded"] += 1
            continue
        ss = [m[1] for m in members]
        she_wrote = sum(s.she_wrote for s in ss)
        they_wrote = sum(s.they_wrote for s in ss)
        in_book = any(a in book for a in addrs)
        is_list = any(a in list_addrs for a in addrs)
        automated = all(looks_automated(a) for a in addrs)
        if automated and she_wrote < 3 and not in_book:
            dropped["automated"] += 1
            continue
        if not (she_wrote >= 1 or they_wrote >= min_received or in_book):
            dropped["below threshold"] += 1
            continue
        score = sum(s.sent_score + s.recv_score for s in ss)
        if she_wrote and they_wrote:
            score *= TWO_WAY_BONUS
        members.sort(key=lambda m: (m[1].last_ts or 0.0), reverse=True)
        primary = next((m for m in members if not looks_automated(m[0])), members[0])
        others = [m for m in members if m is not primary]

        def best_raw(s: AddrStats, addr: str) -> str:
            return max(s.raw_last, key=s.raw_last.get) if s.raw_last else addr

        names = collections.Counter()
        for s in ss:
            names.update(s.names)
        book_names = [book[a] for a in addrs if book.get(a)]
        display = book_names[0] if book_names else (names.most_common(1)[0][0] if names else "")
        firsts = [s.first_ts for s in ss if s.first_ts is not None]
        lasts = [s.last_ts for s in ss if s.last_ts is not None]
        years = set().union(*(s.years for s in ss))
        subjects, seen_subj = [], set()
        for ts, subj in sorted((x for s in ss for x in s.subjects), reverse=True):
            ns = norm_subject(subj)
            if ns and ns.lower() not in seen_subj:
                seen_subj.add(ns.lower())
                subjects.append(ns[:60])
            if len(subjects) == 3:
                break
        flags = []
        if she_wrote and they_wrote:
            flags.append("two-way")
        if in_book:
            flags.append("in her address book")
        if in_book and not she_wrote and not they_wrote:
            flags.append("address book only")
        if is_list:
            flags.append("mailing list: one email reaches the group")
        if automated:
            flags.append("looks automated")
        people.append({
            "notify": "",
            "name": display,
            "first_name": "" if is_list else first_name_of(display),
            "send_to": best_raw(primary[1], primary[0]),
            "score": round(score, 1),
            "she_wrote": she_wrote,
            "she_wrote_direct": sum(s.she_wrote_direct for s in ss),
            "they_wrote": they_wrote,
            "first_year": year_of(min(firsts)) if firsts else "",
            "last_year": year_of(max(lasts)) if lasts else "",
            "years_active": len(years),
            "other_addresses": "; ".join(
                f"{best_raw(m[1], m[0])} (last {year_of(m[1].last_ts) or '?'})" for m in others),
            "names_seen": " / ".join(n for n, _ in names.most_common(3)),
            "recent_subjects": " | ".join(subjects),
            "flags": "; ".join(flags),
            "_last_ts": max(lasts) if lasts else 0.0,
        })
    people.sort(key=lambda p: (-p["score"], -p["_last_ts"]))
    for i, p in enumerate(people, 1):
        p["rank"] = i
    return people, dropped, own_other


# ---- output -----------------------------------------------------------------------
def enclosing_git_repo(p: Path) -> Path | None:
    for parent in (p, *p.parents):
        if (parent / ".git").exists():
            return parent
    return None


def guard_git(out_dir: Path, allow: bool) -> None:
    repo = enclosing_git_repo(out_dir)
    if repo and not allow:
        die(f"{out_dir} is inside the git repository at {repo}. These files hold her "
            "friends' names and addresses, so keep them out of the repo: choose an --out "
            "directory elsewhere (or pass --allow-inside-git if you are sure).")


def csv_cell(v):
    if isinstance(v, str) and v[:1] in ("=", "+", "@", "\t", "\r"):
        return "'" + v  # keep spreadsheet apps from treating text as a formula
    return v


def write_outputs(conn, people, out_dir: Path) -> Path:
    csv_path = out_dir / "correspondents.csv"
    with open(csv_path, "w", newline="", encoding="utf-8-sig") as f:
        w = csv.writer(f)
        w.writerow(CSV_COLUMNS)
        for p in people:
            w.writerow([csv_cell(p[c]) for c in CSV_COLUMNS])
    conn.execute("DROP TABLE IF EXISTS people")
    conn.execute("CREATE TABLE people (" + ", ".join(
        f"{c} {'INTEGER' if c in ('rank', 'she_wrote', 'she_wrote_direct', 'they_wrote', 'years_active') else 'REAL' if c == 'score' else 'TEXT'}"
        for c in CSV_COLUMNS) + ")")
    conn.executemany(f"INSERT INTO people VALUES ({','.join('?' * len(CSV_COLUMNS))})",
                     [[p[c] for c in CSV_COLUMNS] for p in people])
    conn.commit()
    private(csv_path)
    return csv_path


def private(p: Path) -> None:
    try:
        os.chmod(p, 0o600)  # these files hold other people's names and addresses
    except OSError:
        pass


def rank_main(argv: list[str]) -> int:
    ap = argparse.ArgumentParser(
        description="Rank the people a mailbox's owner corresponded with, from a local copy of "
                    "the mail. Headers only; nothing leaves this machine.",
        epilog="After review: rank_correspondents.py send-list correspondents.csv")
    ap.add_argument("paths", nargs="+", help="mail folders or files: a Thunderbird ImapMail/<server> "
                    "folder, mbox files, a Maildir, or a folder of .eml files")
    ap.add_argument("--self", dest="self_addrs", action="append", metavar="ADDRESS",
                    help="her address (repeat for aliases); default: worked out from her Sent folder")
    ap.add_argument("--exclude", metavar="FILE", help="addresses or domains to leave out, one per line")
    ap.add_argument("--contacts", metavar="CSV", help="her address book exported as CSV")
    ap.add_argument("--out", default="~/jo-mail-review", help="output directory (default: %(default)s)")
    ap.add_argument("--half-life", type=float, default=DEFAULT_HALF_LIFE, metavar="YEARS",
                    help="older mail counts half as much every this many years (default: %(default)s)")
    ap.add_argument("--min-received", type=int, default=2, metavar="N",
                    help="list someone she never wrote to only if they wrote to her at least N "
                         "times (default: %(default)s)")
    ap.add_argument("--top", type=int, default=25, help="rows to print here (default: %(default)s)")
    ap.add_argument("--allow-inside-git", action="store_true", help=argparse.SUPPRESS)
    args = ap.parse_args(argv)

    out_dir = Path(args.out).expanduser().resolve()
    guard_git(out_dir, args.allow_inside_git)
    out_dir.mkdir(parents=True, exist_ok=True)
    try:
        os.chmod(out_dir, 0o700)
    except OSError:
        pass
    db_path = out_dir / "mail.sqlite"
    if db_path.exists():
        db_path.unlink()
    conn = sqlite3.connect(db_path)
    conn.executescript(SCHEMA)

    started = time.time()
    counts, folders, empty_indexed = load_sources(conn, args.paths)
    total = sum(folders.values())
    if not total:
        die("no messages found. Point this at the folder that holds the mail files "
            "(for Thunderbird, ImapMail/<server> inside the profile).")

    self_addrs, how = resolve_self(conn, args.self_addrs)
    conn.executemany("INSERT INTO self_addresses VALUES (?)", [(a,) for a in sorted(self_addrs)])
    conn.execute(f"UPDATE messages SET is_from_self = 1 WHERE from_addr IN "
                 f"({','.join('?' * len(self_addrs))})", sorted(self_addrs))
    conn.executescript(VIEWS)
    conn.commit()
    n_self = conn.execute("SELECT COUNT(*) FROM messages WHERE is_from_self = 1").fetchone()[0]
    own_keys = {name_key(n) for (n,) in conn.execute(
        "SELECT DISTINCT from_name FROM messages WHERE is_from_self = 1 AND from_name <> ''")}
    own_keys.discard(None)
    list_addrs = {a for (a,) in conn.execute(
        "SELECT DISTINCT list_post FROM messages WHERE list_post IS NOT NULL")}
    ref_ts = conn.execute("SELECT MAX(ts) FROM messages").fetchone()[0] or NOW
    y0, y1 = conn.execute("SELECT MIN(year), MAX(year) FROM messages").fetchone()

    stats, ignored = score_addresses(conn, self_addrs, args.half_life, ref_ts)
    book = load_contacts(args.contacts)
    excl = load_exclusions(args.exclude)
    people, dropped, own_other = build_people(stats, book, excl, self_addrs, own_keys,
                                              list_addrs, args.min_received)
    csv_path = write_outputs(conn, people, out_dir)
    conn.close()
    private(db_path)

    skipped = ", ".join(f"{v:,} {k}" for k, v in counts.items() if k != "read" and v)
    print(f"Read {total:,} messages from {len(folders)} folder{'s' * (len(folders) != 1)} ({y0}-{y1}) in "
          f"{time.time() - started:.0f}s." + (f" Skipped {skipped}." if skipped else ""))
    print(f"Her address{'es' if len(self_addrs) > 1 else ''} ({how}): {', '.join(sorted(self_addrs))}"
          f"; {n_self:,} messages from her.")
    if own_other:
        print(f"Treated as her own other addresses (same name as hers): {', '.join(sorted(own_other))}")
    print(f"Ignored {ignored['bulk']:,} bulk and {ignored['automated']:,} automated messages.")
    drop = ", ".join(f"{v:,} {k}" for k, v in dropped.items() if v)
    print(f"Wrote {len(people):,} {'person' if len(people) == 1 else 'people'} to {csv_path}"
          + (f" (left out: {drop})" if drop else ""))
    print(f"SQL: sqlite3 {db_path}   (tables messages, participants, people; views her_sent, "
          f"received_personal)")
    if people and args.top:
        print(f"\n{'#':>4}  {'score':>7}  {'she/they':>9}  {'years':<9}  {'name':<26}  send_to")
        for p in people[:args.top]:
            span = f"{p['first_year']}-{p['last_year']}" if p["first_year"] else ""
            print(f"{p['rank']:>4}  {p['score']:>7}  {str(p['she_wrote']) + '/' + str(p['they_wrote']):>9}"
                  f"  {span:<9}  {(p['name'] or '')[:26]:<26}  {p['send_to']}")
    if empty_indexed:
        shown = ", ".join(empty_indexed[:12]) + (" ..." if len(empty_indexed) > 12 else "")
        warn(f"these folders have a Thunderbird index but no messages on disk, so they were not "
             f"downloaded and are missing from the ranking: {shown}. Turn on offline storage for "
             f"them (Account Settings > Synchronization & Storage), sync, and run this again.")
    if n_self == 0:
        warn("found no mail from her, so the ranking only reflects mail she received. "
             "Check --self and that her Sent folder was downloaded.")
    return 0


def parse_gap(s: str) -> tuple[int, int]:
    m = re.fullmatch(r"\s*(\d+)\s*(?:-\s*(\d+)\s*)?", s)
    if not m:
        die("--gap takes minutes as MIN-MAX, for example 30-90")
    lo, hi = int(m.group(1)), int(m.group(2) or m.group(1))
    if lo < 1 or hi < lo:
        die("--gap needs 1 <= MIN <= MAX")
    return lo, hi


def parse_hours(s: str) -> tuple[dt.time, dt.time]:
    m = re.fullmatch(r"\s*(\d{1,2})(?::(\d{2}))?\s*-\s*(\d{1,2})(?::(\d{2}))?\s*", s)
    if not m:
        die("--hours takes local times as START-END, for example 9-19 or 8:30-20:00")
    h0, m0, h1, m1 = (int(x or 0) for x in m.groups())
    if not (h0 <= 23 and h1 <= 23 and m0 < 60 and m1 < 60):
        die("--hours: use 24-hour times")
    opens, closes = dt.time(h0, m0), dt.time(h1, m1)
    if closes <= opens:
        die("--hours: the end must be later than the start")
    return opens, closes


def parse_local(s: str) -> dt.datetime:
    for fmt in ("%Y-%m-%d %H:%M", "%Y-%m-%dT%H:%M"):
        try:
            return dt.datetime.strptime(s.strip(), fmt)
        except ValueError:
            pass
    die(f"--start must look like '2026-11-07 09:00', not {s!r}")


def make_schedule(n: int, start: dt.datetime, lo: int, hi: int, opens: dt.time,
                  closes: dt.time, rng: random.Random) -> list[dt.datetime]:
    """Local send times, each lo-hi minutes after the last, all inside the daily window."""
    def fit(t: dt.datetime) -> dt.datetime:
        day_open = dt.datetime.combine(t.date(), opens)
        if t < day_open:
            return day_open + dt.timedelta(minutes=rng.randint(0, 15))
        if t > dt.datetime.combine(t.date(), closes):
            return day_open + dt.timedelta(days=1, minutes=rng.randint(0, 15))
        return t

    times, t = [], fit(start)
    for i in range(n):
        if i:
            t = fit(t + dt.timedelta(minutes=rng.randint(lo, hi)))
        times.append(t)
    return times


def send_list_main(argv: list[str]) -> int:
    ap = argparse.ArgumentParser(
        prog="rank_correspondents.py send-list",
        description="Turn the reviewed correspondents.csv into a mail-merge list of the rows "
                    "marked in the notify column (y, yes or x), in rank order. With --gap, each "
                    "row also gets a send_at time for Mail Merge's At field (Send Later add-on).")
    ap.add_argument("reviewed_csv")
    ap.add_argument("--out", help="default: send_list.csv next to the reviewed file")
    ap.add_argument("--gap", metavar="MIN-MAX",
                    help="minutes between sends, picked at random in this range, e.g. 30-90")
    ap.add_argument("--hours", default="9-19", metavar="START-END",
                    help="only schedule sends between these local hours (default: %(default)s)")
    ap.add_argument("--start", metavar="'YYYY-MM-DD HH:MM'",
                    help="first send, local time (default: about 30 minutes from now, moved "
                         "into --hours)")
    ap.add_argument("--seed", type=int, help=argparse.SUPPRESS)
    ap.add_argument("--allow-inside-git", action="store_true", help=argparse.SUPPRESS)
    args = ap.parse_args(argv)
    src = Path(args.reviewed_csv).expanduser().resolve()
    if not src.is_file():
        die(f"not found: {src}")
    dst = Path(args.out).expanduser().resolve() if args.out else src.with_name("send_list.csv")
    guard_git(dst.parent, args.allow_inside_git)
    marked = []
    for i, r in enumerate(csv.DictReader(read_text_any(src).splitlines())):
        if (r.get("notify") or "").strip().lower() not in YES:
            continue
        try:
            order = float((r.get("rank") or "").strip())
        except ValueError:
            order = float("inf")
        marked.append((order, i, r))
    marked.sort(key=lambda x: (x[0], x[1]))  # closest people first, even if the sheet was re-sorted
    rows, seen, no_first, bad = [], set(), [], []
    for _, _, r in marked:
        addr = (r.get("send_to") or "").strip().lstrip("'")
        key = canon(addr)
        if not key:
            bad.append(addr or r.get("name") or "?")
            continue
        if key in seen:
            continue
        seen.add(key)
        first = (r.get("first_name") or "").strip()
        if not first:
            no_first.append(addr)
        rows.append({"email": addr, "first_name": first, "name": (r.get("name") or "").strip()})
    if not rows:
        die("no rows are marked y in the notify column")

    fields = ["email", "first_name", "name"]
    times = []
    if args.gap:
        lo, hi = parse_gap(args.gap)
        opens, closes = parse_hours(args.hours)
        now = dt.datetime.now().replace(second=0, microsecond=0)
        if args.start:
            start = parse_local(args.start)
            if start <= now:
                die("--start is in the past")
        else:
            start = now + dt.timedelta(minutes=30 + (-now.minute) % 5)
        times = make_schedule(len(rows), start, lo, hi, opens, closes, random.Random(args.seed))
        for row, t in zip(rows, times):
            row["send_at"] = t.strftime("%Y-%m-%d %H:%M")
        fields.append("send_at")

    with open(dst, "w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=fields)
        w.writeheader()
        w.writerows(rows)
    private(dst)
    print(f"{len(rows):,} people marked to notify, closest first -> {dst}")
    if times:
        print(f"Sends {lo}-{hi} minutes apart, only {opens:%H:%M}-{closes:%H:%M} "
              f"on this computer's clock:")
        for day, group in itertools.groupby(times, key=lambda t: t.date()):
            g = list(group)
            print(f"  {day:%a %b %d}: {len(g):>3} messages, {g[0]:%H:%M} to {g[-1]:%H:%M}")
    if no_first:
        warn(f"no first_name for {len(no_first)} of them, so a {{{{first_name}}}} subject or "
             "greeting would come out blank. Fill them in and run send-list again: "
             + ", ".join(no_first[:10]) + (" ..." if len(no_first) > 10 else ""))
    if bad:
        warn("not a valid address, left out: " + ", ".join(bad[:10]))
    return 0


def main(argv: list[str] | None = None) -> int:
    argv = sys.argv[1:] if argv is None else argv
    if argv and argv[0] == "send-list":
        return send_list_main(argv[1:])
    return rank_main(argv)


if __name__ == "__main__":
    sys.exit(main())
