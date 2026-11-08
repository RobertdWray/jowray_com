"""Offline P1 characterization and P2 invite-pipeline regression tests."""

from __future__ import annotations

import contextlib
import csv
import datetime as dt
import email.utils
import hashlib
import io
import os
from pathlib import Path
import sqlite3
import stat
import tempfile
import unittest
from unittest import mock

import rank_correspondents


NOW = dt.datetime(2025, 1, 15, 12, tzinfo=dt.timezone.utc).timestamp()
MAIL_TIME = dt.datetime(2024, 1, 2, 12, tzinfo=dt.timezone.utc).timestamp()
DATE = "Tue, 02 Jan 2024 12:00:00 +0000"
OWNER = "owner@example.com"
ALICE = "alice@example.com"
BOB = "bob@example.com"


def headers(*, message_id="message-1", sender="Alice Example <alice@example.com>",
            to="Owner Example <owner@example.com>", date=DATE, subject="A picnic",
            extra=(), encoding="utf-8", newline="\n"):
    fields = [("From", sender), ("To", to), ("Date", date), ("Subject", subject)]
    if message_id is not None:
        fields.append(("Message-ID", "<{}@example.com>".format(message_id)))
    fields.extend(extra)
    return (newline.join("{}: {}".format(k, v) for k, v in fields if v is not None)
            + newline).encode(encoding)


class QuietTestCase(unittest.TestCase):
    def setUp(self):
        self.contexts = contextlib.ExitStack()
        self.addCleanup(self.contexts.close)
        self.stdout = self.contexts.enter_context(contextlib.redirect_stdout(io.StringIO()))
        self.stderr = self.contexts.enter_context(contextlib.redirect_stderr(io.StringIO()))
        self.contexts.enter_context(mock.patch.object(rank_correspondents, "NOW", NOW))


class TempTestCase(QuietTestCase):
    def setUp(self):
        super().setUp()
        self.root = Path(self.contexts.enter_context(tempfile.TemporaryDirectory())).resolve()
        self.assertIsNone(rank_correspondents.enclosing_git_repo(self.root))
        home = self.root / "home"
        home.mkdir()
        self.contexts.enter_context(mock.patch.dict(os.environ, {"HOME": str(home)}))

    def write(self, relative, data):
        path = self.root / relative
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(data)
        return path

    def mbox(self, relative, messages, newline=b"\n", body=b"Synthetic body."):
        envelope = b"From owner@example.com Tue Jan  2 12:00:00 2024" + newline
        return self.write(relative, b"".join(
            envelope + message + newline + body + newline + newline for message in messages))

    def database(self, paths, self_addrs=(OWNER,)):
        conn = sqlite3.connect(":memory:")
        self.addCleanup(conn.close)
        conn.executescript(rank_correspondents.SCHEMA)
        counts, folders, empty = rank_correspondents.load_sources(conn, [str(p) for p in paths])
        conn.executemany("INSERT INTO self_addresses VALUES (?)", [(a,) for a in self_addrs])
        conn.executemany("UPDATE messages SET is_from_self = 1 WHERE from_addr = ?",
                         [(a,) for a in self_addrs])
        conn.executescript(rank_correspondents.VIEWS)
        return conn, counts, folders, empty


class TextTests(QuietTestCase):
    def test_canon_case_mailto_and_invalid_addresses(self):
        for value in (" ALICE@EXAMPLE.COM ", "<Alice@example.com>",
                      "mailto:ALICE@example.com", "'alice@example.com'"):
            with self.subTest(value=value):
                self.assertEqual(rank_correspondents.canon(value), ALICE)
        self.assertEqual(rank_correspondents.canon("a.li.ce+picnic@example.com"),
                         "a.li.ce+picnic@example.com")
        for value in (None, "", "alice", "alice@", "alice@example", "@example.com",
                      "alice bob@example.com", "alice@@example.com", "alice@example.c"):
            with self.subTest(value=value):
                self.assertIsNone(rank_correspondents.canon(value))

    def test_canon_gmail_dots_tags_and_googlemail_alias(self):
        self.assertEqual(rank_correspondents.GMAIL_DOMAINS, {"gmail.com", "googlemail.com"})
        # Exercise both provider aliases with reserved fixture domains, never real inboxes.
        with mock.patch.object(rank_correspondents, "GMAIL_DOMAINS",
                               {"example.com", "alias.example.com"}):
            for domain in ("example.com", "alias.example.com"):
                with self.subTest(domain=domain):
                    address = rank_correspondents.canon("A.li.ce+picnic@" + domain)
                    self.assertEqual(address.split("@"), ["alice", "gmail.com"])

    def test_clean_name_decodes_and_removes_address_and_punctuation(self):
        cases = [
            (' "Alice   Example" <alice@example.com> ', "Alice Example"),
            ("=?utf-8?q?Alice_Ex=C3=A4mple?=", "Alice Exämple"),
            (ALICE.upper(), ""), ("", ""),
        ]
        for value, expected in cases:
            with self.subTest(value=value):
                self.assertEqual(rank_correspondents.clean_name(value, ALICE), expected)

    def test_name_key_strips_titles_initials_and_annotations(self):
        for value in ("Dr. Alice A. Example", "Example, Alice A.",
                      "Alice (picnic) Example [friend]", "ALICE EXAMPLE"):
            with self.subTest(value=value):
                self.assertEqual(rank_correspondents.name_key(value), "alice example")
        for value in (None, "", "Alice", "Dr. A."):
            with self.subTest(value=value):
                self.assertIsNone(rank_correspondents.name_key(value))

    def test_first_name_titles_last_first_and_usernames(self):
        cases = [("Dr. Ms. ALICE Example", "Alice"), ("Example, Alice A.", "Alice"),
                 ("(friend) alice Example", "Alice"), ("Alice", "Alice"),
                 ("alice_123", ""), (ALICE, ""), ("Dr.", ""), ("", "")]
        for value, expected in cases:
            with self.subTest(value=value):
                self.assertEqual(rank_correspondents.first_name_of(value), expected)

    def test_first_name_suffix_baseline(self):
        # baseline behaviour (P1 pin); P2 may change
        self.assertEqual(rank_correspondents.first_name_of("Alice Example, Jr."), "Alice")

    def test_csv_formula_guard(self):
        for prefix in ("=", "+", "@", "\t", "\r", "\n", "＝", "＋", "－", "＠"):
            with self.subTest(prefix=prefix):
                self.assertEqual(rank_correspondents.csv_cell(prefix + "Example"),
                                 "'" + prefix + "Example")
        # baseline behaviour (P1 pin); P2 may change
        self.assertEqual(rank_correspondents.csv_cell("-Example"), "'-Example")
        for value in ("Alice Example", "", 12, -4.0):
            self.assertEqual(rank_correspondents.csv_cell(value), value)

    def test_norm_subject_reply_and_forward_prefixes(self):
        for value in ("Re: A picnic", "FW: fwd: AW: Tr: Antw: A picnic", "RE [2]: A picnic"):
            with self.subTest(value=value):
                self.assertEqual(rank_correspondents.norm_subject(value), "A picnic")
        self.assertEqual(rank_correspondents.norm_subject("Picnic: Re: later"), "Picnic: Re: later")

    def test_looks_automated_role_and_sender_subdomains(self):
        for address in ("no-reply@example.com", "support+picnic@example.com",
                        "mailer-daemon@example.com", "alice@email2.example.com"):
            with self.subTest(address=address):
                self.assertTrue(rank_correspondents.looks_automated(address))
        for address in (ALICE, "newsworthy@example.com", "alice@friends.example.com"):
            self.assertFalse(rank_correspondents.looks_automated(address))
        with mock.patch.object(rank_correspondents, "AUTOMATED_DOMAINS", ("example.com",)):
            self.assertTrue(rank_correspondents.looks_automated(ALICE))
            self.assertTrue(rank_correspondents.looks_automated("alice@friends.example.com"))

    def test_parse_addrs_native_interpreter(self):
        values = ['"Example, Alice" <alice@example.com>', "Bob Sample <bob@example.com>"]
        expected = [("Example, Alice", ALICE), ("Bob Sample", BOB)]
        original = email.utils.getaddresses
        try:
            original(values, strict=False)
        except TypeError:
            calls = [mock.call(values, strict=False), mock.call(values)]
        else:
            calls = [mock.call(values, strict=False)]
        with mock.patch.object(email.utils, "getaddresses", wraps=original) as parser:
            self.assertEqual(rank_correspondents.parse_addrs(values), expected)
            self.assertEqual(parser.call_args_list, calls)

    def test_parse_addrs_forced_strict_keyword_supported(self):
        values = ["Alice Example <alice@example.com>"]
        original = email.utils.getaddresses

        def supported(values, *, strict):
            self.assertIs(strict, False)
            return original(values)

        with mock.patch.object(email.utils, "getaddresses", side_effect=supported) as parser:
            self.assertEqual(rank_correspondents.parse_addrs(values), [("Alice Example", ALICE)])
            parser.assert_called_once_with(values, strict=False)

    def test_parse_addrs_forced_legacy_typeerror_fallback(self):
        values = ["Alice Example <alice@example.com>"]
        original = email.utils.getaddresses

        def legacy(values):
            return original(values)

        with mock.patch.object(email.utils, "getaddresses", side_effect=legacy) as parser:
            self.assertEqual(rank_correspondents.parse_addrs(values), [("Alice Example", ALICE)])
            self.assertEqual(parser.call_args_list,
                             [mock.call(values, strict=False), mock.call(values)])


class MessageTests(QuietTestCase):
    def parse(self, **kwargs):
        message = rank_correspondents.parse_message(headers(**kwargs), None)
        self.assertIsNotNone(message)
        return message

    def test_each_bulk_header_and_vendor_prefix(self):
        names = ("list-id", "list-unsubscribe", "list-post", "list-help", "feedback-id",
                 "x-campaign", "x-campaignid", "x-rpcampaign", "x-cmae-messageid",
                 "x-sfmc-stack", "x-csa-complaints", "x-autoreply", "x-autorespond",
                 "x-mailgun-id", "x-mailchimp-id", "x-mc-id", "x-sg-id", "x-ses-id")
        for name in names:
            with self.subTest(name=name):
                h = {name: [""]}
                self.assertTrue(rank_correspondents.is_bulk(h, lambda key: ""))
                self.assertTrue(self.parse(extra=[(name, "synthetic")]).bulk)
        self.assertFalse(self.parse(extra=[("X-Unrelated", "synthetic")]).bulk)

    def test_precedence_and_auto_submitted_bulk_values(self):
        for name, value, expected in (
            ("Precedence", "bulk", True), ("Precedence", "LIST", True),
            ("Precedence", "junk", True), ("Precedence", "normal", False),
            ("Auto-Submitted", "auto-replied", True), ("Auto-Submitted", "NO", False),
            ("Auto-Submitted", "", False),
        ):
            with self.subTest(name=name, value=value):
                self.assertEqual(self.parse(extra=[(name, value)]).bulk, expected)

    def test_gmail_bulk_labels_and_folder_precedence(self):
        for label in ("Category Promotions", "Category Social", "Category Updates", "Category Forums"):
            with self.subTest(label=label):
                self.assertTrue(self.parse(extra=[("X-Gmail-Labels", label)]).bulk)
        for labels, kind in (("Inbox, Spam, Sent", "junk"), ("Drafts, Sent", "drafts"),
                             ('"Sent", Inbox', "sent"), ("Inbox, Important", None)):
            with self.subTest(labels=labels):
                message = self.parse(extra=[("X-Gmail-Labels", labels)])
                self.assertEqual(message.label_kind, kind)
                self.assertFalse(message.bulk)

    def test_date_ts_bounds_and_timezone(self):
        self.assertEqual(rank_correspondents.date_ts("Mon, 01 Jan 1990 00:00:00 +0000"),
                         rank_correspondents.MIN_TS)
        self.assertIsNone(rank_correspondents.date_ts("Sun, 31 Dec 1989 23:59:59 +0000"))
        self.assertEqual(rank_correspondents.date_ts("Fri, 17 Jan 2025 12:00:00 +0000"),
                         NOW + 2 * 86400)
        self.assertIsNone(rank_correspondents.date_ts("Fri, 17 Jan 2025 12:00:01 +0000"))
        for value in (DATE, "Tue, 02 Jan 2024 07:00:00 -0500", "02 Jan 2024 12:00:00"):
            self.assertEqual(rank_correspondents.date_ts(value), MAIL_TIME)
        for value in ("", "not a date", "32 Jan 2024 12:00:00 +0000"):
            self.assertIsNone(rank_correspondents.date_ts(value))

    def test_envelope_asctime_and_numeric_timezones(self):
        for value in ("alice@example.com Tue Jan  2 12:00:00 2024",
                      "alice@example.com Tue Jan  2 07:00:00 -0500 2024",
                      "alice@example.com Tue Jan  2 17:30:00 +0530 2024"):
            self.assertEqual(rank_correspondents.envelope_ts(value), MAIL_TIME)
        for value in (None, "", "not an envelope", "Jan 32 12:00:00 2024",
                      "Jan 2 12:00:00 1989", "Jan 2 12:00:00 2099"):
            self.assertIsNone(rank_correspondents.envelope_ts(value))

    def test_parse_date_received_envelope_fallback_order(self):
        received = "by relay.example.com; Tue, 02 Jan 2024 11:00:00 +0000"
        envelope = "alice@example.com Tue Jan  2 10:00:00 2024"
        for date, extra, env, expected in (
            (DATE, [("Received", received)], envelope, MAIL_TIME),
            ("invalid", [("Received", received)], envelope, MAIL_TIME - 3600),
            (None, [("Received", received)], envelope, MAIL_TIME - 3600),
            ("invalid", [("Received", "invalid")], envelope, MAIL_TIME - 7200),
            (None, [], None, None),
        ):
            with self.subTest(date=date, extra=extra):
                message = rank_correspondents.parse_message(headers(date=date, extra=extra), env)
                self.assertEqual(message.ts, expected)

    def test_parse_only_first_received_header_is_considered(self):
        message = rank_correspondents.parse_message(headers(date=None, extra=[
            ("Received", "by relay.example.com; invalid"),
            ("Received", "by relay.example.com; " + DATE),
        ]), "alice@example.com Tue Jan  2 10:00:00 2024")
        # baseline behaviour (P1 pin); P2 may change
        self.assertEqual(message.ts, MAIL_TIME - 7200)

    def test_message_id_is_normalized_and_sha1_uses_header_fields(self):
        self.assertEqual(self.parse(message_id="MiXeD").key, "mid:mixed@example.com")
        digest = hashlib.sha1((DATE + "|" + ALICE + "|A picnic|" + ALICE + "," + OWNER)
                              .encode("utf-8")).hexdigest()
        self.assertEqual(self.parse(message_id=None).key, "sha1:" + digest)
        self.assertEqual(self.parse(message_id=None, extra=[("X-Unrelated", "ignored")]).key,
                         "sha1:" + digest)
        self.assertNotEqual(self.parse(message_id=None, subject="Another picnic").key,
                            "sha1:" + digest)

    def test_thunderbird_deleted_flag_bit(self):
        for status, expected in (("0008", True), ("0009", True), ("0018", True),
                                 ("0000", False), ("0001", False), ("invalid", False)):
            with self.subTest(status=status):
                self.assertEqual(self.parse(extra=[("X-Mozilla-Status", status)]).expunged,
                                 expected)

    def test_rfc2047_names_subjects_and_cp1252_bytes(self):
        encoded = self.parse(sender="=?utf-8?q?Alice_Ex=C3=A4mple?= <alice@example.com>",
                             subject="=?utf-8?q?Picnic_=E2=80=93_tomorrow?=")
        self.assertEqual(encoded.from_name, "Alice Exämple")
        self.assertEqual(encoded.subject, "Picnic – tomorrow")
        raw = self.parse(sender="Alice Exämple <alice@example.com>",
                         subject="Picnic – tomorrow", encoding="cp1252")
        self.assertEqual(raw.from_name, "Alice Exämple")
        self.assertEqual(raw.subject, "Picnic – tomorrow")

    def test_participants_unique_to_cc_and_list_post(self):
        message = self.parse(extra=[("Cc", "Owner Example <owner@example.com>, bob@example.com"),
                                   ("Bcc", "hidden@example.com"),
                                   ("List-Post", "<mailto:picnic@example.com?subject=join>")])
        self.assertEqual(message.n_to_cc, 2)
        self.assertEqual(message.list_post, "picnic@example.com")
        self.assertEqual(message.parts, [("from", "Alice Example", ALICE, ALICE),
                                         ("to", "Owner Example", OWNER, OWNER),
                                         ("cc", "Owner Example", OWNER, OWNER),
                                         ("cc", "", BOB, BOB),
                                         ("bcc", "", "hidden@example.com", "hidden@example.com")])
        self.assertIsNone(rank_correspondents.parse_message(b"", None))
        self.assertIsNone(rank_correspondents.parse_message(b"Subject: no participants\n", None))


