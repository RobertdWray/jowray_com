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

  --exclude is a text file of addresses ("someone@example.com") or domains
  ("example.com"), one per line, # for comments: family, people already told.
  A person is dropped if any of their addresses match. Repeat it for more files.

  --contacts is her address book exported as CSV (Outlook.com: People, Manage
  contacts, Export contacts). It adds names and an "in her address book" flag.

STEP 1b, optional: re-rank after the list is cleaned up (cleanup_correspondents.py
writes identities.csv and correspondents_removed.csv):

  python3 rank_correspondents.py rescore --db ~/jo-mail-review/mail.sqlite \\
      --self someone@example.com --identities ~/jo-mail-review/identities.csv \\
      --removed ~/jo-mail-review/correspondents_removed.csv \\
      --source ~/jo-mail-review/correspondents.csv --out ~/jo-mail-review

  Reads mail.sqlite read-only and writes correspondents_cleaned.csv: exactly the
  cleaned-up people, re-scored, with the cleanup's extra columns appended. It
  refuses to write unless every address of every source row is either kept in
  one person or listed in one removal.

STEP 2, family review: mark notify and correct names and accounts, then export
as CSV UTF-8. Pass --self once per account, primary first, in every command.

  python3 rank_correspondents.py send-list ~/jo-mail-review/correspondents.csv \\
      --self someone@example.com --out ~/jo-mail-review

  Writes send_list.csv (email, first_name, last_name, name, account), without
  times. Next run scripts/import-invites.ts to create the private invites.csv
  ledger. Immediately before each Mail Merge, run:

  python3 rank_correspondents.py schedule ~/jo-mail-review/send_list.csv \\
      --ledger ~/jo-mail-review/invites.csv --self someone@example.com \\
      --start "YYYY-MM-DD HH:MM" --out ~/jo-mail-review

  Each account has its own clock: random 30-90 minute gaps, 09:00-19:00 local.
  Outputs use neutral names: send_list_primary.csv, send_list_second.csv.
  In Thunderbird Mail Merge: Deliver Mode = Save As Draft, Send Later active,
  At = {{send_at}}. Re-run schedule just before each merge; it rejects past starts.

How the score works (the constants below are the knobs):
  Every message adds weight to the people on it. Older mail counts for less: it
  halves every --half-life years, counted back from the newest message. Mail
  that went both ways gets a 25% bonus.
    she wrote to them   4 (just them), 3 (2-3 people), 1.5 (4-8), 0.75 (9-20),
                        0.25 (more: chain forwards)
    they wrote to her   1.5 (to 1-2 people), 1 (3-5), 0.5 (6-15), 0.15 (more),
                        0.3 if she was only Bcc'd
  Mailing-list, bulk and automated mail (List-*, Precedence, Auto-Submitted,
  bulk-sender headers, noreply@ and friends, including look-alike spellings such
  as fullwidth "ｉｎｆｏ@") adds nothing. Junk, Drafts, Outbox and Templates are
  skipped. Addresses that share the same full name count as one person, and each
  message counts once per person: two of someone's addresses on one message are
  one recipient. email is the address the household most recently wrote to, else
  the most recently seen one (non-automated addresses first).
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
import errno
import functools
import hashlib
import io
import itertools
import os
import random
import re
import secrets
import sqlite3
import stat
import sys
import time
import unicodedata
from contextlib import closing, contextmanager
from dataclasses import dataclass
from pathlib import Path
from urllib.parse import urlsplit

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
TITLES = {"mr", "mrs", "ms", "miss", "dr", "rev", "reverend", "fr", "father", "sister",
          "brother", "sr", "prof", "pastor"}
NAME_SUFFIXES = {"jr", "sr", "ii", "iii", "iv", "md", "phd", "rn", "esq", "dds", "dmd",
                 "do", "dvm", "cpa", "jd", "mba", "msw", "lcsw", "np", "pa", "od", "rph"}
SHORT_CREDENTIALS = {"md", "rn", "do", "jd", "np", "pa", "od"}
NAME_SUFFIX = re.compile(r"(?P<separator>^|[\s,]+)(?P<suffix>(?:" + "|".join(
    r"\.?".join(word) for word in sorted(NAME_SUFFIXES)) + r")\.*),*\s*$", re.I)
NAME_PARTICLES = {"van", "von", "de", "da", "del", "der", "du", "la", "le", "st"}
YES = {"y", "yes", "x", "1", "true", "✓", "✔", "✅", "☑"}
NO = {"", "n", "no", "0", "false", "-"}

CSV_COLUMNS = [
    "rank", "notify", "first_name", "last_name", "email", "name", "account", "account_basis",
    "score", "she_wrote", "she_wrote_direct",
    "they_wrote", "first_year", "last_year", "years_active", "other_addresses", "names_seen",
    "recent_subjects", "flags",
]
SEND_COLUMNS = ["email", "first_name", "last_name", "name", "account"]
ACCOUNT_BASES = ("from", "to", "cc", "delivered", "folder")
GUARDED_PREFIXES = ("=", "+", "-", "@", "\t", "\r", "\n", "＝", "＋", "－", "＠")


class PrivateArgumentParser(argparse.ArgumentParser):
    def error(self, message):
        # argparse's normal error includes raw arguments (possibly personal data).
        die("invalid or missing command arguments; use --help")


def private_errors(fn):
    """Report operational failures without exposing filenames or CSV contents."""
    @functools.wraps(fn)
    def run(*args, **kwargs):
        try:
            return fn(*args, **kwargs)
        except (OSError, sqlite3.Error, csv.Error, UnicodeError) as exc:
            die(f"operation failed ({type(exc).__name__}); check input format, paths and permissions")
    return run


def warn(msg: str) -> None:
    print(f"warning: {msg}", file=sys.stderr)


def die(msg: str) -> None:
    print(f"error: {msg}", file=sys.stderr)
    sys.exit(2)


def quantity(n: int, singular: str, plural: str | None = None) -> str:
    return f"{n:,} {singular if n == 1 else plural or singular + 's'}"


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


def without_name_suffix(name: str) -> str:
    n = re.sub(r"\(.*?\)|\[.*?\]", " ", name)
    # Preserve the original display name in the evidence; remove decorations only
    # when deriving the greeting and surname. Keep letters and combining accents.
    n = "".join(" " if unicodedata.category(c).startswith("S") or c in "\ufe0e\ufe0f\u200d"
                else c for c in n)
    while True:
        match = NAME_SUFFIX.search(n)
        if not match:
            break
        suffix = match.group("suffix")
        if suffix.replace(".", "").lower() in SHORT_CREDENTIALS:
            prior_names = [word for word in re.split(r"[\s,]+", n[:match.start()])
                           if word and word.lower().rstrip(".") not in TITLES]
            if not ("," in match.group("separator") or "." in suffix
                    or (suffix.isupper() and len(prior_names) >= 2)):
                break  # A short undotted word can be a surname, including an uppercase one.
        n = n[:match.start()]
    n = " ".join(n.split()).rstrip(" ,")
    if re.search(r"\b(family|families)[.,]*$", n, re.I):
        return ""
    return n.title() if n.isupper() else n


def first_name_of(name: str) -> str:
    n = without_name_suffix(name)
    if "," in n:
        n = n.partition(",")[2]
    toks = n.split()
    titled = bool(toks and toks[0].lower().rstrip(".") in TITLES)
    while toks and toks[0].lower().rstrip(".") in TITLES:
        toks.pop(0)
    if not toks or (titled and len(toks) == 1):
        return ""
    f = toks[0].strip("'\".,;")
    if len(toks) == 1 and re.search(r"[\d_.@]", f):
        return ""  # looks like a username, not a name
    if f.isupper() or f.islower():
        f = f.capitalize()
    return f


def last_name_of(name: str) -> str:
    n = without_name_suffix(name)
    if "," in n:
        return n.partition(",")[0].strip()
    tokens = n.split()
    while tokens and tokens[0].lower().rstrip(".") in TITLES:
        tokens.pop(0)
    if len(tokens) < 2:
        return ""
    start = len(tokens) - 1
    while start > 1 and tokens[start - 1].lower().rstrip(".") in NAME_PARTICLES:
        start -= 1
    return " ".join(tokens[start:]).strip("'\".,;")