class SourceTests(TempTestCase):
    def test_folder_labels_sbd_mbox_and_eml(self):
        cases = [("Account.sbd/Sent.mbox", "Account/Sent"),
                 ("Account.sbd/Archive.sbd/2024", "Account/Archive/2024"),
                 ("Apple.mbox/mbox", "Apple"), (".Archive/message.eml", "Archive")]
        for relative, expected in cases:
            with self.subTest(relative=relative):
                self.assertEqual(rank_correspondents.folder_label(self.root, self.root / relative),
                                 expected)
        self.assertEqual(rank_correspondents.folder_label(self.root, self.root), self.root.name)
        self.assertEqual(rank_correspondents.folder_label(self.root / "other", self.root / "Sent"),
                         "Sent")

    def test_folder_kinds_sent_junk_and_draft_families(self):
        cases = [("Account/Sent Items", "sent"), ("[Sent]/2024", "sent"),
                 ("Account\\Sent", "sent"), ("Account/Junk", "junk"),
                 ("Account/Spam", "junk"), ("Account/Bulk Mail", "junk"),
                 ("Sent/Junk", "junk"), ("Sent/Drafts", "drafts"),
                 ("Inbox", "other"), ("Sentimental", "other")]
        cases.extend(("Account/" + name + "/2024", "drafts")
                     for name in ("Draft", "Drafts", "Template", "Templates", "Outbox", "Unsent"))
        for label, expected in cases:
            with self.subTest(label=label):
                self.assertEqual(rank_correspondents.folder_kind(label), expected)

    def test_sniff_and_empty_indexed_folder_discovery(self):
        source = self.root / "mail"
        box = self.mbox("mail/Inbox", [headers()])
        eml = self.write("mail/Archive.sbd/message.eml", headers() + b"\nbody\n")
        empty = self.write("mail/RemoteOnly", b"")
        self.write("mail/RemoteOnly.msf", b"x" * 4097)
        self.write("mail/SmallIndex", b"")
        self.write("mail/SmallIndex.msf", b"x" * 4096)
        self.write("mail/EmptyNoIndex", b"")
        not_mail = self.write("mail/not-mail", b"This is not an mbox")
        for relative in ("mail/hidden.msf", "mail/.hidden", "mail/notes.txt"):
            path = self.write(relative, b"From owner@example.com Tue Jan 2 12:00:00 2024\n")
            self.assertIsNone(rank_correspondents.sniff(path))
        self.assertEqual(rank_correspondents.sniff(box), "mbox")
        self.assertEqual(rank_correspondents.sniff(eml), "eml")
        self.assertEqual(rank_correspondents.sniff(empty), "empty")
        self.assertIsNone(rank_correspondents.sniff(not_mail))
        with self.assertRaises(OSError):
            rank_correspondents.sniff(source / "missing")
        indexed = []
        self.assertEqual(list(rank_correspondents.discover([str(source)], indexed)),
                         [("mbox", box, "Inbox"), ("eml", eml, "Archive")])
        self.assertEqual(indexed, ["RemoteOnly"])

    def test_read_maildir_and_eml_headers_only(self):
        maildir = self.root / "mail/Maildir"
        for directory in ("cur", "new", "tmp"):
            (maildir / directory).mkdir(parents=True)
        one, two = headers(message_id="one"), headers(message_id="two")
        self.write("mail/Maildir/cur/one", one + b"\nprivate synthetic body\n")
        self.write("mail/Maildir/new/two", two + b"\nprivate synthetic body\n")
        self.write("mail/Maildir/cur/.hidden", headers(message_id="hidden"))
        self.write("mail/Maildir/tmp/pending", headers(message_id="pending"))
        self.write("mail/Maildir/bookkeeping.eml", headers(message_id="bookkeeping"))
        self.assertEqual(list(rank_correspondents.discover([str(self.root / "mail")], [])),
                         [("maildir", maildir, "Maildir")])
        self.assertEqual(list(rank_correspondents.read_source("maildir", maildir)),
                         [(one, None), (two, None)])
        eml = self.write("single.eml", one + b"\nprivate synthetic body\n")
        self.assertEqual(list(rank_correspondents.read_source("eml", eml)), [(one, None)])

    def test_read_mbox_crlf_and_non_envelope_body_line(self):
        one = headers(message_id="one", newline="\r\n")
        two = headers(message_id="two", newline="\r\n")
        path = self.mbox("mail/Inbox", [one, two], newline=b"\r\n",
                         body=b"body text\r\nFrom this is just prose\r\nmore text")
        messages = list(rank_correspondents.read_mbox(path))
        self.assertEqual([h for h, _ in messages], [one, two])
        self.assertEqual([e for _, e in messages],
                         ["owner@example.com Tue Jan  2 12:00:00 2024"] * 2)

    def test_read_mbox_non_envelope_after_blank_splits_baseline(self):
        one = headers()
        path = self.mbox("mail/Inbox", [one],
                         body=b"body text\n\nFrom this is just prose\nNot a header\n\nend")
        # baseline behaviour (P1 pin); P2 may change
        self.assertEqual(list(rank_correspondents.read_mbox(path)), [
            (one, "owner@example.com Tue Jan  2 12:00:00 2024"),
            (b"Not a header\n", "this is just prose"),
        ])

    def test_header_line_cap_and_next_message_recovery(self):
        cap = rank_correspondents.MAX_HEADER_LINES
        self.assertEqual(cap, 3000)
        oversized = b"From: alice@example.com\n" + b"X-Synthetic: value\n" * (cap + 2)
        next_header = headers(message_id="after-cap")
        path = self.mbox("mail/Inbox", [oversized, next_header])
        messages = list(rank_correspondents.read_mbox(path))
        self.assertEqual(len(messages), 2)
        self.assertEqual(messages[0][0], b"".join(oversized.splitlines(keepends=True)[:cap]))
        self.assertEqual(messages[1][0], next_header)
        eml = self.write("oversized.eml", oversized + b"\nbody\n")
        self.assertEqual(rank_correspondents.read_header_file(eml), messages[0][0])

    def test_loader_skips_deleted_junk_drafts_and_unreadable(self):
        source = self.root / "mail"
        self.mbox("mail/Inbox", [headers(message_id="keep"),
                               headers(message_id="deleted", extra=[("X-Mozilla-Status", "0008")]),
                               headers(message_id="spam", extra=[("X-Gmail-Labels", "Spam")]),
                               headers(message_id="draft", extra=[("X-Gmail-Labels", "Draft")]),
                               b"Subject: no participants\n"])
        self.mbox("mail/Junk", [headers(message_id="folder-junk")])
        self.mbox("mail/Templates", [headers(message_id="folder-template")])
        conn, counts, folders, _ = self.database([source])
        self.assertEqual(dict(counts), {"read": 7, "deleted copies": 1, "junk": 2,
                                       "drafts": 2, "unreadable": 1})
        self.assertEqual(dict(folders), {"Inbox": 1})
        self.assertEqual(conn.execute("SELECT msg_key FROM messages").fetchall(),
                         [("mid:keep@example.com",)])


def address_scores(conn, half_life, ref_ts):
    """Both scoring passes, with every address its own person (per-address tallies)."""
    _, ignored = rank_correspondents.collect_address_stats(conn, {OWNER})
    return rank_correspondents.score_people(conn, lambda a: a, {OWNER}, half_life, ref_ts), ignored


class ScoringTests(TempTestCase):
    def score(self, messages, ref_ts=MAIL_TIME, half_life=10.0):
        box = self.mbox("mail/Inbox", messages)
        conn, _, _, _ = self.database([box])
        return address_scores(conn, half_life, ref_ts)

    def test_weight_tier_boundaries(self):
        for n, expected in ((0, 4.0), (1, 4.0), (2, 3.0), (3, 3.0), (4, 1.5),
                            (8, 1.5), (9, 0.75), (20, 0.75), (21, 0.25)):
            with self.subTest(direction="sent", n=n):
                self.assertEqual(rank_correspondents.sent_weight(n), expected)
        for n, expected in ((0, 1.5), (1, 1.5), (2, 1.5), (3, 1.0), (5, 1.0),
                            (6, 0.5), (15, 0.5), (16, 0.15)):
            with self.subTest(direction="received", n=n):
                self.assertEqual(rank_correspondents.recv_weight(n), expected)

    def test_sent_recipients_are_unique_and_exclude_self(self):
        stats, ignored = self.score([headers(sender="Owner Example <owner@example.com>",
            to="Alice Example <alice@example.com>, owner@example.com",
            extra=[("Cc", ALICE), ("Bcc", "Bob Sample <bob@example.com>")])])
        self.assertEqual(set(stats), {ALICE, BOB})
        for value in stats.values():
            self.assertEqual((value.sent_score, value.she_wrote, value.she_wrote_direct), (3, 1, 1))
        self.assertFalse(ignored)

    def test_sent_large_group_is_not_direct(self):
        addresses = ["person{}@example.com".format(i) for i in range(4)]
        stats, _ = self.score([headers(sender=OWNER, to=", ".join(addresses))])
        self.assertEqual(set(stats), set(addresses))
        for value in stats.values():
            self.assertEqual((value.sent_score, value.she_wrote_direct), (1.5, 0))

    def test_received_bcc_only_and_to_cc_weights(self):
        stats, _ = self.score([
            headers(message_id="bcc", to=BOB, extra=[("Bcc", OWNER)]),
            headers(message_id="cc", sender="Bob Sample <bob@example.com>", to=ALICE,
                    extra=[("Cc", OWNER)]),
        ])
        self.assertAlmostEqual(stats[ALICE].recv_score, 0.3)
        self.assertEqual(stats[ALICE].they_wrote, 1)
        self.assertEqual(stats[BOB].recv_score, 1.5)

    def test_decay_half_life_no_future_penalty_and_missing_date(self):
        for reference, expected in ((MAIL_TIME, 1.5),
                                    (MAIL_TIME + 10 * rank_correspondents.YEAR_SECONDS, 0.75),
                                    (MAIL_TIME + 20 * rank_correspondents.YEAR_SECONDS, 0.375),
                                    (MAIL_TIME - 86400, 1.5)):
            with self.subTest(reference=reference):
                stats, _ = self.score([headers()], ref_ts=reference)
                self.assertAlmostEqual(stats[ALICE].recv_score, expected)
        # An .eml has no envelope, so no date fallback can fill this missing timestamp.
        eml = self.write("undated.eml", headers(date=None))
        conn, _, _, _ = self.database([eml])
        scores, _ = address_scores(conn, 10, MAIL_TIME)
        self.assertEqual(scores[ALICE].recv_score, 0.75)
        stats, _ = rank_correspondents.collect_address_stats(conn, {OWNER})
        self.assertIsNone(stats[ALICE].first_ts)

    def test_received_bulk_and_automated_add_nothing(self):
        stats, ignored = self.score([
            headers(message_id="bulk", extra=[("List-Id", "picnic.example.com")]),
            headers(message_id="auto", sender="no-reply@example.com"),
            headers(message_id="personal", sender="Bob Sample <bob@example.com>"),
        ])
        self.assertEqual(set(stats), {BOB})
        self.assertEqual(stats[BOB].recv_score, 1.5)
        self.assertEqual(dict(ignored), {"bulk": 1, "automated": 1})

    def test_outbound_bulk_still_scores_baseline(self):
        stats, ignored = self.score([headers(sender=OWNER, to=ALICE,
                                            extra=[("Precedence", "bulk")])])
        # baseline behaviour (P1 pin); P2 may change
        self.assertEqual(stats[ALICE].sent_score, 4.0)
        self.assertEqual(stats[ALICE].she_wrote, 1)
        self.assertFalse(ignored)

    def test_two_way_bonus_is_applied_to_people(self):
        messages = [headers(message_id="in"),
                    headers(message_id="out", sender=OWNER, to="Alice Example <alice@example.com>")]
        stats, _ = self.score(messages)
        self.assertEqual((stats[ALICE].sent_score, stats[ALICE].recv_score), (4.0, 1.5))
        conn, _, _, _ = self.database([self.root / "mail/Inbox"])
        ranking = rank_correspondents.rank_from_db(conn, [OWNER], excl=(set(), set()), book={},
                                                   min_received=2, half_life=10.0)
        people, dropped = ranking.people, ranking.dropped
        self.assertFalse(dropped)
        self.assertEqual(len(people), 1)
        self.assertEqual(people[0]["score"], 6.9)  # (4 + 1.5) * 1.25, rounded to one decimal
        self.assertEqual(people[0]["flags"], "two-way")

    def test_cross_account_and_folder_duplicates_count_once(self):
        messages = [headers(message_id="in"), headers(message_id="out", sender=OWNER, to=ALICE)]
        one = self.mbox("account-one/Inbox", messages)
        two = self.mbox("account-two/Archive.sbd/2024", messages)
        conn, counts, folders, _ = self.database([one.parent, two.parent.parent])
        self.assertEqual(dict(counts), {"read": 4, "duplicates": 2})
        self.assertEqual(sum(folders.values()), 2)
        self.assertEqual(conn.execute("SELECT COUNT(*) FROM participants").fetchone()[0], 4)
        stats, _ = address_scores(conn, 10, MAIL_TIME)
        self.assertEqual((stats[ALICE].she_wrote, stats[ALICE].they_wrote), (1, 1))
        self.assertEqual((stats[ALICE].sent_score, stats[ALICE].recv_score), (4.0, 1.5))


def hand_stats(address, name="", sent=0, received=0, timestamp=MAIL_TIME, subject="A picnic"):
    """One address's evidence and its tally, as if from separate one-recipient messages."""
    value = rank_correspondents.AddrStats()
    value.touch(timestamp, address, name, subject)
    if sent:
        value.last_sent_ts = timestamp
    tally = rank_correspondents.Tally()
    tally.she_wrote = tally.she_wrote_direct = sent
    tally.they_wrote = received
    tally.sent_score = 4.0 * sent
    tally.recv_score = 1.5 * received
    return value, tally


def hand_people(entries, book=None, excluded=None, own_keys=None, lists=None, min_received=2,
                self_addrs=(OWNER,)):
    """build_people over hand-built entries; tallies of one person's addresses are summed."""
    book = book or {}
    stats = {address: value for address, (value, _) in entries.items()}
    keys = rank_correspondents.person_keys(stats, book)
    scores = {}
    for address, (_, tally) in entries.items():
        total = scores.setdefault(keys[address], rank_correspondents.Tally())
        for field in ("sent_score", "recv_score", "she_wrote", "she_wrote_direct", "they_wrote"):
            setattr(total, field, getattr(total, field) + getattr(tally, field))
    return rank_correspondents.build_people(stats, scores, book, excluded or (set(), set()),
                                            list(self_addrs), own_keys or set(), lists or set(),
                                            min_received)


class PeopleTests(TempTestCase):
    def stats(self, address, name="", sent=0, received=0, timestamp=MAIL_TIME, subject="A picnic"):
        return hand_stats(address, name, sent, received, timestamp, subject)

    def people(self, stats, book=None, excluded=None, own_keys=None, lists=None, min_received=2):
        return hand_people(stats, book, excluded, own_keys, lists, min_received)

    def test_full_name_grouping_prefers_household_sent_address_and_aggregates(self):
        # Rulings R2/R5 (plan §2): the household's own most recent address wins over a
        # newer address the person wrote from. Before the cleanup plan the latest-seen
        # address (alice@) was chosen here.
        older = dt.datetime(2020, 1, 2, 12, tzinfo=dt.timezone.utc).timestamp()
        stats = {
            "alice-old@example.com": self.stats("alice-old@example.com", "Example, Alice A.",
                                                 sent=1, timestamp=older, subject="Re: A picnic"),
            ALICE: self.stats(ALICE, "Dr. Alice Example", received=1, subject="A picnic"),
            BOB: self.stats(BOB, "Bob Sample", sent=1),
        }
        people, dropped, own = self.people(stats)
        self.assertEqual([p["send_to"] for p in people], ["alice-old@example.com", BOB])
        alice = people[0]
        self.assertEqual((alice["she_wrote"], alice["they_wrote"], alice["score"]), (1, 1, 6.9))
        self.assertEqual((alice["first_year"], alice["last_year"], alice["years_active"]), (2020, 2024, 2))
        self.assertEqual(alice["other_addresses"], "alice@example.com (last 2024)")
        self.assertEqual(alice["names_seen"], "Example, Alice A. / Dr. Alice Example")
        self.assertEqual(alice["recent_subjects"], "A picnic")
        self.assertEqual([p["rank"] for p in people], [1, 2])
        self.assertFalse(dropped)
        self.assertFalse(own)

    def test_single_word_names_do_not_merge_different_addresses(self):
        people, _, _ = self.people({ALICE: self.stats(ALICE, "Example", sent=1),
                                     BOB: self.stats(BOB, "Example", sent=1)})
        self.assertEqual({p["send_to"] for p in people}, {ALICE, BOB})

    def test_exclusion_file_address_and_both_domain_forms(self):
        path = self.write("exclude.txt", b"# synthetic exclusions\n ALICE@EXAMPLE.COM # note\n"
                                         b"@friends.example.com\nfamily.example.com\n")
        excluded = rank_correspondents.load_exclusions(str(path))
        self.assertEqual(excluded, ({ALICE}, {"friends.example.com", "family.example.com"}))
        for address in (ALICE, "bob@friends.example.com", "carol@family.example.com",
                        "dylan@branch.friends.example.com"):
            with self.subTest(address=address):
                self.assertTrue(rank_correspondents.is_excluded(address, excluded))
                people, dropped, _ = self.people({address: self.stats(address, sent=1)},
                                                  excluded=excluded)
                self.assertEqual(people, [])
                self.assertEqual(dict(dropped), {"excluded": 1})
        self.assertFalse(rank_correspondents.is_excluded(BOB, excluded))
        self.assertFalse(rank_correspondents.is_excluded("bob@notfriends.example.com", excluded))

    def test_any_excluded_address_drops_the_whole_name_group(self):
        stats = {ALICE: self.stats(ALICE, "Alice Example", sent=1),
                 "alice-old@example.com": self.stats("alice-old@example.com", "Alice Example", sent=1)}
        people, dropped, _ = self.people(stats, excluded=({"alice-old@example.com"}, set()))
        self.assertEqual(people, [])
        self.assertEqual(dict(dropped), {"excluded": 1})

    def test_contacts_csv_adds_names_and_address_book_only_flag(self):
        path = self.write("contacts.csv", (
            '\ufeffFirst Name,Last Name,Display Name,E-mail Address,E-mail 2 Address,E-mail Type\n'
            'Alice,Example,,alice@example.com,alice-alt@example.com,SMTP\n'
            ',,Bob Sample,bob@example.com,,SMTP\n'
        ).encode("utf-8"))
        book = rank_correspondents.load_contacts(str(path))
        self.assertEqual(book, {ALICE: "Alice Example", "alice-alt@example.com": "Alice Example",
                                BOB: "Bob Sample"})
        people, _, _ = self.people({ALICE: self.stats(ALICE, "Nickname", received=1)}, book=book)
        self.assertEqual([p["name"] for p in people], ["Alice Example", "Bob Sample"])
        self.assertEqual(people[0]["flags"], "in her address book")
        self.assertEqual(people[0]["first_name"], "Alice")
        self.assertEqual(people[1]["flags"], "in her address book; address book only")
        self.assertEqual(people[1]["score"], 0.0)

    def test_mailing_list_has_no_first_name(self):
        address = "picnic@example.com"
        people, _, _ = self.people({address: self.stats(address, "Picnic Example", sent=1)},
                                    lists={address})
        self.assertEqual(people[0]["send_to"], address)
        self.assertEqual(people[0]["first_name"], "")
        self.assertEqual(people[0]["flags"], "mailing list: one email reaches the group")

    def test_contacts_preserve_multiline_and_unicode_separators(self):
        for separator in ("\r\n", "\n", "\r", "\v", "\f", "\x1c", "\x1d", "\x1e",
                          "\x85", "\u2028", "\u2029"):
            with self.subTest(separator=repr(separator)):
                text = ('Display Name,E-mail Address\r\n"Alice' + separator
                        + 'Example",alice@example.com\r\nBob Sample,bob@example.com\r\n')
                path = self.write("contacts.csv", text.encode("utf-8"))
                self.assertEqual(rank_correspondents.load_contacts(str(path)),
                                 {ALICE: "Alice" + separator + "Example", BOB: "Bob Sample"})

    def test_min_received_threshold_and_sent_exception(self):
        stats = {ALICE: self.stats(ALICE, "Alice Example", received=1),
                 BOB: self.stats(BOB, "Bob Sample", received=2),
                 "carol@example.com": self.stats("carol@example.com", "Carol Fiction", sent=1)}
        people, dropped, _ = self.people(stats)
        self.assertEqual({p["send_to"] for p in people}, {BOB, "carol@example.com"})
        self.assertEqual(dict(dropped), {"below threshold": 1})
        people, dropped, _ = self.people(stats, min_received=1)
        self.assertEqual(len(people), 3)
        self.assertFalse(dropped)

    def test_self_address_and_own_full_name_are_excluded(self):
        # Keep the self-address group separate so the own-name branch is exercised too.
        stats = {OWNER: self.stats(OWNER, sent=1),
                 "alias@example.com": self.stats("alias@example.com", "Example, Owner", sent=1),
                 ALICE: self.stats(ALICE, "Alice Example", sent=1)}
        people, dropped, own = self.people(stats, own_keys={"owner example"})
        self.assertEqual([p["send_to"] for p in people], [ALICE])
        self.assertEqual(own, ["alias@example.com"])
        self.assertFalse(dropped)

    def test_automated_address_threshold_and_contact_exception(self):
        stats = {"support@example.com": self.stats("support@example.com", sent=2),
                 "sales@example.com": self.stats("sales@example.com", sent=3),
                 "info@example.com": self.stats("info@example.com")}
        people, dropped, _ = self.people(stats, book={"info@example.com": "Info Example"})
        self.assertEqual({p["send_to"] for p in people}, {"sales@example.com", "info@example.com"})
        self.assertEqual(dict(dropped), {"automated": 1})
        self.assertTrue(all("looks automated" in p["flags"] for p in people))


class RankMainTests(TempTestCase):
    def test_rank_outputs_csv_bom_formula_pins_permissions_and_sqlite(self):
        names = {ALICE: "=Alice Exämple", BOB: "+Bob Sample",
                 "carol@example.com": "-Carol Fiction", "dylan@example.com": "@Dylan Pretend"}
        messages = [headers(message_id="out-{}".format(i), sender="Owner Example <owner@example.com>",
                            to='"{}" <{}>'.format(name, address), subject=name[0] + "Picnic")
                    for i, (address, name) in enumerate(names.items())]
        sent = self.mbox("mail/Sent", messages)
        inbox = self.mbox("mail/Inbox", [headers(message_id="reply", sender='"=Alice Exämple" <alice@example.com>',
                                                subject="=Picnic")])
        self.write("mail/RemoteOnly", b"")
        self.write("mail/RemoteOnly.msf", b"x" * 4097)
        originals = {path: path.read_bytes() for path in (sent, inbox)}
        out = self.root / "out"
        out.mkdir(mode=0o755)
        result = rank_correspondents.rank_main([str(self.root / "mail"), "--out", str(out),
                                                "--self", OWNER])
        self.assertEqual(result, 0)
        csv_path, db_path = out / "correspondents.csv", out / "mail.sqlite"
        self.assertTrue(csv_path.read_bytes().startswith(b"\xef\xbb\xbf"))
        with csv_path.open(encoding="utf-8-sig", newline="") as stream:
            reader = csv.DictReader(stream)
            self.assertEqual(reader.fieldnames, rank_correspondents.CSV_COLUMNS)
            self.assertEqual(reader.fieldnames, ["rank", "notify", "first_name", "last_name", "email", "name",
                "account", "account_basis", "score", "she_wrote", "she_wrote_direct", "they_wrote", "first_year", "last_year",
                "years_active", "other_addresses", "names_seen", "recent_subjects", "flags"])
            rows = list(reader)
        self.assertEqual(len(rows), 4)
        self.assertEqual([r["rank"] for r in rows], ["1", "2", "3", "4"])
        self.assertEqual(rows[0]["email"], ALICE)
        self.assertEqual(rows[0]["score"], "6.9")
        for row in rows:
            name = names[row["email"]]
            # P2 guards every formula prefix, including a leading minus.
            prefix = "'"
            self.assertEqual(row["name"], prefix + name)
            self.assertEqual(row["names_seen"], prefix + name)
            self.assertEqual(row["recent_subjects"], prefix + name[0] + "Picnic")
        self.assertEqual(stat.S_IMODE(out.stat().st_mode), 0o700)
        for path in (csv_path, db_path):
            self.assertEqual(stat.S_IMODE(path.stat().st_mode), 0o600)
        with contextlib.closing(sqlite3.connect(str(db_path))) as conn:
            objects = set(conn.execute("SELECT type, name FROM sqlite_master WHERE type IN ('table', 'view')"))
            self.assertEqual(objects, {("table", "messages"), ("table", "participants"),
                ("table", "self_addresses"), ("table", "people"),
                ("view", "her_sent"), ("view", "received_personal")})
            self.assertEqual(conn.execute("SELECT COUNT(*) FROM messages").fetchone()[0], 5)
            self.assertEqual(conn.execute("SELECT COUNT(*) FROM her_sent").fetchone()[0], 4)
            self.assertEqual(conn.execute("SELECT COUNT(*) FROM received_personal").fetchone()[0], 1)
            self.assertEqual(dict(conn.execute("SELECT email, name FROM people")), names)
        self.assertIn("1 folder", self.stderr.getvalue())
        self.assertIn("not downloaded", self.stderr.getvalue())
        for path, original in originals.items():
            self.assertEqual(path.read_bytes(), original)
        self.assertFalse((self.root / "home/jo-mail-review").exists())

    def test_rank_min_received_cli_option_and_inferred_self(self):
        self.mbox("mail/Sent", [headers(message_id="out", sender="Owner Example <owner@example.com>",
                                       to="Alice Example <alice@example.com>")])
        self.mbox("mail/Inbox", [headers(message_id="in", sender="Bob Sample <bob@example.com>")])
        for minimum, expected in ((2, {ALICE}), (1, {ALICE, BOB})):
            with self.subTest(minimum=minimum):
                out = self.root / "out-{}".format(minimum)
                self.assertEqual(rank_correspondents.rank_main([str(self.root / "mail"), "--out", str(out),
                                 "--min-received", str(minimum), "--top", "0"]), 0)
                with (out / "correspondents.csv").open(encoding="utf-8-sig", newline="") as stream:
                    self.assertEqual({r["email"] for r in csv.DictReader(stream)}, expected)
        self.assertIn("from her Sent folder", self.stdout.getvalue())

    def test_rank_refuses_output_inside_git_before_writing(self):
        box = self.mbox("mail/Inbox", [headers()])
        for marker_kind in ("directory", "file"):
            with self.subTest(marker_kind=marker_kind):
                repo = self.root / ("repo-" + marker_kind)
                repo.mkdir()
                # The guard checks .git existence, including worktrees' .git files.
                marker = repo / ".git"
                if marker_kind == "directory":
                    marker.mkdir()
                else:
                    marker.write_text("gitdir: synthetic\n", encoding="utf-8")
                out = repo / "nested/output"
                self.assertEqual(rank_correspondents.enclosing_git_repo(out), repo)
                with self.assertRaises(SystemExit) as error:
                    rank_correspondents.rank_main([str(box), "--out", str(out), "--self", OWNER])
                self.assertEqual(error.exception.code, 2)
                self.assertFalse(out.exists())
        self.assertIn("inside the git repository", self.stderr.getvalue())


class FrozenDateTime(dt.datetime):
    @classmethod
    def now(cls, tz=None):
        return cls(2025, 1, 15, 8, 2, tzinfo=tz)


SECOND = "second@example.com"
SEND_FIELDS = ["email", "first_name", "last_name", "name", "account"]
TARGET = "https://www.jowray.com"


class NameHardeningTests(QuietTestCase):
    def test_last_names_particles_suffixes_and_blank(self):
        # Synthetic names exercise the same forms as the brief's examples.
        cases = [("Example, Alice A.", "Example"), ("Bob van Sample", "van Sample"),
                 ("Alice Example Jr.", "Example"), ("Carol de la Fiction", "de la Fiction"),
                 ("Dylan", ""), ("", ""), ("Dr. Alice", ""),
                 ("Alice Example, Jr.", "Example"), ("Example, Alice III", "Example")]
        self.assertTrue(callable(getattr(rank_correspondents, "last_name_of", None)))
        for name, expected in cases:
            with self.subTest(name=name):
                self.assertEqual(rank_correspondents.last_name_of(name), expected)
        for particle in "van von de da del der du la le st".split():
            self.assertEqual(rank_correspondents.last_name_of("Alice " + particle.upper() + " Example"),
                             particle.upper() + " Example")

    def test_first_name_all_suffix_forms(self):
        for suffix in ("Jr", "Sr", "II", "III", "IV"):
            for separator in (" ", ", ", ","):
                for punctuation in ("", ".", ","):
                    with self.subTest(suffix=suffix, separator=separator, punctuation=punctuation):
                        self.assertEqual(rank_correspondents.first_name_of(
                            "Alice Example" + separator + suffix + punctuation), "Alice")

    def test_credentials_are_not_names_or_last_first_separators(self):
        credentials = "MD PhD RN Esq DDS DMD DO DVM CPA JD MBA MSW LCSW NP PA OD RPh".split()
        for credential in credentials:
            for value in (credential, credential.lower(), ".".join(credential) + "."):
                names = ["Alice Example, " + value, "Alice Example III, " + value,
                         "Example, Alice, " + value]
                if len(credential) > 2 or value.isupper() or "." in value:
                    names.append("Alice Example " + value)
                for name in names:
                    with self.subTest(name=name):
                        self.assertEqual(rank_correspondents.first_name_of(name), "Alice")
                        self.assertEqual(rank_correspondents.last_name_of(name), "Example")
        self.assertEqual(rank_correspondents.first_name_of("Alice Example, MD, Ph.D."), "Alice")
        self.assertEqual(rank_correspondents.last_name_of("Alice Example, MD, Ph.D."), "Example")

    def test_two_letter_credentials_preserve_ambiguous_surnames(self):
        for credential in ("DO", "PA", "OD", "NP", "JD", "MD", "RN"):
            for spelling in (credential, credential.title(), credential.lower()):
                with self.subTest(credential=spelling):
                    self.assertEqual(rank_correspondents.first_name_of("Alice " + spelling), "Alice")
                    self.assertEqual(rank_correspondents.last_name_of("Alice " + spelling), spelling)
                    self.assertEqual(rank_correspondents.last_name_of("Dr. Alice " + spelling), spelling)
                    self.assertEqual(rank_correspondents.first_name_of("Alice, " + spelling), "Alice")
                    self.assertEqual(rank_correspondents.last_name_of("Alice, " + spelling), "")
                    self.assertEqual(rank_correspondents.last_name_of("Alice " + ".".join(spelling) + "."), "")
            self.assertEqual(rank_correspondents.last_name_of("Alice Example " + credential), "Example")
            self.assertEqual(rank_correspondents.last_name_of("Alice Example " + credential.lower()), credential.lower())
            self.assertEqual(rank_correspondents.last_name_of("Alice Example " + credential.title()), credential.title())
        self.assertEqual(rank_correspondents.last_name_of("ALICE DO"), "Do")
        self.assertEqual(rank_correspondents.last_name_of("Alice Do, PhD"), "Do")
        self.assertEqual(rank_correspondents.last_name_of("Alice Pa, MD"), "Pa")

    def test_title_followed_by_one_word_never_guesses_either_name(self):
        for title in ("Mrs.", "Dr.", "Sister", "Brother", "Father", "Fr.", "Pastor", "Rev.", "Reverend"):
            for spelling in (title, title.upper(), title.lower()):
                with self.subTest(title=spelling):
                    self.assertEqual(rank_correspondents.first_name_of(spelling + " Example"), "")
                    self.assertEqual(rank_correspondents.last_name_of(spelling + " Example"), "")
                    self.assertEqual(rank_correspondents.first_name_of(spelling + " Alice Example"), "Alice")
                    self.assertEqual(rank_correspondents.last_name_of(spelling + " Alice Example"), "Example")

    def test_symbol_case_family_and_title_name_parts(self):
        for name, first, last in (
            ("Alice Example 🌸", "Alice", "Example"), ("☀ Alice Example ©", "Alice", "Example"),
            ("Alice Example 👩‍⚕️", "Alice", "Example"), ("ALICE EXAMPLE", "Alice", "Example"),
            ("EXAMPLE, ALICE", "Alice", "Example"), ("BOB VAN SAMPLE", "Bob", "Van Sample"),
            ("The Example Family", "", ""), ("Example families", "", ""),
            ("The Example Family 🌸", "", ""), ("Mrs. Example", "", ""),
            ("MRS. EXAMPLE", "", ""), ("Alice", "Alice", ""),
        ):
            with self.subTest(name=name):
                self.assertEqual(rank_correspondents.first_name_of(name), first)
                self.assertEqual(rank_correspondents.last_name_of(name), last)

    def test_list_last_name_is_empty(self):
        people, _, _ = hand_people({ALICE: hand_stats(ALICE, "Picnic List", sent=1, subject="")},
                                   lists={ALICE})
        self.assertEqual(people[0].get("last_name"), "")