def looks_automated(addr: str) -> bool:
    local, _, domain = addr.rpartition("@")
    # Fold compatibility look-alikes (fullwidth "ｉｎｆｏ", superscript "ⁱⁿᶠᵒ") before the
    # role match, so a disguised role address is recognised as one.
    folded = unicodedata.normalize("NFKC", local).casefold()
    if ROLE_LOCAL.match(folded) or ESP_SUBDOMAIN.match(domain):
        return True
    return any(domain == d or domain.endswith("." + d) for d in AUTOMATED_DOMAINS)


def has_lookalike(addr: str) -> bool:
    """True when the local part uses compatibility characters that NFKC folds away.

    Comparing against NFC (not the raw text) keeps decomposed accents, which only
    differ canonically, from counting as look-alikes. Plain ASCII never differs.
    """
    local = addr.rpartition("@")[0]
    return unicodedata.normalize("NFKC", local) != unicodedata.normalize("NFC", local)


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
    if p.stat().st_size == 0:
        return "empty"
    with open(p, "rb") as f:
        head = f.read(5)
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


def refuse_source_errors(count: int) -> None:
    if count:
        die(f"{quantity(count, 'mail source')} could not be read (missing or permission denied); "
            "fix access and re-run")


def check_source_paths(paths: list[str]) -> None:
    """Check every argument before reading mail, including later account paths."""
    errors = 0
    for arg in paths:
        try:
            Path(arg).expanduser().stat()
        except OSError:
            errors += 1
    refuse_source_errors(errors)


def discover(paths: list[str], empty_indexed: list[str], counts=None):
    """Yield (kind, path, folder label) for every mail source under the given paths."""
    counts = collections.Counter() if counts is None else counts

    def onerror(_error):
        counts["source errors"] += 1

    for arg in paths:
        root = Path(arg).expanduser()
        try:
            is_file = stat.S_ISREG(root.stat().st_mode)
            kind = sniff(root) if is_file else None
        except OSError as exc:
            onerror(exc)
            continue
        if is_file:
            if kind in ("mbox", "eml"):
                yield kind, root, folder_label(root.parent, root)
            else:
                warn("1 source is not an mbox or .eml file, skipping")
            continue
        for dirpath, dirnames, filenames in os.walk(root, onerror=onerror):
            d = Path(dirpath)
            dirnames.sort()
            if (d / "cur").is_dir() and (d / "new").is_dir():
                yield "maildir", d, folder_label(root, d)
                dirnames[:] = [x for x in dirnames if x not in ("cur", "new", "tmp")]
                continue  # files at a Maildir's top level are bookkeeping, not mail
            for fn in sorted(filenames):
                p = d / fn
                try:
                    kind = sniff(p)
                    if kind == "empty":
                        msf = p.with_name(p.name + ".msf")
                        if msf.is_file() and msf.stat().st_size > 4096:
                            empty_indexed.append(folder_label(root, p))
                    elif kind:
                        yield kind, p, folder_label(root, p)
                except OSError as exc:
                    onerror(exc)


def read_header_file(p: Path) -> bytes:
    lines = []
    with open(p, "rb") as f:
        for line in f:
            if line in (b"\n", b"\r\n") or len(lines) >= MAX_HEADER_LINES:
                break
            lines.append(line)
    return b"".join(lines)


def iter_mbox(path: Path):
    """Stream (header block, envelope text, start, end) for each message.

    start is the byte offset of the message's "From " envelope line and end is the
    next message's start (or the end of the file), so a later reader can find the
    message again. Only header lines are kept in memory; bodies are skipped, never
    decoded. Read-only, low memory.
    """
    with open(path, "rb") as f:
        prev_blank, collecting, buf, env = True, False, [], None
        start, pos, pending = 0, 0, None  # pending: a finished header awaiting its end offset
        for line in f:
            line_start, pos = pos, pos + len(line)
            if line.startswith(b"From ") and (prev_blank or ENVELOPE.match(line)):
                if collecting and buf:
                    pending = (b"".join(buf), env, start)
                if pending is not None:
                    yield pending + (line_start,)
                    pending = None
                buf, collecting, start = [], True, line_start
                env = line[5:].decode("ascii", "replace").strip()
                prev_blank = False
                continue
            blank = line in (b"\n", b"\r\n")
            if collecting:
                if blank or len(buf) >= MAX_HEADER_LINES:
                    pending = (b"".join(buf), env, start)
                    buf, collecting = [], False
                else:
                    buf.append(line)
            prev_blank = blank
        if collecting and buf:
            pending = (b"".join(buf), env, start)
        if pending is not None:
            yield pending + (pos,)


def read_mbox(path: Path):
    """Stream (header block, envelope text) for each message. Read-only, low memory."""
    for header_bytes, env, _start, _end in iter_mbox(path):
        yield header_bytes, env


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
    delivered: list[str]


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
    delivered = [address for _, addr in parse_addrs([
        raw_to_text(v) for field in ("delivered-to", "x-original-to") for v in h.get(field, ())])
        if (address := canon(addr))]
    return Msg(key, ts, sender[3] if sender else None, sender[1] if sender else "", subject,
               parts, n_to_cc, bulk, list_post, expunged, label_kind, delivered)