class PipelineTestCase(TempTestCase):
    def setUp(self):
        super().setUp()
        self.contexts.enter_context(mock.patch.object(rank_correspondents.dt, "datetime", FrozenDateTime))

    def csv_file(self, filename, fields, rows, bom=False):
        stream = io.StringIO(newline="")
        writer = csv.DictWriter(stream, fieldnames=fields)
        writer.writeheader()
        writer.writerows(rows)
        return self.write(filename, stream.getvalue().encode("utf-8-sig" if bom else "utf-8"))

    def read_csv(self, path):
        with path.open(encoding="utf-8-sig", newline="") as stream:
            reader = csv.DictReader(stream)
            return reader.fieldnames, list(reader)

    def assert_quiet(self):
        output = (self.stdout.getvalue() + self.stderr.getvalue()).casefold()
        for secret in ("@", "Alice", "Bob", "Owner", "Sample", "Example", "Fiction",
                       "Picnic", "Tomorrow", "Seashell", "RemoteOnly", "SecretArchive", "PrivateNotes"):
            self.assertNotIn(secret.casefold(), output)
        self.assertNotIn(str(self.root).casefold(), output)
        self.assertNotIn(self.root.name.casefold(), output)

    def assert_private_refusal(self, command):
        self.clear_console()
        with self.assertRaises(SystemExit) as error:
            command()
        self.assertEqual(error.exception.code, 2)
        self.assert_quiet()
        self.assertNotIn("/", self.stdout.getvalue() + self.stderr.getvalue())

    def clear_console(self):
        for stream in (self.stdout, self.stderr):
            stream.seek(0)
            stream.truncate()


class AccountTests(PipelineTestCase):
    def rank(self, roots, accounts=(OWNER, SECOND), extra=(), output="out"):
        out = self.root / output
        args = [str(p) for p in roots] + ["--out", str(out)]
        for account in accounts:
            args += ["--self", account]
        self.assertEqual(rank_correspondents.rank_main(args + list(extra)), 0)
        self.assert_quiet()
        return out, self.read_csv(out / "correspondents.csv")[1]

    def test_ordered_self_and_every_header_attribution_branch(self):
        cases = [
            ("from", {"sender": SECOND, "to": OWNER}, SECOND, "from"),
            ("to", {"to": SECOND, "extra": [("Cc", OWNER)]}, SECOND, "to"),
            ("to-tie", {"to": SECOND + ", " + OWNER}, OWNER, "to"),
            ("cc", {"to": BOB, "extra": [("Cc", SECOND)]}, SECOND, "cc"),
            ("cc-tie", {"to": BOB, "extra": [("Cc", SECOND + ", " + OWNER)]}, OWNER, "cc"),
            ("delivered", {"to": BOB, "extra": [("Delivered-To", SECOND)]}, SECOND, "delivered"),
            ("original", {"to": BOB, "extra": [("X-Original-To", OWNER)]}, OWNER, "delivered"),
            ("delivered-tie", {"to": BOB, "extra": [("Delivered-To", SECOND),
                ("X-Original-To", OWNER)]}, OWNER, "delivered"),
            ("cc-before-delivered", {"to": BOB, "extra": [("Cc", SECOND),
                ("Delivered-To", OWNER)]}, SECOND, "cc"),
        ]
        box = self.mbox("mail/Inbox", [headers(message_id=key, **kwargs) for key, kwargs, _, _ in cases])
        for accounts in ((OWNER, SECOND), (SECOND, OWNER)):
            out, _ = self.rank([box], accounts, output="out-" + str(accounts.index(OWNER)))
            with contextlib.closing(sqlite3.connect(out / "mail.sqlite")) as conn:
                rows = dict((key, (account, basis)) for key, account, basis in conn.execute(
                    "SELECT msg_key, account, account_basis FROM messages"))
            for key, _, account, basis in cases:
                with self.subTest(key=key, accounts=accounts):
                    expected = accounts[0] if key.endswith("tie") else account
                    self.assertEqual(rows["mid:" + key + "@example.com"], (expected, basis))

    def test_canonical_self_order_and_weighted_decay_are_preserved(self):
        box = self.mbox("mail/Inbox", [
            headers(message_id="old", sender=OWNER, to="Alice Example <alice@example.com>",
                    date="Sun, 02 Jan 1994 12:00:00 +0000"),
            headers(message_id="new", to=SECOND),
            headers(message_id="cc", to=BOB, extra=[("Cc", SECOND)])])
        _, rows = self.rank([box], (" SECOND@EXAMPLE.COM ", OWNER, SECOND))
        self.assertEqual(len(rows), 1)
        self.assertEqual((rows[0]["account"], rows[0]["account_basis"]), (SECOND, "to"))
        with contextlib.closing(sqlite3.connect(":memory:")) as conn:
            addresses, _ = rank_correspondents.resolve_self(conn, [" SECOND@EXAMPLE.COM ", OWNER, SECOND])
            self.assertEqual(addresses, [SECOND, OWNER])

    def test_rank_permission_failure_exits_privately(self):
        box = self.mbox("mail/Inbox", [headers()])
        with mock.patch.object(rank_correspondents.os, "fchmod", side_effect=PermissionError("Alice@example.com")):
            with self.assertRaises(SystemExit) as error:
                rank_correspondents.rank_main([str(box), "--self", OWNER, "--out", str(self.root / "out")])
        self.assertEqual(error.exception.code, 2)
        self.assertIn("PermissionError", self.stderr.getvalue())
        self.assert_quiet()

    def test_folder_inference_uses_source_root_of_kept_copy(self):
        self.mbox("one/Inbox", [headers(message_id="one", to=SECOND),
                               headers(message_id="two", to=SECOND)])
        fallback = headers(message_id="fallback", to=BOB, extra=[("Bcc", OWNER)])
        self.mbox("one/nested/Archive", [fallback])
        self.mbox("two/Inbox", [fallback, headers(message_id="three", to=OWNER)])
        self.mbox("two/nested/Archive", [headers(message_id="other", to=BOB)])
        self.mbox("empty-evidence/Inbox", [headers(message_id="unknown", to=BOB)])
        self.mbox("tie/Inbox", [headers(message_id="tie-a", to=SECOND),
            headers(message_id="tie-b", to=OWNER), headers(message_id="tie-fallback", to=BOB)])
        for accounts in ((OWNER, SECOND), (SECOND, OWNER)):
            with self.subTest(accounts=accounts):
                out, _ = self.rank([self.root / x for x in ("one", "two", "empty-evidence", "tie")],
                                   accounts, output="out-" + str(accounts.index(OWNER)))
                with contextlib.closing(sqlite3.connect(out / "mail.sqlite")) as conn:
                    rows = dict((key, (account, basis)) for key, account, basis in conn.execute(
                        "SELECT msg_key, account, account_basis FROM messages WHERE account_basis = 'folder'"))
                    self.assertEqual(conn.execute("SELECT COUNT(*) FROM messages").fetchone()[0], 9)
                self.assertEqual(rows, {"mid:fallback@example.com": (SECOND, "folder"),
                    "mid:other@example.com": (OWNER, "folder"),
                    "mid:unknown@example.com": (accounts[0], "folder"),
                    "mid:tie-fallback@example.com": (accounts[0], "folder")})

    def test_recent_received_messages_outweigh_more_old_received_messages(self):
        # 8 messages, thirty years old, contribute about 1.5 total; 2 recent ones contribute 3.
        old = [headers(message_id="old-" + str(i), to=OWNER,
                       date="Sun, 02 Jan 1994 12:00:00 +0000") for i in range(8)]
        recent = [headers(message_id="new-" + str(i), to=SECOND) for i in range(2)]
        box = self.mbox("mail/Inbox", old + recent)
        _, rows = self.rank([box])
        self.assertEqual(len(rows), 1)
        self.assertEqual((rows[0]["account"], rows[0]["account_basis"]), (SECOND, "to"))
        self.assertEqual(rows[0]["they_wrote"], "10")
        self.assertEqual(rows[0]["score"], "4.5")

    def test_empty_index_warning_never_leaks_folder_labels_or_subjects(self):
        box = self.mbox("mail/SecretArchive", [headers(subject="Tomorrow Seashell Picnic")])
        self.write("mail/RemoteOnly", b"")
        self.write("mail/RemoteOnly.msf", b"x" * 4097)
        self.write("mail/PrivateNotes", b"")
        self.write("mail/PrivateNotes.msf", b"x" * 4097)
        self.rank([box.parent], extra=("--min-received", "1"))
        self.assertIn("2 folders", self.stderr.getvalue())
        self.assert_quiet()

    def test_sqlite_temp_store_and_indexes_before_attribution(self):
        box = self.mbox("mail/Inbox", [headers()])
        original = rank_correspondents.assign_accounts
        observed = []

        def inspect_connection(conn, accounts):
            observed.append(conn.execute("PRAGMA temp_store").fetchone()[0])
            self.assertEqual(observed[-1], 2)
            indexes = {row[0] for row in conn.execute("SELECT name FROM sqlite_master WHERE type = 'index'")}
            self.assertIn("ix_part_msg", indexes)
            original(conn, accounts)

        with mock.patch.object(rank_correspondents, "assign_accounts", side_effect=inspect_connection):
            self.rank([box])
        self.assertEqual(observed, [2])

    def test_ignored_household_names_and_missed_alias_counts_are_private(self):
        box = self.mbox("mail/Sent", [headers(message_id="known", sender=OWNER, to=ALICE),
            headers(message_id="missed", sender="Other Fiction <alias@example.com>", to=BOB)])
        self.rank([box], (OWNER,), extra=("--household-name", "Alice", "--household-name", "Bob"))
        self.assertIn("Ignored 2 household names", self.stdout.getvalue())
        self.assertIn("1 message in outgoing folders has an unlisted sender", self.stdout.getvalue())
        self.assert_quiet()
        self.clear_console()
        self.assertEqual(rank_correspondents.rank_main([str(box), "--out", str(self.root / "inferred")]), 0)
        self.assertNotIn("unlisted sender", self.stdout.getvalue())
        self.assert_quiet()

    def test_address_book_only_has_no_attribution_basis(self):
        box = self.mbox("mail/Inbox", [headers()])
        book = self.csv_file("contacts.csv", ["First Name", "Last Name", "E-mail Address"],
                             [{"First Name": "Bob", "Last Name": "Sample", "E-mail Address": BOB}])
        _, rows = self.rank([box], extra=("--contacts", str(book)))
        self.assertEqual(len(rows), 1)
        self.assertEqual((rows[0]["account"], rows[0]["account_basis"]), (OWNER, "none"))

    def test_singular_message_folder_and_household_name_counts(self):
        box = self.mbox("mail/Sent", [headers(sender="Owner Example <owner@example.com>", to=ALICE)])
        self.write("mail/RemoteOnly", b"")
        self.write("mail/RemoteOnly.msf", b"x" * 4097)
        self.rank([box.parent], (OWNER,))
        self.assertIn("Read 1 message from 1 folder", self.stdout.getvalue())
        self.assertIn("1 household account", self.stdout.getvalue())
        self.assertIn("1 household-sent message.", self.stdout.getvalue())
        self.assertIn("1 distinct household name ->", self.stdout.getvalue())
        self.assertIn("1 folder has", self.stderr.getvalue())
        self.assertNotIn("1 folders", self.stderr.getvalue())

    def test_singular_skipped_message_counts(self):
        kept = headers(message_id="kept", sender=OWNER, to=ALICE)
        box = self.mbox("mail/Sent", [kept, kept,
            headers(message_id="deleted", extra=[("X-Mozilla-Status", "0008")]),
            headers(message_id="junk", extra=[("X-Gmail-Labels", "Spam")]),
            headers(message_id="draft", extra=[("X-Gmail-Labels", "Draft")]),
            b"Subject: no participants\n"])
        self.rank([box], (OWNER,))
        for count in ("1 duplicate copy", "1 deleted copy", "1 junk message", "1 draft message", "1 unreadable message"):
            self.assertIn(count, self.stdout.getvalue())

    def test_rank_secures_output_and_existing_evidence_but_preserves_parent_mode(self):
        box = self.mbox("mail/Inbox", [headers()])
        parent = self.root / "existing"
        parent.mkdir()
        parent.chmod(0o751)
        out = parent / "out"
        evidence = out / "evidence"
        evidence.mkdir(parents=True)
        out.chmod(0o751)
        evidence.chmod(0o750)
        self.rank([box], output="existing/out")
        self.assertEqual(stat.S_IMODE(out.stat().st_mode), 0o700)
        self.assertEqual(stat.S_IMODE(parent.stat().st_mode), 0o751)
        self.assertEqual(stat.S_IMODE(evidence.stat().st_mode), 0o700)

    def test_person_account_weighting_basis_and_ordered_tie(self):
        # One direct outgoing message outweighs two received messages; same-name aliases merge.
        messages = [headers(message_id="sent", sender=SECOND, to="Alice Example <alice@example.com>"),
            headers(message_id="in1", to=OWNER), headers(message_id="in2", to=OWNER),
            headers(message_id="alias", sender="Alice Example <alice-old@example.com>", to=SECOND),
            headers(message_id="bob1", sender="Bob Sample <bob@example.com>", to=OWNER),
            headers(message_id="bob2", sender="Bob Sample <bob@example.com>", to=SECOND)]
        box = self.mbox("mail/Inbox", messages)
        for accounts in ((OWNER, SECOND), (SECOND, OWNER)):
            _, rows = self.rank([box], accounts, output="out-" + str(accounts.index(OWNER)))
            people = {row["name"]: row for row in rows}
            self.assertEqual((people["Alice Example"]["account"], people["Alice Example"]["account_basis"]),
                             (SECOND, "from"))
            self.assertEqual(people["Bob Sample"]["account"], accounts[0])

    def test_single_account_and_household_names_evidence(self):
        box = self.mbox("mail/Inbox", [
            headers(message_id="one", sender="Owner Example <owner@example.com>", to=ALICE),
            headers(message_id="two", sender="Owner Example <owner@example.com>", to=BOB),
            headers(message_id="three", sender="Owner Sample <owner@example.com>", to=BOB),
            headers(message_id="four", sender=OWNER, to="Household Fiction <alias@example.com>"),
            headers(message_id="five", sender=OWNER, to="Another Fiction <other@example.com>"),
            headers(message_id="hidden", to=BOB),
        ])
        _, before = self.rank([box], (OWNER,), output="before")
        self.assertEqual(len(before), 4)
        out, after = self.rank([box], (OWNER,), extra=("--household-name", "Household Fiction",
                                                       "--household-name", "Another Fiction"))
        self.assertEqual({row["email"] for row in after}, {ALICE, BOB})
        self.assertEqual({row["account"] for row in after}, {OWNER})
        evidence = out / "evidence/household-names.txt"
        self.assertEqual(evidence.read_text(), "2\tOwner Example\n1\tOwner Sample\n")
        self.assertEqual(stat.S_IMODE(evidence.stat().st_mode), 0o600)
        self.assertEqual(stat.S_IMODE(evidence.parent.stat().st_mode), 0o700)
        self.assertIn("2 distinct household names", self.stdout.getvalue())

    def test_rank_errors_and_warnings_never_print_data(self):
        box = self.mbox("mail/Inbox", [headers()])
        exclusion = self.write("Alice@example.com.txt", b"bad@@example.com\n")
        out, _ = self.rank([box], extra=("--exclude", str(exclusion)))
        self.assert_private_refusal(lambda: rank_correspondents.rank_main(
            [str(box), str(self.root / "Bob@example.com"), "--out", str(out), "--self", OWNER]))
        for extra in (("--self", "Alice@example.com invalid"), ("--half-life", "Alice@example.com"),
                      ("--exclude", str(self.root / "Alice@example.com-missing")),
                      ("--contacts", str(self.root / "Bob@example.com-missing"))):
            with self.subTest(extra=extra):
                with self.assertRaises(SystemExit):
                    rank_correspondents.rank_main([str(box), "--out", str(out)] + list(extra))
                self.assert_quiet()

    def test_verbose_top_is_explicit_opt_in(self):
        box = self.mbox("mail/Sent", [headers(sender=OWNER, to="Alice Example <alice@example.com>")])
        self.assertEqual(rank_correspondents.rank_main(
            [str(box), "--self", OWNER, "--out", str(self.root / "out"), "--verbose"]), 0)
        self.assertIn(ALICE, self.stdout.getvalue())
        self.assertIn("Alice Example", self.stdout.getvalue())


class SendListTests(PipelineTestCase):
    def reviewed(self, rows=None, legacy=False):
        rows = rows if rows is not None else [self.row()]
        field = "send_to" if legacy else "email"
        if legacy:
            rows = [{("send_to" if k == "email" else k): v for k, v in r.items()} for r in rows]
        return self.csv_file("reviewed.csv", ["rank", "notify", field, "first_name", "last_name", "name", "account"],
                             rows, bom=True)

    def row(self, **changes):
        return dict({"rank": "1", "notify": "y", "email": ALICE, "first_name": "Alice",
                     "last_name": "Example", "name": "Alice Example", "account": OWNER}, **changes)

    def send(self, source, extra=()):
        destination = self.root / "out/send_list.csv"
        self.assertEqual(rank_correspondents.send_list_main([str(source), "--out", str(destination.parent),
                            "--self", OWNER, "--self", SECOND] + list(extra)), 0)
        self.assert_quiet()
        return destination, *self.read_csv(destination)

    def test_plain_list_rank_order_dedupe_and_no_bom(self):
        source = self.reviewed([self.row(rank="3", email="carol@example.com", first_name="Carol"),
            self.row(rank="2", email=BOB, first_name="Bob"),
            self.row(rank="1", email=" ALICE@EXAMPLE.COM "),
            self.row(rank="4", first_name="Duplicate"), self.row(rank="0", notify="no")])
        original = (source.read_bytes(), source.stat().st_mtime_ns)
        destination, fields, rows = self.send(source)
        self.assertEqual(fields, SEND_FIELDS)
        self.assertEqual([r["email"] for r in rows], [ALICE, BOB, "carol@example.com"])
        self.assertEqual([r["first_name"] for r in rows], ["Alice", "Bob", "Carol"])
        self.assertFalse(destination.read_bytes().startswith(b"\xef\xbb\xbf"))
        self.assertNotIn(b"\r", destination.read_bytes())
        self.assertEqual(stat.S_IMODE(destination.stat().st_mode), 0o600)
        self.assertEqual(stat.S_IMODE(destination.parent.stat().st_mode), 0o700)
        self.assertEqual((source.read_bytes(), source.stat().st_mtime_ns), original)
        self.assertIn("1 duplicate row dropped", self.stdout.getvalue())

    def test_canonical_dedupe_keeps_first_ranked_written_address(self):
        source = self.reviewed([
            self.row(rank="3", email="alice@alias.example.com", account=SECOND),
            self.row(rank="1", email=" A.li.ce+picnic@EXAMPLE.COM "),
            self.row(rank="2", email="alice@example.com"),
            self.row(rank="4", email=BOB, first_name="Bob")])
        # Reserve example.com fixtures while exercising both Gmail provider aliases.
        with mock.patch.object(rank_correspondents, "GMAIL_DOMAINS",
                               {"example.com", "alias.example.com"}):
            _, _, rows = self.send(source)
        self.assertEqual([r["email"] for r in rows], ["a.li.ce+picnic@example.com", BOB])
        self.assertEqual(rows[0]["first_name"], "Alice")
        self.assertIn("2 duplicate rows dropped", self.stdout.getvalue())

    def test_household_recipient_alias_is_refused_by_rank(self):
        source = self.reviewed([self.row(rank="7", email="o.wner+picnic@alias.example.com")])
        previous = self.write("out/send_list.csv", b"previous complete output\n")
        with mock.patch.object(rank_correspondents, "GMAIL_DOMAINS",
                               {"example.com", "alias.example.com"}):
            self.assert_private_refusal(lambda: rank_correspondents.send_list_main(
                [str(source), "--out", str(previous.parent), "--self", OWNER]))
        self.assertIn("household recipient at ranks 7", self.stderr.getvalue())
        self.assertEqual(previous.read_bytes(), b"previous complete output\n")

    def test_control_characters_in_every_send_field_are_refused(self):
        for character in ("\r", "\n", "\t", "\x00", "\x1f", "\x7f", "\x85", "\u2028", "\u2029"):
            for field in SEND_FIELDS:
                with self.subTest(character=repr(character), field=field):
                    # A trailing control must be refused before whitespace trimming too.
                    source = self.reviewed([self.row(rank="7", **{field: self.row()[field] + character})])
                    dst = self.write("out/send_list.csv", b"previous complete output\n")
                    self.assert_private_refusal(lambda: rank_correspondents.send_list_main(
                        [str(source), "--out", str(dst.parent), "--self", OWNER]))
                    self.assertIn("control characters at ranks 7", self.stderr.getvalue())
                    self.assertEqual(dst.read_bytes(), b"previous complete output\n")
                    self.assertEqual({p.name for p in dst.parent.iterdir()}, {"send_list.csv"})

    def test_send_list_schedule_round_trip_preserves_names_and_ledger_join(self):
        reviewed = self.reviewed([
            self.row(name="'Alice Example", first_name="'Alice", last_name="'=Example"),
            self.row(rank="2", email=BOB, first_name="Bob", last_name="Sample, Synthetic",
                     name="Bob Sample", account=SECOND)])
        source, _, rows = self.send(reviewed)
        self.assertEqual(rows[0]["first_name"], "'Alice")
        self.assertEqual(rows[0]["name"], "'Alice Example")
        self.assertEqual(rows[0]["last_name"], "=Example")
        self.assertNotIn("duplicate", self.stdout.getvalue())
        ledger = self.csv_file("invites.csv", ["email", "share_url"], [
            {"email": " ALICE@EXAMPLE.COM ", "share_url": TARGET + "/s/SYNTHETIC000"},
            {"email": BOB, "share_url": TARGET + "/s/SYNTHETIC001"}])
        ledger.write_bytes(("# target=" + TARGET + " memorial=synthetic\n").encode() + ledger.read_bytes())
        out = self.root / "scheduled"
        self.assertEqual(rank_correspondents.schedule_main([str(source), "--ledger", str(ledger),
            "--self", OWNER, "--self", SECOND, "--start", "2025-01-15 09:00", "--out", str(out)]), 0)
        for index, label in enumerate(("primary", "second")):
            exported = self.read_csv(out / ("send_list_" + label + ".csv"))[1]
            self.assertEqual(len(exported), 1)
            self.assertEqual({k: exported[0][k] for k in SEND_FIELDS}, rows[index])
            self.assertEqual(exported[0]["share_url"], TARGET + "/s/SYNTHETIC00" + str(index))
        self.assert_quiet()

    def test_nul_in_unselected_row_preserves_selected_backslashes(self):
        # Python 3.9 needs a reversible NUL transport through its CSV parser.
        # Literal escape-like text in a different, selected row must stay literal.
        name = 'Alice \\0 \\\\0 "Example, Synthetic"'
        source = self.reviewed([self.row(name=name),
                                self.row(rank="2", notify="no", email=BOB, name="Bob\0Sample")])
        _, _, rows = self.send(source)
        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0]["name"], name)

    def test_every_mark_bom_formula_guards_and_legacy_header(self):
        for legacy in (False, True):
            marks = ("y", "YES", "X", "1", "True", "✓", "✔", "✔️", "✓︎", "✅", "☑", "☑️")
            rows = [self.row(rank=str(i + 1), notify=mark, email="person{}@example.com".format(i))
                    for i, mark in enumerate(marks)]
            rows[0].update(name="=Alice Example", last_name="＠Example")
            guarded = [{k: "'" + v if v.startswith(("=", "＠")) else v
                        for k, v in row.items()} for row in rows]
            source = self.reviewed(guarded + [{}], legacy=legacy)
            _, fields, result = self.send(source)
            self.assertEqual(fields, SEND_FIELDS)
            self.assertEqual(result, [{k: row[k] for k in SEND_FIELDS} for row in rows])

    def test_refuses_invalid_rows_by_rank_and_writes_nothing(self):
        for changes, message in (({"first_name": " \t"}, "first_name"),
                                 ({"email": "Alice@@example.com"}, "address"),
                                 ({"account": "unknown@example.com"}, "account")):
            with self.subTest(changes=changes):
                self.clear_console()
                source = self.reviewed([self.row(rank="7", **changes)])
                dst = self.root / "out/send_list.csv"
                with self.assertRaises(SystemExit) as error:
                    rank_correspondents.send_list_main([str(source), "--out", str(dst.parent), "--self", OWNER])
                self.assertEqual(error.exception.code, 2)
                self.assertFalse(dst.exists())
                self.assertIn("7", self.stderr.getvalue())
                self.assertIn(message, self.stderr.getvalue())
                self.assert_quiet()

    def test_invalid_duplicate_is_still_refused_without_overwriting_prior_output(self):
        source = self.reviewed([self.row(), self.row(rank="2", first_name="")])
        dst = self.write("out/send_list.csv", b"previous valid output\n")
        original = (dst.read_bytes(), dst.stat().st_mtime_ns)
        with self.assertRaises(SystemExit):
            rank_correspondents.send_list_main([str(source), "--out", str(dst.parent), "--self", OWNER])
        self.assertEqual((dst.read_bytes(), dst.stat().st_mtime_ns), original)
        self.assert_quiet()

    def test_unknown_notify_marks_refuse_the_whole_export_by_rank(self):
        source = self.reviewed([self.row(rank="2"), self.row(rank="7", notify="maybe Alice"),
                                self.row(rank="9", notify="?", email=BOB)])
        with self.assertRaises(SystemExit) as error:
            self.send(source)
        self.assertEqual(error.exception.code, 2)
        self.assertIn("unrecognised notify", self.stderr.getvalue())
        self.assertIn("ranks 7, 9", self.stderr.getvalue())
        self.assertFalse((self.root / "out").exists())
        self.assert_quiet()

    def test_recognised_no_marks_are_ignored(self):
        rows = [self.row()] + [self.row(rank=str(i + 2), notify=mark, email="person{}@example.com".format(i))
                              for i, mark in enumerate(("", " ", "n", "NO", "0", "False", "-"))]
        _, _, exported = self.send(self.reviewed(rows))
        self.assertEqual(len(exported), 1)
        self.assertEqual(exported[0]["email"], ALICE)

    def test_output_directory_preserves_existing_parents_and_creates_private_children(self):
        source = self.reviewed()
        parent = self.root / "existing"
        parent.mkdir()
        parent.chmod(0o751)
        existing = parent / "out"
        existing.mkdir(mode=0o755)
        for out in (existing, parent / "new/nested"):
            self.assertEqual(rank_correspondents.send_list_main([str(source), "--out", str(out), "--self", OWNER]), 0)
            self.assertTrue((out / "send_list.csv").is_file())
            self.assertEqual(stat.S_IMODE(out.stat().st_mode), 0o700)
            self.assertEqual(stat.S_IMODE(parent.stat().st_mode), 0o751)
        for path in (parent / "new", parent / "new/nested"):
            self.assertEqual(stat.S_IMODE(path.stat().st_mode), 0o700)
        self.assert_quiet()

    def test_non_directory_out_refused_before_reading_or_writing(self):
        source = self.reviewed()
        out = self.write("Alice@example.com.txt", b"keep unchanged\n")
        out.chmod(0o640)
        before = (out.read_bytes(), out.stat().st_mtime_ns, out.stat().st_mode)
        with mock.patch.object(rank_correspondents, "read_text_any", side_effect=AssertionError("input was read")):
            with self.assertRaises(SystemExit):
                rank_correspondents.send_list_main([str(source), "--out", str(out), "--self", OWNER])
        self.assertEqual((out.read_bytes(), out.stat().st_mtime_ns, out.stat().st_mode), before)
        self.assertIn("--out must be a directory", self.stderr.getvalue())
        self.assert_quiet()

    def test_blank_header_columns_are_ignored_including_unlabelled_notes(self):
        for note in ("", "Alice Example private note"):
            self.clear_console()
            source = self.reviewed()
            cells = list(csv.reader(io.StringIO(source.read_text(encoding="utf-8-sig"), newline="")))
            cells[0] += ["", ""]
            cells[1] += [note, ""]
            with source.open("w", encoding="utf-8-sig", newline="") as stream:
                csv.writer(stream).writerows(cells)
            _, fields, exported = self.send(source)
            self.assertEqual(fields, SEND_FIELDS)
            self.assertEqual(exported, [{k: self.row()[k] for k in SEND_FIELDS}])
            self.assertNotIn("private note", self.stdout.getvalue() + self.stderr.getvalue())
            self.assert_quiet()

    def test_duplicate_nonblank_headers_are_still_refused(self):
        source = self.reviewed()
        cells = list(csv.reader(io.StringIO(source.read_text(encoding="utf-8-sig"), newline="")))
        cells[0] += ["email", ""]
        cells[1] += [BOB, ""]
        with source.open("w", encoding="utf-8-sig", newline="") as stream:
            csv.writer(stream).writerows(cells)
        with self.assertRaises(SystemExit):
            self.send(source)
        self.assertIn("duplicate column names", self.stderr.getvalue())
        self.assertFalse((self.root / "out").exists())
        self.assert_quiet()

    def test_csv_named_output_is_refused_before_creating_anything(self):
        source = self.reviewed()
        box = self.mbox("mail/Sent", [headers(sender=OWNER, to=ALICE)])
        for suffix in (".csv", ".CSV"):
            for command in ("rank", "send-list", "schedule"):
                with self.subTest(command=command, suffix=suffix):
                    self.clear_console()
                    out = self.root / "uncreated" / ("output" + suffix)
                    args = ["--out", str(out), "--self", OWNER]
                    if command == "rank":
                        args = [str(box)] + args
                    elif command == "send-list":
                        args = [command, str(source)] + args
                    else:
                        args = [command, str(source), "--ledger", "missing.csv",
                                "--start", "2025-01-15 09:00"] + args
                    with self.assertRaises(SystemExit):
                        rank_correspondents.main(args)
                    self.assertIn("--out is a folder; send_list.csv is written inside it", self.stderr.getvalue())
                    self.assertFalse(out.parent.exists())
                    self.assert_quiet()

    def test_legacy_scheduling_options_require_schedule(self):
        source = self.reviewed()
        for flag, value in (("--gap", "30-90"), ("--hours", "9-19"), ("--start", "2025-01-15 09:00")):
            self.clear_console()
            with self.assertRaises(SystemExit):
                self.send(source, [flag, value])
            self.assertIn("use `schedule`", self.stderr.getvalue())
            self.assertFalse((self.root / "out/send_list.csv").exists())
            self.assert_quiet()

    def test_legacy_options_without_self_still_explain_the_new_command(self):
        source = self.reviewed()
        for flag in ("--gap", "--hours", "--start"):
            self.clear_console()
            with self.assertRaises(SystemExit):
                rank_correspondents.send_list_main([str(source), "--out", str(self.root / "out"), flag, "9-19"])
            self.assertIn("use `schedule`", self.stderr.getvalue())
            self.assert_quiet()

    def test_blank_rank_falls_after_numeric_ranks_and_preserves_literal_apostrophes(self):
        source = self.reviewed([self.row(rank="", email=BOB, first_name="''Bob"), self.row(rank="2")])
        _, _, rows = self.send(source)
        self.assertEqual([r["email"] for r in rows], [ALICE, BOB])
        self.assertEqual(rows[1]["first_name"], "''Bob")

    def test_empty_selection_is_rejected_without_output(self):
        with self.assertRaises(SystemExit):
            self.send(self.reviewed([self.row(notify="")]))
        self.assertFalse((self.root / "out/send_list.csv").exists())
        self.assertIn("no rows are marked", self.stderr.getvalue())
        self.assert_quiet()

    def test_self_required_and_io_argparse_errors_are_private(self):
        source = self.reviewed()
        for args in ([str(source)], ["Alice@example.com.csv", "--self", OWNER],
                     [str(source), "--self", OWNER, "--Alice@example.com"]):
            with self.assertRaises(SystemExit):
                rank_correspondents.send_list_main(args + ["--out", str(self.root / "out")])
            self.assert_quiet()

    def test_send_list_guard_git_and_input_collision(self):
        source = self.reviewed()
        self.write("repo/.git", b"gitdir: synthetic\n")
        collision = self.write("collision/send_list.csv", source.read_bytes())
        for source, dst in ((source, self.root / "repo/send_list.csv"), (collision, collision)):
            original = source.read_bytes()
            with self.assertRaises(SystemExit):
                rank_correspondents.send_list_main([str(source), "--out", str(dst.parent), "--self", OWNER])
            self.assertEqual(source.read_bytes(), original)
            self.assert_quiet()