# ---- load everything into SQLite -------------------------------------------------
SCHEMA = """
CREATE TABLE messages (
  id INTEGER PRIMARY KEY,
  msg_key TEXT NOT NULL UNIQUE,   -- Message-ID, or a hash when there is none
  folder TEXT,
  folder_kind TEXT,               -- sent | other
  source_root INTEGER,            -- position of the path argument of the kept copy
  account TEXT,
  account_basis TEXT,             -- from | to | cc | delivered | folder
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
  role TEXT NOT NULL,             -- from | to | cc | bcc | delivered
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
    check_source_paths(paths)
    counts: collections.Counter = collections.Counter()
    folders: collections.Counter = collections.Counter()
    empty_indexed: list[str] = []
    seen: set[str] = set()
    msg_rows, part_rows = [], []
    next_id = 1

    def flush():
        conn.executemany("INSERT INTO messages (id, msg_key, folder, folder_kind, date, ts, year, "
                         "from_addr, from_name, subject, n_to_cc, is_bulk, list_post, source_root) "
                         "VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)", msg_rows)
        conn.executemany("INSERT INTO participants VALUES (?,?,?,?,?)", part_rows)
        msg_rows.clear()
        part_rows.clear()

    def readable_headers(kind, path):
        try:
            yield from read_source(kind, path)
        except OSError:
            counts["source errors"] += 1

    sources = ((root, source) for root, arg in enumerate(paths)
               for source in discover([arg], empty_indexed, counts))
    for root, (kind, path, label) in sources:
        default_kind = folder_kind(label)
        for header_bytes, env in readable_headers(kind, path):
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
                             m.from_name, m.subject, m.n_to_cc, int(m.bulk), m.list_post, root))
            part_rows.extend((mid, role, key, raw, name) for role, name, raw, key in m.parts)
            part_rows.extend((mid, "delivered", addr, addr, "") for addr in m.delivered)
            if len(msg_rows) >= 5000:
                flush()
    refuse_source_errors(counts["source errors"])
    flush()
    conn.commit()
    return counts, folders, empty_indexed


def resolve_self(conn: sqlite3.Connection, given: list[str] | None):
    if given:
        addrs = list(dict.fromkeys(canon(a) for a in given))
        if None in addrs:
            die("one of the --self addresses is not a valid email address")
        return addrs, "as given"
    rows = conn.execute("SELECT from_addr, COUNT(*) FROM messages WHERE folder_kind = 'sent' "
                        "AND from_addr IS NOT NULL GROUP BY from_addr ORDER BY 2 DESC, from_addr").fetchall()
    if rows:
        top_addr, top = rows[0]
        addrs = {a for a, c in rows if c >= max(10, 0.05 * top)} | {top_addr}
        her_names = {name_key(n) for (n,) in conn.execute(
            "SELECT DISTINCT from_name FROM messages WHERE from_addr = ?", (top_addr,))} - {None}
        for a, n in conn.execute("SELECT DISTINCT from_addr, from_name FROM messages "
                                 "WHERE folder_kind = 'sent' AND from_addr IS NOT NULL"):
            if name_key(n) in her_names:  # an alias she sent from under her own name
                addrs.add(a)
        return [a for a, _ in rows if a in addrs], "from her Sent folder"
    rows = conn.execute("SELECT addr, COUNT(*) FROM participants WHERE role IN ('to', 'cc') "
                        "GROUP BY addr ORDER BY 2 DESC LIMIT 1").fetchall()
    if rows:
        warn("no Sent folder found, so nothing she wrote can be counted. Guessed her address "
             "from To: headers; check it, and make sure the Sent folder was downloaded.")
        return [rows[0][0]], "guessed from To: headers"
    die("could not work out her address; pass --self")


def assign_accounts(conn, self_addrs):
    """Attribute headers first, then infer each source root from its kept messages."""
    roots = collections.defaultdict(collections.Counter)
    updates, fallback = [], []
    rows = conn.execute("SELECT m.id, m.source_root, m.from_addr, p.role, p.addr "
                        "FROM messages m JOIN participants p ON p.message_id = m.id ORDER BY m.id")
    for mid, group in itertools.groupby(rows, key=lambda r: r[0]):
        group = list(group)
        _, root, sender, _, _ = group[0]
        account, basis = None, None
        if sender in self_addrs:
            account, basis = sender, "from"
        else:
            for role in ("to", "cc", "delivered"):
                recipients = {r[4] for r in group if r[3] == role}
                account = next((a for a in self_addrs if a in recipients), None)
                if account:
                    basis = role
                    break
        if account:
            roots[root][account] += 1
            updates.append((account, basis, mid))
        else:
            fallback.append((root, mid))
    inferred = {root: max(self_addrs, key=lambda a: counts[a]) for root, counts in roots.items()}
    updates.extend((inferred.get(root, self_addrs[0]), "folder", mid) for root, mid in fallback)
    conn.executemany("UPDATE messages SET account = ?, account_basis = ? WHERE id = ?", updates)
    conn.commit()


# ---- scoring ----------------------------------------------------------------------
# Two passes. Pass 1 (collect_address_stats) gathers per-address evidence: names,
# dates and subjects. The addresses are then resolved to people (person_keys), and
# pass 2 (score_people) weighs each message once per person, so two aliases of one
# person on the same message count as one recipient and one message.
class AddrStats:
    """Evidence for one address: when it was seen, under which names and subjects."""
    __slots__ = ("first_ts", "last_ts", "last_sent_ts", "years", "names", "raw_last", "subjects")

    def __init__(self):
        self.first_ts = self.last_ts = None
        self.last_sent_ts = None  # newest household-sent message to this address
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


class Tally:
    """Weighted message counts for one person (pass 2)."""
    __slots__ = ("sent_score", "recv_score", "she_wrote", "she_wrote_direct", "they_wrote",
                 "account_scores", "account_bases")

    def __init__(self):
        self.sent_score = self.recv_score = 0.0
        self.she_wrote = self.she_wrote_direct = self.they_wrote = 0
        self.account_scores: collections.Counter = collections.Counter()
        self.account_bases: collections.Counter = collections.Counter()


@dataclass
class ScoredMessage:
    ts: float | None
    subject: str
    account: str | None
    basis: str | None
    recipients: dict | None  # household-sent: address -> (raw, name); else None
    sender: tuple | None     # inbound: (address, raw, name, To/Cc address set); else None


def scored_messages(conn, self_addrs, ignored: collections.Counter | None = None):
    """Yield the messages that carry weight, after the same skips for both passes."""
    self_addrs = set(self_addrs)
    rows = conn.execute(
        "SELECT m.id, m.ts, m.from_addr, m.is_from_self, m.is_bulk, m.folder_kind, m.subject, "
        "p.role, p.addr, p.addr_raw, p.name, m.account, m.account_basis "
        "FROM messages m JOIN participants p ON p.message_id = m.id ORDER BY m.id")
    for _, group in itertools.groupby(rows, key=lambda r: r[0]):
        group = list(group)
        _, ts, from_addr, is_self, bulk, fk, subject = group[0][:7]
        account, basis = group[0][11:13]
        if is_self:
            recips: dict[str, tuple[str, str]] = {}
            for r in group:
                role, addr, raw, name = r[7:11]
                if role in ("to", "cc", "bcc") and addr not in self_addrs:
                    if addr not in recips or (name and not recips[addr][1]):
                        recips[addr] = (raw, name)
            if recips:
                yield ScoredMessage(ts, subject, account, basis, recips, None)
            continue
        if bulk:
            if ignored is not None:
                ignored["bulk"] += 1
            continue
        if not from_addr or from_addr in self_addrs or fk == "sent":
            continue
        if looks_automated(from_addr):
            if ignored is not None:
                ignored["automated"] += 1
            continue
        to_cc, raw, name = set(), from_addr, ""
        for r in group:
            role, addr, r_raw, r_name = r[7:11]
            if role in ("to", "cc"):
                to_cc.add(addr)
            elif role == "from" and addr == from_addr:
                raw, name = r_raw, r_name
        yield ScoredMessage(ts, subject, account, basis, None, (from_addr, raw, name, to_cc))


def collect_address_stats(conn, self_addrs):
    """Pass 1: per-address names, dates, subjects and the newest household-sent date."""
    stats: dict[str, AddrStats] = {}
    ignored = collections.Counter()
    for m in scored_messages(conn, self_addrs, ignored):
        if m.recipients is not None:
            for addr, (raw, name) in m.recipients.items():
                s = stats.setdefault(addr, AddrStats())
                s.touch(m.ts, raw, name, m.subject)
                if m.ts is not None:
                    s.last_sent_ts = m.ts if s.last_sent_ts is None else max(s.last_sent_ts, m.ts)
        else:
            addr, raw, name, _ = m.sender
            stats.setdefault(addr, AddrStats()).touch(m.ts, raw, name, m.subject)
    return stats, ignored


def score_people(conn, resolve, self_addrs, half_life: float, ref_ts: float):
    """Pass 2: weigh every message once per person. resolve maps an address to a person key."""
    self_addrs = set(self_addrs)
    scores: dict = {}
    for m in scored_messages(conn, self_addrs):
        ts = m.ts
        decay = 0.5 ** (max(0.0, (ref_ts - ts) / YEAR_SECONDS) / half_life) if ts else 0.5
        if m.recipients is not None:
            persons = list(dict.fromkeys(resolve(addr) for addr in m.recipients))
            n = len(persons)  # distinct non-household people, not addresses
            w = sent_weight(n) * decay
            for person in persons:
                t = scores.setdefault(person, Tally())
                t.sent_score += w
                t.account_scores[m.account] += w
                t.account_bases[m.account, m.basis] += w
                t.she_wrote += 1
                t.she_wrote_direct += n <= DIRECT_MAX
            continue
        addr, _, _, to_cc = m.sender
        w = recv_weight(len(to_cc)) if to_cc & self_addrs else BCC_ONLY_WEIGHT
        t = scores.setdefault(resolve(addr), Tally())
        t.recv_score += w * decay
        t.account_scores[m.account] += w * decay
        t.account_bases[m.account, m.basis] += w * decay
        t.they_wrote += 1
    return scores


# ---- people ---------------------------------------------------------------------
def load_exclusions(path: str | None):
    addrs, domains = set(), set()
    if not path:
        return addrs, domains
    p = Path(path).expanduser()
    if not p.is_file():
        die("--exclude file not found")
    for line in p.read_text(encoding="utf-8", errors="replace").splitlines():
        line = line.split("#", 1)[0].strip().lower()
        if not line:
            continue
        if "@" in line and not line.startswith("@"):
            k = canon(line)
            if k:
                addrs.add(k)
            else:
                warn("--exclude: 1 invalid address ignored")
        else:
            domains.add(line.lstrip("@"))
    return addrs, domains


def load_exclusion_files(paths):
    """Merge every --exclude file (the option is repeatable)."""
    addrs, domains = set(), set()
    for path in paths or ():
        more_addrs, more_domains = load_exclusions(path)
        addrs |= more_addrs
        domains |= more_domains
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
        die("--contacts file not found")
    reader = csv.DictReader(io.StringIO(read_text_any(p), newline=""))
    headers = reader.fieldnames or []
    email_cols = [c for c in headers if re.search(r"e-?mail", c, re.I)
                  and not re.search(r"type|display", c, re.I)]
    if not email_cols:
        warn("--contacts: no email column found; ignoring it")
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


@dataclass(frozen=True)
class Identity:
    """One address of a cleaned-up person (identities.csv), authoritative for rescore."""
    person_id: str
    first_name: str
    last_name: str
    display_name: str
    primary: bool
    extra: tuple = ()  # (column, value) pairs appended to the output


def person_keys(stats, book, identities=None) -> dict:
    """Resolve each address to a person: its identity, else its full name, else itself."""
    keys = {}
    for addr, s in stats.items():
        if identities and addr in identities:
            keys[addr] = ("id", identities[addr].person_id)
            continue
        nm = book.get(addr) or (s.names.most_common(1)[0][0] if s.names else "")
        k = name_key(nm)
        keys[addr] = ("name", k) if k else ("addr", addr)
    return keys


def choose_primary(members, override: str | None = None):
    """The address to write to (rulings R2, R5); members are (address, AddrStats, name).

    1. a manual override (identities.csv primary, from a set_primary override);
    2. else the address the household most recently sent to;
    3. else the most recently seen address.
    Non-automated addresses are preferred at steps 2 and 3. Ties keep the given order.
    """
    for m in members:
        if m[0] == override:
            return m
    human = [m for m in members if not looks_automated(m[0])]
    for pool in (human, members):
        sent = [m for m in pool if m[1].last_sent_ts is not None]
        if sent:
            return max(sent, key=lambda m: m[1].last_sent_ts)
        if pool:
            return max(pool, key=lambda m: m[1].last_ts or 0.0)
    raise ValueError("a person needs at least one address")


def build_people(stats, scores, book, excl, self_addrs, own_keys, list_addrs, min_received,
                 identities=None):
    """Group addresses into people and build the output rows.

    scores maps person keys (person_keys) to Tally objects. With identities, the
    result is exactly the identity people (closed world): they skip the household-name,
    exclusion, automated and threshold drops, because the cleanup decision is
    authoritative and rescore refuses excluded or household identities beforehand.
    """
    self_addrs = list(self_addrs)
    for addr in itertools.chain(book, identities or ()):
        stats.setdefault(addr, AddrStats())
    keys = person_keys(stats, book, identities)
    groups: dict[tuple, list] = {}
    for addr, s in stats.items():
        nm = book.get(addr) or (s.names.most_common(1)[0][0] if s.names else "")
        groups.setdefault(keys[addr], []).append((addr, s, nm))

    people, dropped, own_other = [], collections.Counter(), []
    for gk, members in groups.items():
        addrs = [m[0] for m in members]
        identity = gk[0] == "id"
        if identities is not None and not identity:
            continue
        if not identity:
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
        tally = scores.get(gk) or Tally()
        she_wrote, they_wrote = tally.she_wrote, tally.they_wrote
        in_book = any(a in book for a in addrs)
        is_list = any(a in list_addrs for a in addrs)
        automated = all(looks_automated(a) for a in addrs)
        if not identity:
            if automated and she_wrote < 3 and not in_book:
                dropped["automated"] += 1
                continue
            if not (she_wrote >= 1 or they_wrote >= min_received or in_book):
                dropped["below threshold"] += 1
                continue
        score = tally.sent_score + tally.recv_score
        if she_wrote and they_wrote:
            score *= TWO_WAY_BONUS
        members.sort(key=lambda m: (m[1].last_ts or 0.0), reverse=True)
        override = next((a for a in addrs if identity and identities[a].primary), None)
        primary = choose_primary(members, override)
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
        if any(has_lookalike(a) for a in addrs):
            flags.append("look-alike address")
        account_scores, account_bases = tally.account_scores, tally.account_bases
        account = max(self_addrs, key=lambda a: account_scores[a])
        basis = (max(ACCOUNT_BASES, key=lambda b: account_bases[account, b]) if account_scores[account]
                 else "folder" if she_wrote or they_wrote else "none")
        if identity:
            ident = identities[addrs[0]]
            first, last = ident.first_name, ident.last_name
            display = ident.display_name or display
            extra = dict(ident.extra)
        else:
            first = "" if is_list else first_name_of(display)
            last = "" if is_list else last_name_of(display)
            extra = {}
        people.append({
            **extra,
            "notify": "",
            "name": display,
            "first_name": first,
            "last_name": last,
            "email": best_raw(primary[1], primary[0]),
            "account": account,
            "account_basis": basis,
            # Internal compatibility for callers of build_people; exports use email only.
            "send_to": best_raw(primary[1], primary[0]),
            "score": round(score, 1),
            "she_wrote": she_wrote,
            "she_wrote_direct": tally.she_wrote_direct,
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
            "_person": gk,
        })
    people.sort(key=lambda p: (-p["score"], -p["_last_ts"]))
    for i, p in enumerate(people, 1):
        p["rank"] = i
    return people, dropped, own_other


@dataclass
class Ranking:
    people: list
    dropped: collections.Counter
    own_other: list
    ignored: collections.Counter


def rank_from_db(conn, self_addrs, *, excl, book, identities=None, household_names=(),
                 min_received: int, half_life: float) -> Ranking:
    """Everything after loading: household names, lists, both passes and the people.

    Used by rank (on its freshly built database) and by rescore (read-only, with
    identities). The reference time is the newest message, as in rank.
    """
    own_keys = {name_key(n) for (n,) in conn.execute(
        "SELECT DISTINCT from_name FROM messages WHERE is_from_self = 1 AND from_name <> ''")}
    own_keys.update(name_key(n) for n in household_names)
    own_keys.discard(None)
    list_addrs = {a for (a,) in conn.execute(
        "SELECT DISTINCT list_post FROM messages WHERE list_post IS NOT NULL")}
    ref_ts = conn.execute("SELECT MAX(ts) FROM messages").fetchone()[0] or NOW
    stats, ignored = collect_address_stats(conn, self_addrs)
    for addr in itertools.chain(book, identities or ()):
        stats.setdefault(addr, AddrStats())
    keys = person_keys(stats, book, identities)
    scores = score_people(conn, lambda a: keys.get(a) or ("addr", a), self_addrs, half_life, ref_ts)
    people, dropped, own_other = build_people(stats, scores, book, excl, self_addrs, own_keys,
                                              list_addrs, min_received, identities=identities)
    return Ranking(people, dropped, own_other, ignored)


# ---- output -----------------------------------------------------------------------
def enclosing_git_repo(p: Path) -> Path | None:
    for parent in (p, *p.parents):
        if (parent / ".git").exists():
            return parent
    return None


def guard_git(out_dir: Path, allow: bool) -> None:
    repo = enclosing_git_repo(out_dir)
    if repo and not allow:
        die("output is inside the git repository. These files hold her "
            "friends' names and addresses, so keep them out of the repo: choose an --out "
            "directory elsewhere (or pass --allow-inside-git if you are sure).")


def csv_cell(v):
    if isinstance(v, str) and v[:1] in GUARDED_PREFIXES:
        return "'" + v  # keep spreadsheet apps from treating text as a formula
    return v


def write_people_csv(path: Path, people, columns) -> None:
    """UTF-8 with BOM (for Excel), formula-guarded cells, mode 0600."""
    with open_private(path, encoding="utf-8-sig") as f:
        w = csv.writer(f)
        w.writerow(columns)
        for p in people:
            w.writerow([csv_cell(p.get(c, "")) for c in columns])


def write_outputs(conn, people, out_dir: Path, csv_path: Path | None = None) -> Path:
    csv_path = csv_path if csv_path is not None else out_dir / "correspondents.csv"
    write_people_csv(csv_path, people, CSV_COLUMNS)
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
    fd = os.open(p, os.O_RDONLY | os.O_NOFOLLOW)
    try:
        os.fchmod(fd, 0o600)  # failure must stop the command
    finally:
        os.close(fd)


def private_directory(p: Path, secure_existing: bool = False) -> None:
    if p.is_symlink():
        raise OSError(errno.ELOOP, "symlinked output directory")
    missing_parents, parent = [], p.parent
    while not parent.exists():
        missing_parents.append(parent)
        parent = parent.parent
    for parent in reversed(missing_parents):
        parent.mkdir(mode=0o700, exist_ok=True)  # Never chmod a parent of the named directory.
    try:
        p.mkdir(mode=0o700)
    except FileExistsError:
        if not p.is_dir():
            raise
        if not secure_existing:
            return
    fd = os.open(p, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
    try:
        os.fchmod(fd, 0o700)
    finally:
        os.close(fd)


def output_directory(value: str) -> Path:
    out = Path(value).expanduser()
    if out.is_symlink():
        die("1 symlinked output refused")
    if out.suffix.lower() == ".csv":
        die("--out is a folder; send_list.csv is written inside it")
    out = out.resolve()
    if out.exists() and not out.is_dir():
        die("--out must be a directory")
    return out


def open_private(p: Path, encoding="utf-8", append=False, exclusive=False):
    flags = os.O_WRONLY | os.O_CREAT | os.O_NOFOLLOW
    flags |= os.O_EXCL if exclusive else os.O_APPEND if append else os.O_TRUNC
    fd = os.open(p, flags, 0o600)
    try:
        os.fchmod(fd, 0o600)
        return os.fdopen(fd, "a" if append else "w", newline="", encoding=encoding)
    except BaseException:
        os.close(fd)
        if exclusive:
            p.unlink()
        raise


def guard_output_symlinks(out: Path) -> None:
    """Check named outputs without following links, including dangling links."""
    paths = [out / name for name in (
        "correspondents.csv", "mail.sqlite", "mail.sqlite-journal", "mail.sqlite-wal",
        "mail.sqlite-shm", "evidence", "send_list.csv", "schedule.log",
        "correspondents_cleaned.csv")]
    paths.extend(out.glob("send_list_*.csv"))
    count = sum(p.is_symlink() for p in paths)
    # Do not inspect a child through a symlinked evidence directory.
    if not (out / "evidence").is_symlink():
        count += (out / "evidence/household-names.txt").is_symlink()
    if count:
        die(f"{quantity(count, 'symlinked output')} refused")


@contextmanager
def atomic_outputs(destinations):
    """Prepare all files before publishing; each replacement is atomic.

    Callers close their writers (and SQLite) before leaving the context. No final
    file changes if preparation fails. Multiple renames are not a transaction.
    """
    staged = {}
    try:
        for dst in destinations:
            if dst.is_symlink():
                die("1 symlinked output refused")
            temp = dst.with_name(f".{dst.name}.{secrets.token_hex(16)}.tmp")
            with open_private(temp, exclusive=True):
                staged[dst] = temp
        yield staged
        # Closing the writers flushes Python buffers; sync every completed file
        # before the first rename, including the closed SQLite database.
        for temp in staged.values():
            fd = os.open(temp, os.O_RDONLY | os.O_NOFOLLOW)
            try:
                os.fsync(fd)
            finally:
                os.close(fd)
        for dst in staged:
            if dst.is_symlink():
                die("1 symlinked output refused")
        for dst, temp in staged.items():
            os.replace(temp, dst)
        for directory in dict.fromkeys(dst.parent for dst in staged):
            fd = os.open(directory, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
            try:
                try:
                    os.fsync(fd)
                except OSError as exc:
                    # Some filesystems cannot fsync directories; other I/O errors
                    # must still fail the command and reach private_errors.
                    if exc.errno not in (errno.EINVAL, errno.ENOTSUP):
                        raise
            finally:
                os.close(fd)
    finally:
        for temp in staged.values():
            temp.unlink(missing_ok=True)


@private_errors
def rank_main(argv: list[str]) -> int:
    ap = PrivateArgumentParser(prog="rank_correspondents.py",
        description="Rank the people a mailbox's owner corresponded with, from a local copy of "
                    "the mail. Headers only; nothing leaves this machine.",
        epilog="After review: rank_correspondents.py send-list correspondents.csv")
    ap.add_argument("paths", nargs="+", help="mail folders or files: a Thunderbird ImapMail/<server> "
                    "folder, mbox files, a Maildir, or a folder of .eml files")
    ap.add_argument("--self", dest="self_addrs", action="append", metavar="ADDRESS",
                    help="household address, primary first (repeat); default: inferred from Sent")
    ap.add_argument("--household-name", action="append", default=[], metavar="NAME",
                    help="exclude this household display name (repeatable)")
    ap.add_argument("--verbose", action="store_true", help="print personal details from the ranking")
    ap.add_argument("--exclude", metavar="FILE", action="append", default=[],
                    help="addresses or domains to leave out, one per line (repeatable)")
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
    if not 0 < args.half_life < float("inf") or args.min_received < 0 or args.top < 0:
        die("--half-life must be positive and finite; --min-received and --top must be nonnegative")

    out_dir = output_directory(args.out)
    guard_git(out_dir, args.allow_inside_git)
    guard_output_symlinks(out_dir)
    check_source_paths(args.paths)
    private_directory(out_dir, secure_existing=True)
    evidence = out_dir / "evidence"
    private_directory(evidence, secure_existing=True)
    db_path = out_dir / "mail.sqlite"
    csv_path = out_dir / "correspondents.csv"
    evidence_path = evidence / "household-names.txt"
    with atomic_outputs([db_path, csv_path, evidence_path]) as staged:
        with closing(sqlite3.connect(staged[db_path])) as conn:
            conn.execute("PRAGMA temp_store=MEMORY")
            conn.execute("PRAGMA journal_mode=MEMORY")  # Disposable staged database; no disk sidecars.
            conn.executescript(SCHEMA)

            started = time.time()
            counts, folders, empty_indexed = load_sources(conn, args.paths)
            total = sum(folders.values())
            if not total:
                die("no messages found. Point this at the folder that holds the mail files "
                    "(for Thunderbird, ImapMail/<server> inside the profile).")

            conn.executescript(VIEWS)  # Build participant indexes before the attribution join.
            self_addrs, how = resolve_self(conn, args.self_addrs)
            conn.executemany("INSERT INTO self_addresses VALUES (?)", [(a,) for a in self_addrs])
            conn.execute(f"UPDATE messages SET is_from_self = 1 WHERE from_addr IN "
                         f"({','.join('?' * len(self_addrs))})", self_addrs)
            assign_accounts(conn, self_addrs)
            conn.commit()
            n_self = conn.execute("SELECT COUNT(*) FROM messages WHERE is_from_self = 1").fetchone()[0]
            n_missed_alias = conn.execute("SELECT COUNT(*) FROM messages WHERE folder_kind = 'sent' "
                "AND is_from_self = 0 AND from_addr IS NOT NULL").fetchone()[0] if args.self_addrs else None
            ignored_household_names = [name_key(n) for n in args.household_name].count(None)
            household_names = conn.execute("SELECT from_name, COUNT(*) FROM messages "
                "WHERE is_from_self = 1 AND from_name <> '' GROUP BY from_name ORDER BY 2 DESC, from_name").fetchall()
            with open_private(staged[evidence_path]) as f:
                for name, count in household_names:
                    f.write(f"{count}\t{name}\n")
            y0, y1 = conn.execute("SELECT MIN(year), MAX(year) FROM messages").fetchone()

            book = load_contacts(args.contacts)
            excl = load_exclusion_files(args.exclude)
            ranking = rank_from_db(conn, self_addrs, excl=excl, book=book,
                                   household_names=args.household_name,
                                   min_received=args.min_received, half_life=args.half_life)
            people, dropped, own_other, ignored = (ranking.people, ranking.dropped,
                                                   ranking.own_other, ranking.ignored)
            write_outputs(conn, people, out_dir, csv_path=staged[csv_path])

    skip_labels = {"duplicates": ("duplicate copy", "duplicate copies"),
                   "deleted copies": ("deleted copy", "deleted copies"),
                   "junk": ("junk message",), "drafts": ("draft message",),
                   "unreadable": ("unreadable message",)}
    skipped = ", ".join(quantity(v, *skip_labels[k]) for k, v in counts.items() if k != "read" and v)
    print(f"Read {quantity(total, 'message')} from {quantity(len(folders), 'folder')} ({y0}-{y1}) in "
          f"{time.time() - started:.0f}s." + (f" Skipped {skipped}." if skipped else ""))
    print(f"{quantity(len(self_addrs), 'household account')} ({how}); {quantity(n_self, 'household-sent message')}.")
    print(f"{quantity(len(household_names), 'distinct household name')} -> <out>/evidence/household-names.txt")
    if ignored_household_names:
        print(f"Ignored {quantity(ignored_household_names, 'household name')} without a usable full-name key.")
    if n_missed_alias is not None:
        print(f"{quantity(n_missed_alias, 'message')} in outgoing folders "
              f"{'has' if n_missed_alias == 1 else 'have'} an unlisted sender; check --self.")
    if own_other:
        print(f"Excluded {quantity(len(own_other), 'other household address', 'other household addresses')} by name.")
    print(f"Ignored {quantity(ignored['bulk'], 'bulk message')} and {quantity(ignored['automated'], 'automated message')}.")
    drop = ", ".join(f"{v:,} {k}" for k, v in dropped.items() if v)
    print(f"Wrote {len(people):,} {'person' if len(people) == 1 else 'people'} to <out>/correspondents.csv"
          + (f" (left out: {drop})" if drop else ""))
    print("SQL: <out>/mail.sqlite   (tables messages, participants, people; views her_sent, "
          "received_personal)")
    if args.verbose and people and args.top:
        print(f"\n{'#':>4}  {'score':>7}  {'she/they':>9}  {'years':<9}  {'name':<26}  email")
        for p in people[:args.top]:
            span = f"{p['first_year']}-{p['last_year']}" if p["first_year"] else ""
            print(f"{p['rank']:>4}  {p['score']:>7}  {str(p['she_wrote']) + '/' + str(p['they_wrote']):>9}"
                  f"  {span:<9}  {(p['name'] or '')[:26]:<26}  {p['email']}")
    if empty_indexed:
        warn(f"{quantity(len(empty_indexed), 'folder')} {'has' if len(empty_indexed) == 1 else 'have'} "
             "a Thunderbird index but no messages on disk. Mail was not downloaded and is missing "
             "from the ranking. Turn on offline storage (Account Settings > Synchronization & Storage), "
             "sync, and run this again.")
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
    die("--start must look like 'YYYY-MM-DD HH:MM'")


def make_schedule(n: int, start: dt.datetime, lo: int, hi: int, opens: dt.time,
                  closes: dt.time, rng: random.Random) -> list[dt.datetime]:
    """Local send times, each lo-hi minutes after the last, all inside the daily window."""
    def fit(t: dt.datetime) -> dt.datetime:
        day_open = dt.datetime.combine(t.date(), opens)
        if t < day_open:
            return day_open
        if t > dt.datetime.combine(t.date(), closes):
            return day_open + dt.timedelta(days=1)
        return t

    times, t = [], fit(start)
    for i in range(n):
        if i:
            t = fit(t + dt.timedelta(minutes=rng.randint(lo, hi)))
        times.append(t)
    return times


def unguard_cell(value: str | None) -> str:
    value = value or ""
    return value[1:] if value.startswith("'") and value[1:2] in GUARDED_PREFIXES else value


def reviewed_rows(src: Path, marked_only: bool):
    """Read spreadsheet exports without losing quoted embedded newlines."""
    text = read_text_any(src)
    has_nul = "\0" in text
    if has_nul:
        # Python 3.9's CSV parser rejects NUL before exposing the row's rank.
        # Reversibly escape it (and backslashes) for parsing only, then restore
        # every cell so validation rejects the original control character.
        text = text.replace("\\", "\\\\").replace("\0", "\\0")

    def restore_cell(value):
        if has_nul and value is not None:
            return re.sub(r"\\([\\0])", lambda m: "\0" if m[1] == "0" else "\\", value)
        return value

    reader = csv.DictReader(io.StringIO(text, newline=""), strict=True)
    fields = [unguard_cell(restore_cell(c)).strip() for c in (reader.fieldnames or [])]
    named_fields = [c for c in fields if c]
    if len(named_fields) != len(set(named_fields)):
        die("CSV header contains duplicate column names")
    required = {"first_name", "account"} | ({"notify"} if marked_only else set())
    if not required.issubset(fields) or not {"email", "send_to"}.intersection(fields):
        die("CSV header is missing required columns")
    reader.fieldnames = fields
    rows, unknown_marks = [], []
    for i, raw in enumerate(reader, 1):
        if None in raw:
            die(f"malformed CSV at row {i}")
        raw = {k: restore_cell(v) for k, v in raw.items()}
        # A send list already had its guard removed; preserve its literal apostrophes.
        row = {k: unguard_cell(v) if marked_only else (v or "") for k, v in raw.items() if k}
        if not any(v.strip() for v in row.values()):
            continue
        rank = row.get("rank", "").strip() if marked_only else ""
        number = int(rank) if re.fullmatch(r"[0-9]{1,12}", rank) else i
        order = number if re.fullmatch(r"[0-9]{1,12}", rank) else float("inf")
        if marked_only:
            mark = row["notify"].replace("\ufe0e", "").replace("\ufe0f", "").strip().casefold()
            if mark in NO:
                continue
            if mark not in YES:
                unknown_marks.append(str(number))
                continue
        row["email"] = row.get("email", row.get("send_to", ""))
        rows.append((order, i, number, row))
    if unknown_marks:
        die("unrecognised notify values at ranks " + ", ".join(unknown_marks))
    return sorted(rows, key=lambda r: (r[0], r[1]))


def validated_send_rows(selected, self_addrs, row_label="ranks"):
    """Validate all selected rows before deduplication or any output write."""
    rows, seen = [], set()
    errors = {"first_name": [], "address": [], "account": [], "control characters": [],
              "household recipient": []}
    for _, _, number, source in selected:
        if any(unicodedata.category(char) in ("Cc", "Zl", "Zp")
               for column in SEND_COLUMNS for char in source.get(column, "")):
            errors["control characters"].append(str(number))
        row = {c: source.get(c, "").strip() for c in SEND_COLUMNS}
        row["email"] = row["email"].lower()
        recipient = canon(row["email"])
        account = canon(row["account"])
        if not row["first_name"]:
            errors["first_name"].append(str(number))
        if not ADDR_RE.fullmatch(row["email"]):
            errors["address"].append(str(number))
        if account not in self_addrs:
            errors["account"].append(str(number))
        if recipient in self_addrs:
            errors["household recipient"].append(str(number))
        row["account"] = account
        if recipient not in seen:
            seen.add(recipient)
            rows.append((number, row))
    problems = [f"invalid {field} at {row_label} {', '.join(numbers)}"
                for field, numbers in errors.items() if numbers]
    if problems:
        die("; ".join(problems))
    return rows


def guard_inputs(outputs, inputs):
    for dst in outputs:
        for src in inputs:
            if dst == src or (dst.exists() and src.exists() and os.path.samefile(dst, src)):
                die("output would overwrite an input file; choose another output location")


def write_send_csv(dst: Path, rows, fields):
    with open_private(dst) as f:
        writer = csv.DictWriter(f, fieldnames=fields, lineterminator="\n")
        writer.writeheader()
        writer.writerows(rows)


@private_errors
def send_list_main(argv: list[str]) -> int:
    ap = PrivateArgumentParser(
        prog="rank_correspondents.py send-list",
        description="Validate reviewed rows marked y, yes, x, 1, true, ✓, ✔, ✅ or ☑; write a plain invite list.")
    ap.add_argument("reviewed_csv")
    ap.add_argument("--self", dest="self_addrs", action="append", metavar="ADDRESS",
                    help="required: household accounts, primary first")
    ap.add_argument("--out", default="~/jo-mail-review", help="output directory (default: %(default)s)")
    for flag in ("--gap", "--hours", "--start"):
        ap.add_argument(flag, nargs="?", const="", help="use `schedule`")
    ap.add_argument("--allow-inside-git", action="store_true", help=argparse.SUPPRESS)
    args = ap.parse_args(argv)
    if any(value is not None for value in (args.gap, args.hours, args.start)):
        die("use `schedule`")
    if not args.self_addrs:
        die("--self is required")
    self_addrs, _ = resolve_self(None, args.self_addrs)
    out = output_directory(args.out)
    src = Path(args.reviewed_csv).expanduser().resolve()
    dst = out / "send_list.csv"
    guard_git(out, args.allow_inside_git)
    guard_output_symlinks(out)
    guard_inputs([dst], [src])
    selected = reviewed_rows(src, marked_only=True)
    rows = validated_send_rows(selected, self_addrs)
    if not rows:
        die("no rows are marked y in the notify column")
    private_directory(out, secure_existing=True)
    with atomic_outputs([dst]) as staged:
        write_send_csv(staged[dst], [row for _, row in rows], SEND_COLUMNS)
    duplicates = len(selected) - len(rows)
    if duplicates:
        print(f"{quantity(duplicates, 'duplicate row')} dropped")
    print(f"{quantity(len(rows), 'person', 'people')} marked to notify -> <out>/send_list.csv")
    return 0


def read_ledger(src: Path, target: str):
    with src.open(encoding="utf-8-sig", newline="") as f:
        header = re.fullmatch(r"# target=(\S+) memorial=(\S+)\r?\n?", f.readline())
        if not header:
            die("ledger header is missing or invalid")
        if header.group(1) != target:
            die("ledger target does not match --target")
        reader = csv.DictReader(f, strict=True)
        if reader.fieldnames != ["email", "share_url"]:
            die("ledger column header must contain email,share_url")
        entries = {}
        for i, row in enumerate(reader, 1):
            if None in row:
                die(f"malformed ledger at row {i}")
            if not any((v or "").strip() for v in row.values()):
                continue
            address = (row.get("email") or "").strip().lower()
            url = row.get("share_url") or ""
            if not ADDR_RE.fullmatch(address) or not url.startswith(target + "/s/"):
                die(f"invalid ledger entry at row {i}")
            if address in entries and entries[address] != url:
                die(f"conflicting ledger entry at row {i}")
            entries[address] = url
        return entries


def account_label(index: int) -> str:
    return "primary" if index == 0 else "second" if index == 1 else f"account{index + 1}"


@private_errors
def schedule_main(argv: list[str]) -> int:
    ap = PrivateArgumentParser(prog="rank_correspondents.py schedule",
        description="Join the invite ledger and schedule separate local mail-merge files for each account.")
    ap.add_argument("send_list_csv")
    ap.add_argument("--ledger", required=True)
    ap.add_argument("--self", dest="self_addrs", action="append", required=True, metavar="ADDRESS")
    ap.add_argument("--start", required=True, metavar="YYYY-MM-DD HH:MM")
    ap.add_argument("--gap", default="30-90")
    ap.add_argument("--hours", default="9-19")
    ap.add_argument("--seed", type=int)
    ap.add_argument("--pace", choices=("per-account", "combined"), default="per-account")
    ap.add_argument("--target", default="https://www.jowray.com")
    ap.add_argument("--out", default="~/jo-mail-review")
    ap.add_argument("--allow-missing-share-url", action="store_true")
    ap.add_argument("--allow-inside-git", action="store_true", help=argparse.SUPPRESS)
    args = ap.parse_args(argv)
    self_addrs, _ = resolve_self(None, args.self_addrs)
    start = parse_local(args.start)
    if start < dt.datetime.now():
        die("--start is in the past")
    lo, hi = parse_gap(args.gap)
    opens, closes = parse_hours(args.hours)
    target = args.target
    try:
        origin = urlsplit(target)
        valid_origin = (origin.scheme in ("http", "https") and origin.netloc and origin.hostname
                        and origin.port != 0 and not origin.username and not origin.password
                        and not origin.path and not origin.query and not origin.fragment
                        and not any(c.isspace() for c in target))
    except ValueError:
        valid_origin = False
    if not valid_origin:
        die("--target must be an HTTP(S) origin")
    src = Path(args.send_list_csv).expanduser().resolve()
    ledger = Path(args.ledger).expanduser().resolve()
    out = output_directory(args.out)
    guard_git(out, args.allow_inside_git)
    guard_output_symlinks(out)
    destinations = [out / f"send_list_{account_label(i)}.csv" for i in range(len(self_addrs))]
    log = out / "schedule.log"
    guard_inputs(destinations + [log], [src, ledger])
    rows = validated_send_rows(reviewed_rows(src, marked_only=False), self_addrs, row_label="rows")
    if not rows:
        die("send list contains no rows")
    entries = read_ledger(ledger, target)
    missing = [str(number) for number, row in rows if row["email"] not in entries]
    if missing and not args.allow_missing_share_url:
        die("missing ledger entries at rows " + ", ".join(missing))
    for _, row in rows:
        row["share_url"] = entries.get(row["email"], "")
    seed = args.seed if args.seed is not None else secrets.randbits(64)
    by_account = {a: [row for _, row in rows if row["account"] == a] for a in self_addrs}
    groups = ([(None, [row for _, row in rows])] if args.pace == "combined" else list(by_account.items()))
    for account, group in groups:
        rng = random.Random(seed if account is None else f"{seed}:{account}")
        times = make_schedule(len(group), start, lo, hi, opens, closes, rng)
        for row, timestamp in zip(group, times):
            row["send_at"] = timestamp.strftime("%Y-%m-%d %H:%M")
    # Validation and schedule computation finish before creating or changing output files.
    private_directory(out, secure_existing=True)
    with atomic_outputs(destinations + [log]) as staged:
        for dst, account in zip(destinations, self_addrs):
            write_send_csv(staged[dst], by_account[account], SEND_COLUMNS + ["share_url", "send_at"])
        timezone = dt.datetime.now().astimezone().tzname()
        with open_private(staged[log]) as f:
            try:
                fd = os.open(log, os.O_RDONLY | os.O_NOFOLLOW)
            except FileNotFoundError:
                pass  # The first schedule has no log yet.
            else:
                with os.fdopen(fd, encoding="utf-8", newline="") as previous:
                    for block in iter(lambda: previous.read(65536), ""):
                        f.write(block)
            f.write(f"# timezone={timezone} seed={seed} start={start:%Y-%m-%d %H:%M} "
                    f"gap={lo}-{hi} hours={opens:%H:%M}-{closes:%H:%M} pace={args.pace}\n")
            for i, account in enumerate(self_addrs):
                group = by_account[account]
                first = group[0]["send_at"] if group else "-"
                last = group[-1]["send_at"] if group else "-"
                f.write(f"{account_label(i)} count={len(group)} first={first} last={last}\n")
    for i, account in enumerate(self_addrs):
        print(f"{quantity(len(by_account[account]), 'row')} -> <out>/send_list_{account_label(i)}.csv")
    if args.allow_missing_share_url:
        print(f"{quantity(len(missing), 'row')} {'has' if len(missing) == 1 else 'have'} empty share_url.")
    print("1 schedule appended -> <out>/schedule.log")
    return 0


# ---- rescore: person-level ranking of the cleaned-up identities -------------------
IDENTITY_CORE = ("address", "person_id", "first_name", "last_name", "display_name", "primary")
OTHER_ADDRESS = re.compile(r"\s*\(last [^()]*\)\s*$")


def read_private_csv(path: Path, required) -> tuple[list[str], list[dict]]:
    """Read a CSV the tools wrote (or a spreadsheet saved it): BOM, guards, strict quoting."""
    reader = csv.DictReader(io.StringIO(read_text_any(path), newline=""), strict=True)
    fields = [unguard_cell(c).strip() for c in (reader.fieldnames or [])]
    named = [c for c in fields if c]
    if len(named) != len(set(named)):
        die("CSV header contains duplicate column names")
    if not set(required).issubset(fields):
        die("CSV header is missing required columns")
    reader.fieldnames = fields
    rows = []
    for i, raw in enumerate(reader, 1):
        if None in raw:
            die(f"malformed CSV at row {i}")
        row = {k: unguard_cell(v or "") for k, v in raw.items() if k}
        if any(v.strip() for v in row.values()):
            rows.append(row)
    return fields, rows


def row_addresses(row: dict) -> list[str]:
    """Canonical addresses of a correspondents.csv row: email, then other_addresses.

    other_addresses holds "raw (last YYYY)" entries separated by "; ". Raises
    ValueError for an entry that is not an address.
    """
    found = []
    for value in [row.get("email") or row.get("send_to") or ""] + (row.get("other_addresses") or "").split(";"):
        value = OTHER_ADDRESS.sub("", value).strip()
        if not value:
            continue
        address = canon(value)
        if address is None:
            raise ValueError("invalid address")
        if address not in found:
            found.append(address)
    return found


def load_identities(path: Path):
    """identities.csv -> ({address: Identity}, extra columns). Refuses inconsistent people."""
    fields, rows = read_private_csv(path, IDENTITY_CORE)
    extra_columns = [c for c in fields if c and c not in IDENTITY_CORE]
    clashes = set(extra_columns) & (set(CSV_COLUMNS) | {"send_to"})
    if clashes:
        die("identities.csv repeats an output column name")
    identities, people = {}, {}
    for i, row in enumerate(rows, 1):
        address = canon(row["address"])
        person = row["person_id"].strip()
        if not address or not person:
            die(f"invalid identity at row {i}")
        if address in identities:
            die(f"address appears twice in identities.csv (row {i})")
        primary = row["primary"].strip().casefold()
        if primary not in YES | NO:
            die(f"invalid primary value at identity row {i}")
        ident = Identity(person, row["first_name"].strip(), row["last_name"].strip(),
                         row["display_name"].strip(), primary in YES,
                         tuple((c, row.get(c, "")) for c in extra_columns))
        first = people.setdefault(person, ident)
        if (first.first_name, first.last_name, first.display_name, first.extra) != (
                ident.first_name, ident.last_name, ident.display_name, ident.extra):
            die(f"identity rows for one person disagree (row {i})")
        identities[address] = ident
    primaries = collections.Counter(ident.person_id for ident in identities.values() if ident.primary)
    if any(n > 1 for n in primaries.values()):
        die("a person has more than one primary address")
    return identities, extra_columns


def load_removed(path: Path):
    """correspondents_removed.csv -> [(row number, addresses, reason, source)]."""
    _, rows = read_private_csv(path, ("removed_addresses", "removed_reason", "removed_source"))
    removed = []
    for i, row in enumerate(rows, 1):
        addresses = [canon(a) for a in row["removed_addresses"].split(";") if a.strip()]
        if not addresses or None in addresses:
            die(f"invalid removed_addresses at removed row {i}")
        removed.append((i, addresses, row["removed_reason"].strip() or "unspecified",
                        row["removed_source"].strip() or "unspecified"))
    return removed


def reconcile(source_rows, identities, removed):
    """Closed-world check: every source address is in exactly one person or one removal.

    Returns per-reason aggregates; refuses (exits) on a gap, an overlap or a foreign address.
    """
    source = {}
    for i, row in enumerate(source_rows, 1):
        try:
            addresses = row_addresses(row)
        except ValueError:
            die(f"invalid address in source row {i}")
        for address in addresses:
            source.setdefault(address, i)
    removed_at = collections.Counter()
    for _, addresses, _, _ in removed:
        removed_at.update(addresses)
    overlap = sum(1 for a in identities if removed_at[a]) + sum(1 for n in removed_at.values() if n > 1)
    gaps = sum(1 for a in source if a not in identities and not removed_at[a])
    foreign = sum(1 for a in itertools.chain(identities, removed_at) if a not in source)
    if gaps or overlap or foreign:
        die(f"identities and removals do not reconcile with the source: {gaps} missing, "
            f"{overlap} overlapping, {foreign} not in the source; re-run cleanup apply")
    rows_by_person = collections.defaultdict(set)
    for address, ident in identities.items():
        rows_by_person[ident.person_id].add(source[address])
    return {
        "people": len(rows_by_person),
        "merged rows": sum(len(r) for r in rows_by_person.values() if len(r) > 1),
        "removed": collections.Counter((reason, origin) for _, _, reason, origin in removed),
    }


# The removal categories cleanup_correspondents.py writes: the relationship values of its
# answer schema, plus its override and the loaders' default. Only these are echoed.
REMOVED_REASONS = frozenset((
    "family", "friend", "neighbor_or_community", "church_or_club", "caregiver_or_medical",
    "professional_advisor", "business_or_vendor", "staff_where_they_lived", "organization_or_list",
    "political_or_advocacy", "spam_or_scam", "automated", "unknown", "override", "unspecified"))
REMOVED_SOURCES = frozenset(("model", "judge", "override", "unspecified"))


def safe_label(value: str, allowed) -> str:
    """Echo a known category only. Anything else (a hand edit, which could be a person's
    name) is reported as "other", so the console stays free of private text."""
    return value if value in allowed else "other"


def open_readonly_db(path: Path) -> sqlite3.Connection:
    if not path.is_file():
        die("--db file not found")
    return sqlite3.connect(path.resolve().as_uri() + "?mode=ro", uri=True)


@private_errors
def rescore_main(argv: list[str]) -> int:
    ap = PrivateArgumentParser(
        prog="rank_correspondents.py rescore",
        description="Re-rank the cleaned-up people (identities.csv) from the existing database, "
                    "counting each message once per person. Reads mail.sqlite read-only and "
                    "writes correspondents_cleaned.csv only.")
    ap.add_argument("--db", required=True, help="the harvester's mail.sqlite (opened read-only)")
    ap.add_argument("--self", dest="self_addrs", action="append", metavar="ADDRESS",
                    help="required: household accounts, primary first, as for rank")
    ap.add_argument("--identities", required=True, help="identities.csv from cleanup apply")
    ap.add_argument("--removed", required=True, help="correspondents_removed.csv from cleanup apply")
    ap.add_argument("--source", required=True, help="the correspondents.csv the cleanup started from")
    ap.add_argument("--exclude", metavar="FILE", action="append", default=[],
                    help="addresses or domains that must not be kept (repeatable)")
    ap.add_argument("--contacts", metavar="CSV", help="her address book exported as CSV, as for rank")
    ap.add_argument("--half-life", type=float, default=DEFAULT_HALF_LIFE, metavar="YEARS",
                    help="older mail counts half as much every this many years (default: %(default)s)")
    ap.add_argument("--out", default="~/jo-mail-review", help="output directory (default: %(default)s)")
    ap.add_argument("--allow-inside-git", action="store_true", help=argparse.SUPPRESS)
    args = ap.parse_args(argv)
    if not args.self_addrs:
        die("--self is required")
    if not 0 < args.half_life < float("inf"):
        die("--half-life must be positive and finite")
    self_addrs, _ = resolve_self(None, args.self_addrs)
    out = output_directory(args.out)
    db = Path(args.db).expanduser().resolve()
    inputs = [Path(p).expanduser().resolve() for p in (args.identities, args.removed, args.source)]
    dst = out / "correspondents_cleaned.csv"
    guard_git(out, args.allow_inside_git)
    guard_output_symlinks(out)
    guard_inputs([dst], [db] + inputs)
    for path in inputs:
        if not path.is_file():
            die("an input CSV was not found")
    identities, extra_columns = load_identities(inputs[0])
    removed = load_removed(inputs[1])
    _, source_rows = read_private_csv(inputs[2], ("email",))
    excl = load_exclusion_files(args.exclude)
    if any(is_excluded(a, excl) for a in identities):
        die(f"{quantity(sum(is_excluded(a, excl) for a in identities), 'kept address', 'kept addresses')} "
            "excluded by --exclude; remove them in cleanup apply")
    if any(a in self_addrs for a in identities):
        die("a kept address is a household (--self) address")
    report = reconcile(source_rows, identities, removed)
    book = load_contacts(args.contacts)
    with closing(open_readonly_db(db)) as conn:
        # The order matters too: the first --self is the primary account, which wins ties.
        known = [a for (a,) in conn.execute("SELECT addr FROM self_addresses ORDER BY rowid")]
        if known != list(self_addrs):
            die("--self must list the household addresses recorded in --db, in the same order")
        ranking = rank_from_db(conn, self_addrs, excl=excl, book=book, identities=identities,
                               min_received=2, half_life=args.half_life)
    expected = {("id", ident.person_id) for ident in identities.values()}
    if {p["_person"] for p in ranking.people} != expected or len(ranking.people) != len(expected):
        die("rescore lost or duplicated a person; nothing written")
    private_directory(out, secure_existing=True)
    with atomic_outputs([dst]) as staged:
        write_people_csv(staged[dst], ranking.people, CSV_COLUMNS + extra_columns)
    print(f"Kept {quantity(report['people'], 'person', 'people')}; "
          f"{quantity(report['merged rows'], 'source row')} merged into shared people.")
    for (reason, origin), count in sorted(report["removed"].items()):
        print(f"Removed {quantity(count, 'row')}: {safe_label(reason, REMOVED_REASONS)} "
              f"({safe_label(origin, REMOVED_SOURCES)}).")
    print(f"Wrote {quantity(len(ranking.people), 'person', 'people')} to <out>/correspondents_cleaned.csv")
    return 0


def main(argv: list[str] | None = None) -> int:
    argv = sys.argv[1:] if argv is None else argv
    if argv and argv[0] == "send-list":
        return send_list_main(argv[1:])
    if argv and argv[0] == "schedule":
        return schedule_main(argv[1:])
    if argv and argv[0] == "rescore":
        return rescore_main(argv[1:])
    return rank_main(argv)


if __name__ == "__main__":
    sys.exit(main())