class ScheduleTests(PipelineTestCase):
    def source(self, accounts=(OWNER, SECOND), count=5):
        rows = [{"email": "person{}@example.com".format(i), "first_name": "Person", "last_name": "Example",
                 "name": "Person Example", "account": accounts[i % len(accounts)]} for i in range(count)]
        return self.csv_file("send_list.csv", SEND_FIELDS, rows)

    def ledger(self, source, header=None, rows=None):
        if rows is None:
            rows = [{"email": " " + r["email"].upper() + " ", "share_url": TARGET + "/s/SYNTHETIC{:03d}".format(i)}
                    for i, r in enumerate(self.read_csv(source)[1])]
        path = self.csv_file("invites.csv", ["email", "share_url"], rows)
        header = "# target=" + TARGET + " memorial=synthetic" if header is None else header
        path.write_bytes((header + "\n").encode() + path.read_bytes())
        return path

    def schedule(self, source=None, extra=(), output="out", ledger=None, accounts=(OWNER, SECOND)):
        source = self.source() if source is None else source
        ledger = self.ledger(source) if ledger is None else ledger
        out = self.root / output
        args = ["schedule", str(source), "--ledger", str(ledger), "--out", str(out),
                "--start", "2025-01-15 09:00", "--seed", "7"]
        for account in accounts:
            args += ["--self", account]
        self.assertEqual(rank_correspondents.main(args + list(extra)), 0)
        self.assert_quiet()
        return out

    def times(self, out, filename="send_list_primary.csv"):
        return [dt.datetime.strptime(r["send_at"], "%Y-%m-%d %H:%M")
                for r in self.read_csv(out / filename)[1]]

    def test_per_account_gap_bounds_and_clocks_independent(self):
        src = self.source(count=20)
        out = self.schedule(src)
        times = self.times(out)
        second = self.times(out, "send_list_second.csv")
        self.assertEqual(times[0], dt.datetime(2025, 1, 15, 9))
        self.assertEqual(second[0], times[0])
        self.assertNotEqual(times[1:], second[1:])
        for clock in (times, second):
            for timestamp in clock:
                self.assertGreaterEqual(timestamp.time(), dt.time(9))
                self.assertLessEqual(timestamp.time(), dt.time(19))
            for previous, current in zip(clock, clock[1:]):
                if previous.date() == current.date():
                    self.assertGreaterEqual(current - previous, dt.timedelta(minutes=30))
                    self.assertLessEqual(current - previous, dt.timedelta(minutes=90))
        rows = [r for r in self.read_csv(src)[1] if r["account"] == OWNER]
        solo = self.csv_file("solo.csv", SEND_FIELDS, rows)
        alone = self.schedule(solo, output="alone")
        self.assertEqual(self.times(alone), times)

    def test_seed_uses_account_address_and_send_list_text_is_preserved(self):
        source = self.source(count=8)
        rows = self.read_csv(source)[1]
        rows[0].update(first_name="'Person", name="'Person Example", last_name="Example, Synthetic")
        source = self.csv_file("send_list.csv", SEND_FIELDS, rows)
        out = self.schedule(source)
        self.assertEqual(self.times(out), [dt.datetime(2025, 1, 15, 9), dt.datetime(2025, 1, 15, 10, 3),
            dt.datetime(2025, 1, 15, 11, 25), dt.datetime(2025, 1, 15, 12, 48)])
        self.assertEqual(self.times(out, "send_list_second.csv"), [dt.datetime(2025, 1, 15, 9),
            dt.datetime(2025, 1, 15, 10, 8), dt.datetime(2025, 1, 15, 11, 15), dt.datetime(2025, 1, 15, 12, 33)])
        exported = self.read_csv(out / "send_list_primary.csv")[1][0]
        self.assertEqual({k: exported[k] for k in SEND_FIELDS}, rows[0])

    def test_custom_target_and_normalized_join_on_both_sides(self):
        source = self.source(count=1)
        rows = self.read_csv(source)[1]
        rows[0]["email"] = " PERSON0@EXAMPLE.COM "
        source = self.csv_file("send_list.csv", SEND_FIELDS, rows)
        target = "https://example.com"
        ledger = self.ledger(source, header="# target=" + target + " memorial=synthetic",
            rows=[{"email": " Person0@Example.com ", "share_url": target + "/s/SYNTHETIC000"}])
        out = self.schedule(source, ledger=ledger, extra=("--target", target))
        row = self.read_csv(out / "send_list_primary.csv")[1][0]
        self.assertEqual(row["email"], "person0@example.com")
        self.assertEqual(row["share_url"], target + "/s/SYNTHETIC000")

    def test_required_start_and_exact_now_boundary(self):
        source = self.source(count=1)
        ledger = self.ledger(source)
        args = [str(source), "--ledger", str(ledger), "--out", str(self.root / "out"), "--self", OWNER]
        with self.assertRaises(SystemExit):
            rank_correspondents.schedule_main(args)
        with self.assertRaises(SystemExit):
            rank_correspondents.schedule_main(args + ["--start", "2025-01-15 08:01"])
        self.assertEqual(rank_correspondents.schedule_main(args + ["--start", "2025-01-15 08:02", "--hours", "7-19"]), 0)
        self.assertEqual(self.times(self.root / "out"), [dt.datetime(2025, 1, 15, 8, 2)])
        self.assert_quiet()

    def test_combined_clock_across_rank_order(self):
        out = self.schedule(extra=("--pace", "combined", "--gap", "30"))
        self.assertEqual(self.times(out), [dt.datetime(2025, 1, 15, 9),
            dt.datetime(2025, 1, 15, 10), dt.datetime(2025, 1, 15, 11)])
        self.assertEqual(self.times(out, "send_list_second.csv"),
                         [dt.datetime(2025, 1, 15, 9, 30), dt.datetime(2025, 1, 15, 10, 30)])

    def test_overnight_rollover_to_next_window(self):
        out = self.schedule(self.source((OWNER,), 3), extra=("--gap", "30", "--start", "2025-01-15 18:50"))
        self.assertEqual(self.times(out), [dt.datetime(2025, 1, 15, 18, 50),
                         dt.datetime(2025, 1, 16, 9), dt.datetime(2025, 1, 16, 9, 30)])

    def test_narrow_window_never_exceeded_before_open_or_after_close(self):
        for start in ("2025-01-15 08:30", "2025-01-15 20:00"):
            for seed in range(10):
                out = self.schedule(self.source(count=6), extra=("--start", start, "--hours", "9-9:05", "--seed", str(seed)))
                for filename in ("send_list_primary.csv", "send_list_second.csv"):
                    times = self.times(out, filename)
                    self.assertTrue(all(dt.time(9) <= t.time() <= dt.time(9, 5) for t in times))
                    self.assertTrue(all(a < b for a, b in zip(times, times[1:])))

    def test_small_gap_window_boundary_over_many_seeds(self):
        source = self.source(count=60)
        ledger = self.ledger(source)
        for seed in range(60):
            with self.subTest(seed=seed):
                out = self.schedule(source, ledger=ledger,
                    extra=("--seed", str(seed), "--gap", "1-10", "--hours", "9-10"))
                for filename in ("send_list_primary.csv", "send_list_second.csv"):
                    times = self.times(out, filename)
                    self.assertTrue(any(t.date() > times[0].date() for t in times))
                    for timestamp in times:
                        self.assertGreaterEqual(timestamp.time(), dt.time(9))
                        self.assertLessEqual(timestamp.time(), dt.time(10))
                    for earlier, later in zip(times, times[1:]):
                        self.assertLess(earlier, later)
                        if earlier.date() == later.date():
                            self.assertGreaterEqual(later - earlier, dt.timedelta(minutes=1))
                            self.assertLessEqual(later - earlier, dt.timedelta(minutes=10))

    def test_schedule_errors_use_data_rows_and_missing_url_count(self):
        source = self.source(count=2)
        for bad_field in ("first_name", "account", "email"):
            self.clear_console()
            rows = self.read_csv(source)[1]
            rows[1][bad_field] = ""
            bad = self.csv_file("bad.csv", SEND_FIELDS, rows)
            with self.assertRaises(SystemExit):
                self.schedule(bad, ledger=self.ledger(source))
            self.assertIn("rows 2", self.stderr.getvalue())
            self.assertNotIn("ranks", self.stderr.getvalue())
            self.assert_quiet()
        self.clear_console()
        ledger = self.ledger(source, rows=[])
        with self.assertRaises(SystemExit):
            self.schedule(source, ledger=ledger)
        self.assertIn("rows 1, 2", self.stderr.getvalue())
        self.assertNotIn("ranks", self.stderr.getvalue())
        self.assert_quiet()

    def test_control_characters_are_refused_by_row_before_schedule_writes(self):
        for character in ("\r", "\n", "\u2028"):
            with self.subTest(character=repr(character)):
                source = self.source(count=2)
                ledger = self.ledger(source)
                rows = self.read_csv(source)[1]
                rows[1]["name"] = "Bob" + character + "Sample"
                source = self.csv_file("send_list.csv", SEND_FIELDS, rows)
                out = self.root / "out"
                self.assert_private_refusal(lambda: rank_correspondents.schedule_main([
                    str(source), "--ledger", str(ledger), "--self", OWNER, "--self", SECOND,
                    "--start", "2025-01-15 09:00", "--out", str(out)]))
                self.assertIn("control characters at rows 2", self.stderr.getvalue())
                self.assertFalse(out.exists())

    def test_schedule_secures_output_preserves_parent_and_uses_singular_row(self):
        parent = self.root / "existing"
        parent.mkdir()
        parent.chmod(0o751)
        out = parent / "out"
        out.mkdir()
        out.chmod(0o751)
        self.schedule(self.source(count=1), output="existing/out", extra=("--allow-missing-share-url",),
                      ledger=self.ledger(self.source(count=1), rows=[]))
        self.assertEqual(stat.S_IMODE(out.stat().st_mode), 0o700)
        self.assertEqual(stat.S_IMODE(parent.stat().st_mode), 0o751)
        self.assertIn("1 row ->", self.stdout.getvalue())
        self.assertIn("1 row has empty share_url", self.stdout.getvalue())
        self.assertNotIn("1 rows", self.stdout.getvalue())

    def test_seed_reproducibility_and_generated_seed_recorded(self):
        source = self.source(count=10)
        first = self.schedule(source, output="one")
        same = self.schedule(source, output="same")
        other = self.schedule(source, output="other", extra=("--seed", "8"))
        for filename in ("send_list_primary.csv", "send_list_second.csv"):
            self.assertEqual((first / filename).read_bytes(), (same / filename).read_bytes())
            self.assertNotEqual((first / filename).read_bytes(), (other / filename).read_bytes())
        # The public entry point must draw and log a seed when it is omitted.
        self.assertTrue(hasattr(rank_correspondents, "secrets"))
        with mock.patch.object(rank_correspondents.secrets, "randbits", return_value=123456):
            out = self.root / "generated"
            self.assertEqual(rank_correspondents.main(["schedule", str(source), "--ledger", str(self.ledger(source)),
                "--out", str(out), "--self", OWNER, "--self", SECOND, "--start", "2025-01-15 09:00"]), 0)
        self.assertIn("seed=123456", (out / "schedule.log").read_text())
        replay = self.schedule(source, output="replay", extra=("--seed", "123456"))
        self.assertEqual((out / "send_list_primary.csv").read_bytes(), (replay / "send_list_primary.csv").read_bytes())

    def test_files_permissions_log_and_inputs_untouched(self):
        source = self.source((OWNER, SECOND, "third@example.com"), 6)
        ledger = self.ledger(source)
        before = {p: (p.read_bytes(), p.stat().st_mtime_ns) for p in (source, ledger)}
        out = self.schedule(source, ledger=ledger, accounts=(OWNER, SECOND, "third@example.com"))
        files = {p.name for p in out.iterdir()}
        self.assertEqual(files, {"send_list_primary.csv", "send_list_second.csv", "send_list_account3.csv", "schedule.log"})
        self.assertEqual(stat.S_IMODE(out.stat().st_mode), 0o700)
        for path in out.iterdir():
            self.assertEqual(stat.S_IMODE(path.stat().st_mode), 0o600)
            self.assertFalse(path.read_bytes().startswith(b"\xef\xbb\xbf"))
            if path.suffix == ".csv":
                self.assertNotIn(b"\r", path.read_bytes())
                fields, rows = self.read_csv(path)
                self.assertEqual(fields, SEND_FIELDS + ["share_url", "send_at"])
                self.assertEqual(len(rows), 2)
                self.assertTrue(all(r["share_url"].startswith(TARGET + "/s/") for r in rows))
        for p, expected in before.items():
            self.assertEqual((p.read_bytes(), p.stat().st_mtime_ns), expected)
        log = (out / "schedule.log").read_text()
        self.assertTrue(log.startswith("# timezone="))
        self.assertIn(dt.datetime.now().astimezone().tzname(), log)
        for value in ("seed=7", "start=2025-01-15 09:00", "gap=30-90", "hours=09:00-19:00", "pace=per-account",
                      "primary count=2", "second count=2", "account3 count=2", "first=", "last="):
            self.assertIn(value, log)
        self.assertNotIn("@", log)
        self.schedule(source, ledger=ledger, accounts=(OWNER, SECOND, "third@example.com"))
        self.assertEqual((out / "schedule.log").read_text(), log + log)

    def test_ledger_and_start_refusals_write_nothing(self):
        source = self.source(count=2)
        cases = [
            ("", None, (), "ledger"),
            ("# target=https://example.com memorial=synthetic", None, (), "target"),
            (None, [{"email": "person0@example.com", "share_url": "https://example.com/s/SYNTHETIC"}], (), "row 1"),
            (None, [{"email": "person0@example.com", "share_url": TARGET + ".example.com/s/SYNTHETIC"}], (), "row 1"),
            (None, [], (), "1, 2"),
            (None, None, ("--start", "2025-01-14 09:00"), "past"),
        ]
        for header, rows, extra, message in cases:
            with self.subTest(message=message, header=header):
                self.clear_console()
                ledger = self.ledger(source, header=header, rows=rows)
                with self.assertRaises(SystemExit):
                    self.schedule(source, ledger=ledger, extra=extra)
                self.assertIn(message, self.stderr.getvalue())
                self.assertFalse((self.root / "out").exists())
                self.assert_quiet()

    def test_missing_entries_allowed_only_explicitly_and_invalid_urls_still_refused(self):
        source = self.source(count=2)
        ledger = self.ledger(source, rows=[])
        out = self.schedule(source, ledger=ledger, extra=("--allow-missing-share-url",))
        self.assertEqual(self.read_csv(out / "send_list_primary.csv")[1][0]["share_url"], "")
        self.assertIn("2 rows have empty share_url", self.stdout.getvalue())
        bad = self.ledger(source, rows=[{"email": "unused@example.com", "share_url": "https://example.com/invalid"}])
        with self.assertRaises(SystemExit):
            self.schedule(source, ledger=bad, output="bad", extra=("--allow-missing-share-url",))
        self.assertFalse((self.root / "bad").exists())
        self.assert_quiet()

    def test_missing_ledger_column_header_is_rejected(self):
        source = self.source()
        ledger = self.write("invites.csv", ("# target=" + TARGET + " memorial=synthetic\nwrong,columns\n").encode())
        with self.assertRaises(SystemExit):
            self.schedule(source, ledger=ledger)
        self.assertFalse((self.root / "out").exists())
        self.assert_quiet()

    def test_schedule_io_parser_and_invalid_rows_errors_are_private(self):
        source = self.source(count=1)
        ledger = self.ledger(source)
        for extra in (("--start", "Alice@example.com"), ("--pace", "Bob@example.com"),
                      ("--seed", "Alice@example.com"), ("--ledger", "Alice@example.com.csv"),
                      ("--gap", "0-0"), ("--hours", "20-9")):
            with self.assertRaises(SystemExit):
                self.schedule(source, ledger=ledger, extra=extra)
            self.assert_quiet()
        for field, value in (("account", "unknown@example.com"), ("first_name", ""), ("email", "invalid")):
            rows = self.read_csv(source)[1]
            rows[0][field] = value
            bad = self.csv_file("bad.csv", SEND_FIELDS, rows)
            with self.assertRaises(SystemExit):
                self.schedule(bad, ledger=ledger)
            self.assert_quiet()
        self.assertFalse((self.root / "out").exists())

    def test_permission_failure_is_nonzero_and_private(self):
        source = self.source()
        ledger = self.ledger(source)
        with mock.patch.object(rank_correspondents.os, "fchmod", side_effect=PermissionError("Alice@example.com")):
            with self.assertRaises(SystemExit) as error:
                self.schedule(source, ledger=ledger)
        self.assertEqual(error.exception.code, 2)
        self.assertIn("PermissionError", self.stderr.getvalue())
        self.assert_quiet()

    def test_git_guard_and_output_input_collisions(self):
        source = self.source()
        ledger = self.ledger(source)
        self.write("repo/.git", b"gitdir: synthetic\n")
        with self.assertRaises(SystemExit):
            self.schedule(source, ledger=ledger, output="repo/out")
        original = source.read_bytes()
        collision = self.write("collision/send_list_primary.csv", original)
        with self.assertRaises(SystemExit):
            self.schedule(collision, ledger=ledger, output="collision")
        self.assertEqual(collision.read_bytes(), original)
        self.assert_quiet()


class OutputSafetyTests(PipelineTestCase):
    def setUp(self):
        super().setUp()
        self.box = self.mbox("mail/Sent", [headers(sender="Owner Example <owner@example.com>",
            to="＠Alice Example <alice@example.com>", subject="＝Picnic")])
        rows = [{"rank": str(i + 1), "notify": "y", "email": address,
                 "first_name": first, "last_name": last, "name": first + " " + last,
                 "account": account}
                for i, (address, first, last, account) in enumerate(
                    ((ALICE, "Alice", "Example", OWNER), (BOB, "Bob", "Sample", SECOND)))]
        self.reviewed = self.csv_file("reviewed.csv", ["rank", "notify"] + SEND_FIELDS, rows)
        self.source = self.csv_file("send_list.csv", SEND_FIELDS,
                                    [{k: r[k] for k in SEND_FIELDS} for r in rows])
        self.ledger = self.csv_file("invites.csv", ["email", "share_url"], [
            {"email": address, "share_url": TARGET + "/s/SYNTHETIC00" + str(i)}
            for i, address in enumerate((ALICE, BOB))])
        self.ledger.write_bytes(("# target=" + TARGET + " memorial=synthetic\n").encode()
                               + self.ledger.read_bytes())

    def command(self, command, out, paths=None):
        args = ["--out", str(out), "--self", OWNER, "--self", SECOND]
        if command == "rank":
            args = [str(p) for p in (paths or [self.box])] + args
        elif command == "send-list":
            args = [command, str(self.reviewed)] + args
        else:
            args = [command, str(self.source), "--ledger", str(self.ledger),
                    "--start", "2025-01-15 09:00"] + args
        return rank_correspondents.main(args)

    def seed_outputs(self, command, out):
        names = {"rank": ("correspondents.csv", "mail.sqlite", "evidence/household-names.txt"),
                 "send-list": ("send_list.csv",),
                 "schedule": ("send_list_primary.csv", "send_list_second.csv", "schedule.log")}[command]
        for name in names:
            self.write(str((out / name).relative_to(self.root)), ("previous " + name + "\n").encode())
        return self.snapshot(out)

    def snapshot(self, out):
        return {str(p.relative_to(out)): p.read_bytes() for p in out.rglob("*") if p.is_file()}

    def test_exported_full_width_name_and_subject_are_guarded(self):
        out = self.root / "out"
        self.assertEqual(self.command("rank", out), 0)
        rows = self.read_csv(out / "correspondents.csv")[1]
        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0]["name"], "'＠Alice Example")
        self.assertEqual(rows[0]["names_seen"], "'＠Alice Example")
        self.assertEqual(rows[0]["recent_subjects"], "'＝Picnic")
        self.assert_quiet()

    def test_all_commands_refuse_symlinked_outputs_before_any_write(self):
        names = ("correspondents.csv", "mail.sqlite", "mail.sqlite-journal", "mail.sqlite-wal",
                 "mail.sqlite-shm", "evidence", "evidence/household-names.txt", "send_list.csv",
                 "send_list_primary.csv", "send_list_second.csv", "send_list_account3.csv", "schedule.log")
        for command in ("rank", "send-list", "schedule"):
            for index, name in enumerate(names):
                with self.subTest(command=command, name=name):
                    out = self.root / (command + str(index))
                    out.mkdir()
                    outside = self.root / "outside-repo"
                    outside.mkdir(exist_ok=True)
                    (outside / ".git").mkdir(exist_ok=True)
                    if name == "evidence":
                        target = outside / "directory"
                        target.mkdir(exist_ok=True)
                        (target / "household-names.txt").write_bytes(b"outside evidence\n")
                        target.chmod(0o751)
                    else:
                        target = self.write("outside-repo/target", b"outside content\n")
                        target.chmod(0o640)
                    link = out / name
                    link.parent.mkdir(parents=True, exist_ok=True)
                    link.symlink_to(target, target_is_directory=name == "evidence")
                    before = self.snapshot(outside)
                    mode = target.stat().st_mode
                    entries = {str(p.relative_to(out)) for p in out.rglob("*")}
                    self.assert_private_refusal(lambda: self.command(command, out))
                    self.assertEqual(self.snapshot(outside), before)
                    self.assertEqual(target.stat().st_mode, mode)
                    self.assertTrue(link.is_symlink())
                    self.assertEqual({str(p.relative_to(out)) for p in out.rglob("*")}, entries)

    def test_dangling_output_symlink_is_refused(self):
        for command, name in (("rank", "mail.sqlite"), ("send-list", "send_list.csv"),
                              ("schedule", "schedule.log")):
            with self.subTest(command=command):
                out = self.root / command
                out.mkdir()
                target = self.root / (command + "-missing")
                (out / name).symlink_to(target)
                self.assert_private_refusal(lambda: self.command(command, out))
                self.assertFalse(target.exists())
                self.assertTrue((out / name).is_symlink())

    def test_private_helpers_refuse_symlinks_without_changing_target(self):
        target = self.write("outside-file", b"outside content\n")
        target.chmod(0o640)
        link = self.root / "link"
        link.symlink_to(target)
        with self.assertRaises(OSError):
            with rank_correspondents.open_private(link):
                pass
        self.assertEqual(target.read_bytes(), b"outside content\n")
        self.assertEqual(stat.S_IMODE(target.stat().st_mode), 0o640)
        directory = self.root / "outside-directory"
        directory.mkdir(mode=0o751)
        link.unlink()
        link.symlink_to(directory, target_is_directory=True)
        with self.assertRaises(OSError):
            rank_correspondents.private_directory(link, secure_existing=True)
        self.assertEqual(stat.S_IMODE(directory.stat().st_mode), 0o751)
        self.assert_quiet()

    def test_missing_sources_refuse_before_reading_any_mail(self):
        out = self.root / "out"
        before = self.seed_outputs("rank", out)
        with mock.patch.object(rank_correspondents, "read_source", side_effect=AssertionError("mail read")):
            self.assert_private_refusal(lambda: self.command("rank", out,
                [self.box, self.root / "missing-one", self.root / "missing-two"]))
        self.assertIn("2 mail sources could not be read", self.stderr.getvalue())
        self.assertEqual(self.snapshot(out), before)

    def test_unreadable_mail_sources_refuse_and_preserve_previous_outputs(self):
        for kind in ("mbox", "directory", "eml", "both"):
            with self.subTest(kind=kind):
                out = self.root / ("out-" + kind)
                before = self.seed_outputs("rank", out)
                bad_box = self.mbox("blocked-" + kind + "/Unreadable", [headers()])
                bad_dir = self.root / ("blocked-" + kind) / "subdirectory"
                bad_dir.mkdir()
                self.mbox(str(bad_dir.relative_to(self.root) / "Inbox"), [headers()])
                eml = self.write("blocked-" + kind + "/message.eml", headers())
                blocked = [bad_box, bad_dir] if kind == "both" else [
                    {"mbox": bad_box, "directory": bad_dir, "eml": eml}[kind]]
                modes = {path: stat.S_IMODE(path.stat().st_mode) for path in blocked}
                try:
                    for path in blocked:
                        path.chmod(0)
                    self.assert_private_refusal(lambda: self.command("rank", out, [self.box, bad_box.parent]))
                finally:
                    for path, mode in modes.items():
                        path.chmod(mode)
                count = "2 mail sources" if kind == "both" else "1 mail source"
                self.assertIn(count + " could not be read", self.stderr.getvalue())
                self.assertEqual(self.snapshot(out), before)

    def test_rank_partial_csv_write_preserves_all_previous_outputs(self):
        out = self.root / "out"
        before = self.seed_outputs("rank", out)
        original = csv.writer

        def failing_writer(stream, *args, **kwargs):
            writer = original(stream, *args, **kwargs)

            class PartialWriter:
                def writerow(self, row):
                    writer.writerow(row)
                    if row != rank_correspondents.CSV_COLUMNS:
                        raise csv.Error("Alice@example.com partial write")

            return PartialWriter()

        with mock.patch.object(rank_correspondents.csv, "writer", side_effect=failing_writer):
            self.assert_private_refusal(lambda: self.command("rank", out))
        self.assertEqual(self.snapshot(out), before)

    def test_send_list_partial_write_preserves_previous_output(self):
        out = self.root / "out"
        before = self.seed_outputs("send-list", out)

        def fail_after_row(writer, rows):
            writer.writerow(next(iter(rows)))
            raise csv.Error("Alice@example.com partial write")

        with mock.patch.object(csv.DictWriter, "writerows", fail_after_row):
            self.assert_private_refusal(lambda: self.command("send-list", out))
        self.assertEqual(self.snapshot(out), before)

    def test_second_account_partial_write_preserves_both_files_and_log(self):
        out = self.root / "out"
        before = self.seed_outputs("schedule", out)
        original = csv.DictWriter.writerows
        writes = []

        def fail_second(writer, rows):
            writes.append(1)
            if len(writes) == 2:
                writer.writerow(next(iter(rows)))
                raise csv.Error("Bob@example.com partial write")
            return original(writer, rows)

        with mock.patch.object(csv.DictWriter, "writerows", fail_second):
            self.assert_private_refusal(lambda: self.command("schedule", out))
        self.assertEqual(self.snapshot(out), before)


FULLWIDTH_INFO = "ｉｎｆｏ@example.com"     # ｉｎｆｏ@
SUPERSCRIPT_INFO = "ⁱⁿᶠᵒ@example.com"   # ⁱⁿᶠᵒ@
FULLWIDTH_JOHN = "ｊｏｈｎ@example.com"     # ｊｏｈｎ@ (not a role word)


class LookalikeTests(TempTestCase):
    def test_nfkc_folds_fullwidth_and_superscript_role_addresses(self):
        for address in (FULLWIDTH_INFO, SUPERSCRIPT_INFO, "ｉｎｆｏ+news@example.com"):
            with self.subTest(address=address):
                self.assertEqual(rank_correspondents.canon(address), address)
                self.assertTrue(rank_correspondents.looks_automated(address))
                self.assertTrue(rank_correspondents.has_lookalike(address))
        self.assertFalse(rank_correspondents.looks_automated(FULLWIDTH_JOHN))
        self.assertTrue(rank_correspondents.has_lookalike(FULLWIDTH_JOHN))

    def test_accents_and_ascii_are_not_lookalikes(self):
        for address in (ALICE, "josé@example.com", "josé@example.com", "INFO@example.com"):
            with self.subTest(address=address):
                self.assertFalse(rank_correspondents.has_lookalike(address))

    def test_rank_drops_lookalike_role_sender_and_flags_lookalike_person(self):
        box = self.mbox("mail/Inbox", [
            headers(message_id="spam-1", sender="Eye Health <" + FULLWIDTH_INFO + ">"),
            headers(message_id="spam-2", sender="Eye Health <" + FULLWIDTH_INFO + ">"),
            headers(message_id="john-1", sender="John Fiction <" + FULLWIDTH_JOHN + ">"),
            headers(message_id="john-2", sender="John Fiction <" + FULLWIDTH_JOHN + ">"),
        ])
        out = self.root / "out"
        self.assertEqual(rank_correspondents.rank_main([str(box), "--self", OWNER, "--out", str(out)]), 0)
        with (out / "correspondents.csv").open(encoding="utf-8-sig", newline="") as stream:
            rows = list(csv.DictReader(stream))
        self.assertEqual([r["email"] for r in rows], [FULLWIDTH_JOHN])
        self.assertEqual(rows[0]["flags"], "look-alike address")
        self.assertIn("2 automated messages", self.stdout.getvalue())


class IterMboxTests(TempTestCase):
    def test_offsets_cover_the_file_and_read_mbox_is_unchanged(self):
        one = headers(message_id="one", newline="\r\n")
        two = headers(message_id="two")
        path = self.mbox("mail/Inbox", [one, two, headers(message_id="three")],
                         body=b"body text\n\nFrom this is just prose\nNot a header\n\nend")
        data = path.read_bytes()
        found = list(rank_correspondents.iter_mbox(path))
        self.assertEqual([(h, e) for h, e, _, _ in found], list(rank_correspondents.read_mbox(path)))
        self.assertEqual(found[0][2], 0)
        self.assertEqual(found[-1][3], len(data))
        for (header, _env, start, end), following in zip(found, found[1:] + [None]):
            self.assertTrue(data[start:end].startswith(b"From "))
            self.assertIn(header, data[start:end])
            if following is not None:
                self.assertEqual(end, following[2])

    def test_header_cap_and_envelope_only_message_offsets(self):
        cap = rank_correspondents.MAX_HEADER_LINES
        oversized = b"From: alice@example.com\n" + b"X-Synthetic: value\n" * (cap + 2)
        envelope = b"From owner@example.com Tue Jan  2 12:00:00 2024\n"
        data = envelope + oversized + b"\nbody\n\n" + envelope + envelope + headers(message_id="last")
        path = self.write("mail/Capped", data)
        found = list(rank_correspondents.iter_mbox(path))
        self.assertEqual(len(found), 2)  # an envelope with no header lines is not a message
        self.assertEqual([(h, e) for h, e, _, _ in found], list(rank_correspondents.read_mbox(path)))
        self.assertEqual((found[0][2], found[0][3]), (0, len(envelope) + len(oversized) + len(b"\nbody\n\n")))
        self.assertEqual(found[1][3], len(data))


class PersonScoringTests(TempTestCase):
    def ranking(self, messages, **kwargs):
        box = self.mbox("mail/Inbox", messages)
        conn, _, _, _ = self.database([box])
        return rank_correspondents.rank_from_db(conn, [OWNER], excl=(set(), set()), book={},
                                                min_received=2, half_life=10.0, **kwargs)

    def test_one_message_to_two_aliases_counts_once(self):
        # Before person-level scoring: n = 2 addresses, weight 3 each, she_wrote 2.
        people = self.ranking([headers(sender=OWNER, to="Alice Example <alice@example.com>, "
                                                       "Alice Example <alice-old@example.com>")]).people
        self.assertEqual(len(people), 1)
        alice = people[0]
        self.assertEqual((alice["she_wrote"], alice["she_wrote_direct"], alice["score"]), (1, 1, 4.0))
        self.assertEqual(alice["other_addresses"], "alice-old@example.com (last 2024)")

    def test_sent_weight_counts_distinct_people(self):
        people = self.ranking([headers(sender=OWNER, to="Alice Example <alice@example.com>, "
                                       "Alice Example <alice-old@example.com>, Bob Sample <bob@example.com>")]).people
        # Two people, not three addresses: weight 3 (2-3 recipients) for each.
        self.assertEqual({p["email"]: (p["score"], p["she_wrote"]) for p in people},
                         {ALICE: (3.0, 1), BOB: (3.0, 1)})

    def test_inbound_to_cc_still_counts_addresses(self):
        # NG6: the inbound weight keeps counting To/Cc addresses.
        people = self.ranking([headers(message_id="in-" + str(i), to="Owner Example <owner@example.com>, "
                                       "Alice Example <alice@example.com>, Alice Example <alice-old@example.com>",
                                       sender="Bob Sample <bob@example.com>") for i in range(2)]).people
        self.assertEqual([(p["email"], p["score"]) for p in people], [(BOB, 2.0)])

    def test_rank_main_matches_rank_from_db_on_its_own_database(self):
        mail = self.mbox("mail/Inbox", [
            headers(message_id="out", sender=OWNER, to="Alice Example <alice@example.com>"),
            headers(message_id="in", sender="Bob Sample <bob@example.com>"),
            headers(message_id="in2", sender="Bob Sample <bob@example.com>", subject="Later")])
        out = self.root / "out"
        self.assertEqual(rank_correspondents.rank_main([str(mail), "--self", OWNER, "--out", str(out)]), 0)
        with (out / "correspondents.csv").open(encoding="utf-8-sig", newline="") as stream:
            rows = list(csv.DictReader(stream))
        with contextlib.closing(rank_correspondents.open_readonly_db(out / "mail.sqlite")) as conn:
            people = rank_correspondents.rank_from_db(conn, [OWNER], excl=(set(), set()), book={},
                                                      min_received=2, half_life=10.0).people
        self.assertEqual(rows, [{c: str(rank_correspondents.csv_cell(p[c])) for c in rank_correspondents.CSV_COLUMNS}
                                for p in people])

    def test_primary_rule_order(self):
        old, new = MAIL_TIME - 365 * 86400, MAIL_TIME

        def member(address, sent=None, seen=None):
            stats = rank_correspondents.AddrStats()
            stats.last_sent_ts, stats.last_ts = sent, seen if seen is not None else sent
            return (address, stats, "")

        written, newer = member("alice-old@example.com", sent=old), member(ALICE, seen=new)
        choose = rank_correspondents.choose_primary
        self.assertIs(choose([newer, written]), written)                 # household-sent beats latest seen
        self.assertIs(choose([newer, written], ALICE), newer)            # an override beats both
        role = member("info@example.com", sent=new)
        self.assertIs(choose([role, written]), written)                  # non-automated preferred
        self.assertIs(choose([role, member("support@example.com", seen=new)]), role)
        self.assertIs(choose([member(BOB, seen=old), newer]), newer)     # else latest seen
        self.assertIs(choose([newer, member(BOB, seen=new)]), newer)     # ties keep the given order


class RescoreTests(PipelineTestCase):
    SOURCE_FIELDS = rank_correspondents.CSV_COLUMNS
    IDENTITY_FIELDS = list(rank_correspondents.IDENTITY_CORE) + ["relationship", "suggested_notify",
                                                                 "cleanup_note"]

    def setUp(self):
        super().setUp()
        box = self.mbox("mail/Inbox", [
            headers(message_id="both", sender=OWNER, to="Alice Example <alice@example.com>, "
                                                       "Alice Example <alice-old@example.com>"),
            headers(message_id="old", sender=OWNER, to="alice-old@example.com",
                    date="Mon, 02 Jan 2023 12:00:00 +0000"),
            headers(message_id="in", sender="Alice Example <alice@example.com>"),
            headers(message_id="info", sender="Info Desk <info@example.org>"),
            headers(message_id="bob", sender=OWNER, to="Bob Sample <bob@example.com>"),
        ])
        self.out = self.root / "out"
        self.assertEqual(rank_correspondents.rank_main([str(box), "--self", OWNER, "--out", str(self.out)]), 0)
        self.db = self.out / "mail.sqlite"
        self.source = self.csv_file("in/source.csv", self.SOURCE_FIELDS, [
            self.source_row(1, ALICE, "alice-old@example.com (last 2024)", "Alice", "Example"),
            self.source_row(2, "info@example.org", "", "Info", "Desk"),
            self.source_row(3, BOB, "", "Bob", "Sample"),
            self.source_row(4, "carol@example.com", "", "Carol", "Fiction"),
        ], bom=True)
        self.clear_console()

    def source_row(self, rank, email, others, first, last):
        row = {c: "" for c in self.SOURCE_FIELDS}
        row.update(rank=str(rank), email=email, other_addresses=others, first_name=first,
                   last_name=last, name=first + " " + last, account=OWNER)
        return row

    def identity(self, address, person, first, last, primary="", note=""):
        return {"address": address, "person_id": person, "first_name": first, "last_name": last,
                "display_name": first + " " + last, "primary": primary, "relationship": "friend",
                "suggested_notify": "likely", "cleanup_note": note}

    def identities(self, rows=None):
        rows = rows if rows is not None else [
            self.identity(ALICE, "p-alice", "Alice", "Example"),
            self.identity("alice-old@example.com", "p-alice", "Alice", "Example"),
            self.identity("info@example.org", "p-info", "Info", "Desk", note="=kept by review"),
            self.identity(BOB, "p-bob", "Bobby", "Sample")]
        return self.csv_file("in/identities.csv", self.IDENTITY_FIELDS, rows, bom=True)

    def removed(self, addresses=("carol@example.com",)):
        fields = ["rank", "email", "removed_addresses", "removed_reason", "removed_source", "confidence", "why"]
        return self.csv_file("in/removed.csv", fields, [
            {"rank": "4", "email": a, "removed_addresses": a, "removed_reason": "business_or_vendor",
             "removed_source": "model", "confidence": "high", "why": "synthetic"} for a in addresses])

    def rescore(self, identities=None, removed=None, extra=(), out=None):
        out = out or self.out
        return rank_correspondents.main([
            "rescore", "--db", str(self.db), "--self", OWNER,
            "--identities", str(identities or self.identities()), "--removed", str(removed or self.removed()),
            "--source", str(self.source), "--out", str(out)] + list(extra))

    def cleaned(self, out=None):
        return self.read_csv((out or self.out) / "correspondents_cleaned.csv")

    def test_closed_world_identities_bypass_drops_and_count_once(self):
        before = hashlib.sha256(self.db.read_bytes()).hexdigest()
        source_before = self.source.read_bytes()
        self.assertEqual(self.rescore(), 0)
        fields, rows = self.cleaned()
        self.assertEqual(fields, rank_correspondents.CSV_COLUMNS + ["relationship", "suggested_notify",
                                                                    "cleanup_note"])
        by_email = {r["email"]: r for r in rows}
        # Exactly the identity people: the automated, below-threshold info@ is kept; carol is not.
        self.assertEqual(set(by_email), {ALICE, "info@example.org", BOB})
        alice = by_email[ALICE]
        # Household-sent primary: alice@ was written to on the newest household message.
        self.assertEqual(alice["other_addresses"], "alice-old@example.com (last 2024)")
        self.assertEqual((alice["she_wrote"], alice["she_wrote_direct"], alice["they_wrote"]), ("2", "2", "1"))
        self.assertEqual((by_email[BOB]["first_name"], by_email[BOB]["name"]), ("Bobby", "Bobby Sample"))
        self.assertEqual(by_email["info@example.org"]["cleanup_note"], "'=kept by review")
        self.assertEqual({r["relationship"] for r in rows}, {"friend"})
        self.assertEqual(hashlib.sha256(self.db.read_bytes()).hexdigest(), before)
        self.assertEqual(self.source.read_bytes(), source_before)
        output = self.out / "correspondents_cleaned.csv"
        self.assertTrue(output.read_bytes().startswith(b"\xef\xbb\xbf"))
        self.assertEqual(stat.S_IMODE(output.stat().st_mode), 0o600)
        self.assertIn("Kept 3 people; 0 source rows merged", self.stdout.getvalue())
        self.assertIn("Removed 1 row: business_or_vendor (model).", self.stdout.getvalue())
        self.assert_quiet()
        # The cleaned file is a valid review sheet.
        self.assertEqual(len(rank_correspondents.reviewed_rows(output, marked_only=False)), 3)

    def test_set_primary_override_wins(self):
        rows = [self.identity(ALICE, "p-alice", "Alice", "Example"),
                self.identity("alice-old@example.com", "p-alice", "Alice", "Example", primary="y"),
                self.identity("info@example.org", "p-info", "Info", "Desk"),
                self.identity(BOB, "p-bob", "Bob", "Sample")]
        self.assertEqual(self.rescore(identities=self.identities(rows)), 0)
        emails = {r["email"] for r in self.cleaned()[1]}
        self.assertIn("alice-old@example.com", emails)

    def test_reconciliation_refuses_gap_overlap_and_foreign_addresses(self):
        cases = {
            "gap": (self.identities(), self.removed(addresses=())),
            "overlap": (self.identities(), self.removed(addresses=("carol@example.com", BOB))),
            "foreign": (self.identities([self.identity(a, "p-" + a[0], "X", "Y") for a in (
                ALICE, "alice-old@example.com", "info@example.org", BOB, "dylan@example.com")]),
                self.removed()),
        }
        for name, (identities, removed) in cases.items():
            with self.subTest(case=name):
                self.assert_private_refusal(lambda: self.rescore(identities=identities, removed=removed))
                self.assertIn("do not reconcile", self.stderr.getvalue())
                self.assertFalse((self.out / "correspondents_cleaned.csv").exists())

    def test_excluded_or_household_identity_is_refused(self):
        exclusion = self.write("in/exclude.txt", b"bob@example.com\n")
        self.assert_private_refusal(lambda: self.rescore(extra=("--exclude", str(exclusion))))
        self.assertIn("excluded", self.stderr.getvalue())
        rows = [self.identity(a, "p-1", "Alice", "Example") for a in (ALICE, "alice-old@example.com")]
        rows += [self.identity(a, "p-" + a[0], "X", "Y") for a in ("info@example.org", BOB, OWNER)]
        self.assert_private_refusal(lambda: self.rescore(identities=self.identities(rows)))
        self.assertIn("household", self.stderr.getvalue())
        self.assertFalse((self.out / "correspondents_cleaned.csv").exists())

    def test_inconsistent_identity_rows_and_self_mismatch_are_refused(self):
        rows = [self.identity(ALICE, "p-alice", "Alice", "Example"),
                self.identity("alice-old@example.com", "p-alice", "Alicia", "Example"),
                self.identity("info@example.org", "p-info", "Info", "Desk"),
                self.identity(BOB, "p-bob", "Bob", "Sample")]
        self.assert_private_refusal(lambda: self.rescore(identities=self.identities(rows)))
        self.assertIn("disagree", self.stderr.getvalue())
        self.assert_private_refusal(lambda: rank_correspondents.main([
            "rescore", "--db", str(self.db), "--self", SECOND, "--identities", str(self.identities()),
            "--removed", str(self.removed()), "--source", str(self.source), "--out", str(self.out)]))

    def test_refuses_inside_git_symlinked_output_and_input_collision(self):
        repo = self.root / "repo"
        (repo / ".git").mkdir(parents=True)
        self.assert_private_refusal(lambda: self.rescore(out=repo / "out"))
        self.assertFalse((repo / "out").exists())
        target = self.write("outside", b"outside\n")
        link = self.out / "correspondents_cleaned.csv"
        link.symlink_to(target)
        self.assert_private_refusal(lambda: self.rescore())
        self.assertEqual(target.read_bytes(), b"outside\n")
        link.unlink()
        self.assert_private_refusal(lambda: rank_correspondents.main([
            "rescore", "--db", str(self.db), "--self", OWNER, "--identities", str(self.identities()),
            "--removed", str(self.removed()), "--source", str(self.out / "correspondents_cleaned.csv"),
            "--out", str(self.out)]))

    def test_help_and_missing_arguments_are_private(self):
        with self.assertRaises(SystemExit) as error:
            rank_correspondents.main(["rescore", "--help"])
        self.assertEqual(error.exception.code, 0)
        self.assertIn("--identities", self.stdout.getvalue())
        self.assert_private_refusal(lambda: rank_correspondents.main(["rescore", "--db", "Alice@example.com"]))


class RepeatableExcludeTests(PipelineTestCase):
    def test_every_exclude_file_applies(self):
        box = self.mbox("mail/Sent", [headers(message_id=a, sender=OWNER, to=a)
                                      for a in (ALICE, BOB, "carol@example.com")])
        one = self.write("one.txt", b"alice@example.com\n")
        two = self.write("two.txt", b"@example.com\n# all of them\n")
        three = self.write("three.txt", b"bob@example.com\n")
        out = self.root / "out"
        for files, expected in (([one], {BOB, "carol@example.com"}), ([one, three], {"carol@example.com"}),
                                ([two], set())):
            with self.subTest(files=[f.name for f in files]):
                args = [str(box), "--self", OWNER, "--out", str(out)]
                for path in files:
                    args += ["--exclude", str(path)]
                self.assertEqual(rank_correspondents.rank_main(args), 0)
                self.assertEqual({r["email"] for r in self.read_csv(out / "correspondents.csv")[1]}, expected)


if __name__ == "__main__":
    unittest.main()
