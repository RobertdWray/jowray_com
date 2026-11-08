"""Offline characterization of the committed harvester, before P2 changes it."""

from __future__ import annotations

import contextlib
import csv
import datetime as dt
import email.utils
import hashlib
import io
import os
from pathlib import Path
import random
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
        self.assertEqual(rank_correspondents.first_name_of("Alice Example, Jr."), "Jr")

    def test_csv_formula_guard(self):
        for prefix in ("=", "+", "@", "\t", "\r"):
            with self.subTest(prefix=prefix):
                self.assertEqual(rank_correspondents.csv_cell(prefix + "Example"),
                                 "'" + prefix + "Example")
        # baseline behaviour (P1 pin); P2 may change
        self.assertEqual(rank_correspondents.csv_cell("-Example"), "-Example")
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
        self.assertIsNone(rank_correspondents.sniff(source / "missing"))
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


class ScoringTests(TempTestCase):
    def score(self, messages, ref_ts=MAIL_TIME, half_life=10.0):
        box = self.mbox("mail/Inbox", messages)
        conn, _, _, _ = self.database([box])
        return rank_correspondents.score_addresses(conn, {OWNER}, half_life, ref_ts)

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
        stats, _ = rank_correspondents.score_addresses(conn, {OWNER}, 10, MAIL_TIME)
        self.assertEqual(stats[ALICE].recv_score, 0.75)
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
        stats, _ = self.score([headers(message_id="in"),
                              headers(message_id="out", sender=OWNER,
                                      to="Alice Example <alice@example.com>")])
        self.assertEqual((stats[ALICE].sent_score, stats[ALICE].recv_score), (4.0, 1.5))
        people, dropped, _ = rank_correspondents.build_people(
            stats, {}, (set(), set()), {OWNER}, set(), set(), 2)
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
        stats, _ = rank_correspondents.score_addresses(conn, {OWNER}, 10, MAIL_TIME)
        self.assertEqual((stats[ALICE].she_wrote, stats[ALICE].they_wrote), (1, 1))
        self.assertEqual((stats[ALICE].sent_score, stats[ALICE].recv_score), (4.0, 1.5))


class PeopleTests(TempTestCase):
    def stats(self, address, name="", sent=0, received=0, timestamp=MAIL_TIME, subject="A picnic"):
        value = rank_correspondents.AddrStats()
        value.she_wrote = value.she_wrote_direct = sent
        value.they_wrote = received
        value.sent_score = 4.0 * sent
        value.recv_score = 1.5 * received
        value.touch(timestamp, address, name, subject)
        return value

    def people(self, stats, book=None, excluded=None, own_keys=None, lists=None, min_received=2):
        return rank_correspondents.build_people(stats, book or {}, excluded or (set(), set()),
                                                {OWNER}, own_keys or set(), lists or set(),
                                                min_received)

    def test_full_name_grouping_uses_latest_address_and_aggregates(self):
        older = dt.datetime(2020, 1, 2, 12, tzinfo=dt.timezone.utc).timestamp()
        stats = {
            "alice-old@example.com": self.stats("alice-old@example.com", "Example, Alice A.",
                                                 sent=1, timestamp=older, subject="Re: A picnic"),
            ALICE: self.stats(ALICE, "Dr. Alice Example", received=1, subject="A picnic"),
            BOB: self.stats(BOB, "Bob Sample", sent=1),
        }
        people, dropped, own = self.people(stats)
        self.assertEqual([p["send_to"] for p in people], [ALICE, BOB])
        alice = people[0]
        self.assertEqual((alice["she_wrote"], alice["they_wrote"], alice["score"]), (1, 1, 6.9))
        self.assertEqual((alice["first_year"], alice["last_year"], alice["years_active"]), (2020, 2024, 2))
        self.assertEqual(alice["other_addresses"], "alice-old@example.com (last 2020)")
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
            self.assertEqual(reader.fieldnames, ["rank", "notify", "name", "first_name", "send_to",
                "score", "she_wrote", "she_wrote_direct", "they_wrote", "first_year", "last_year",
                "years_active", "other_addresses", "names_seen", "recent_subjects", "flags"])
            rows = list(reader)
        self.assertEqual(len(rows), 4)
        self.assertEqual([r["rank"] for r in rows], ["1", "2", "3", "4"])
        self.assertEqual(rows[0]["send_to"], ALICE)
        self.assertEqual(rows[0]["score"], "6.9")
        for row in rows:
            name = names[row["send_to"]]
            # baseline behaviour (P1 pin); P2 may change: leading '-' is not guarded.
            prefix = "" if name.startswith("-") else "'"
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
            self.assertEqual(dict(conn.execute("SELECT send_to, name FROM people")), names)
        self.assertIn("RemoteOnly", self.stderr.getvalue())
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
                    self.assertEqual({r["send_to"] for r in csv.DictReader(stream)}, expected)
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


class SendListTests(TempTestCase):
    def setUp(self):
        super().setUp()
        # send-list uses datetime.now(), not the module's NOW timestamp.
        self.contexts.enter_context(mock.patch.object(rank_correspondents.dt, "datetime", FrozenDateTime))

    def reviewed(self, rows=None, count=5):
        if rows is None:
            rows = [{"rank": i + 1, "notify": "y", "send_to": "person{}@example.com".format(i),
                     "first_name": "Person", "name": "Person Example"} for i in range(count)]
        stream = io.StringIO(newline="")
        writer = csv.DictWriter(stream, fieldnames=["rank", "notify", "send_to", "first_name", "name"])
        writer.writeheader()
        writer.writerows(rows)
        return self.write("reviewed.csv", stream.getvalue().encode("utf-8-sig"))

    def send(self, source, args=(), output="send.csv"):
        destination = self.root / output
        self.assertEqual(rank_correspondents.send_list_main(
            [str(source), "--out", str(destination)] + list(args)), 0)
        with destination.open(encoding="utf-8", newline="") as stream:
            reader = csv.DictReader(stream)
            fields, rows = reader.fieldnames, list(reader)
        return destination, fields, rows

    def times(self, rows):
        return [dt.datetime.strptime(row["send_at"], "%Y-%m-%d %H:%M") for row in rows]

    def test_plain_list_rank_order_dedupe_and_no_bom(self):
        source = self.reviewed([
            {"rank": "3", "notify": "yes", "send_to": "carol@example.com", "first_name": "Carol", "name": "Carol Fiction"},
            {"rank": "2", "notify": "x", "send_to": BOB, "first_name": "Bob", "name": "Bob Sample"},
            {"rank": "1", "notify": " Y ", "send_to": "'ALICE@EXAMPLE.COM", "first_name": "Alice", "name": "Alice Example"},
            {"rank": "4", "notify": "true", "send_to": ALICE, "first_name": "Duplicate", "name": "Duplicate Example"},
            {"rank": "", "notify": "1", "send_to": "dylan@example.com", "first_name": "Dylan", "name": "Dylan Pretend"},
            {"rank": "0", "notify": "no", "send_to": "eve@example.com", "first_name": "Eve", "name": "Eve Fiction"},
        ])
        original = source.read_bytes()
        destination, fields, rows = self.send(source)
        self.assertEqual(fields, ["email", "first_name", "name"])
        self.assertEqual([row["email"] for row in rows],
                         ["ALICE@EXAMPLE.COM", BOB, "carol@example.com", "dylan@example.com"])
        self.assertEqual([row["first_name"] for row in rows], ["Alice", "Bob", "Carol", "Dylan"])
        self.assertFalse(destination.read_bytes().startswith(b"\xef\xbb\xbf"))
        self.assertEqual(stat.S_IMODE(destination.stat().st_mode), 0o600)
        self.assertEqual(source.read_bytes(), original)
        self.assertEqual(self.stderr.getvalue(), "")

    def test_bad_addresses_are_skipped_and_missing_first_name_warns(self):
        source = self.reviewed([
            {"rank": "1", "notify": "y", "send_to": "invalid", "name": "Invalid Example"},
            {"rank": "2", "notify": "y", "send_to": ALICE, "name": "Alice Example"},
        ])
        _, _, rows = self.send(source)
        self.assertEqual(rows, [{"email": ALICE, "first_name": "", "name": "Alice Example"}])
        self.assertIn("not a valid address", self.stderr.getvalue())
        self.assertIn("no first_name for 1", self.stderr.getvalue())

    def test_hours_and_gap_bounds_within_one_day(self):
        _, fields, rows = self.send(self.reviewed(),
            ["--gap", "30-90", "--hours", "9-19", "--start", "2025-01-15 09:00", "--seed", "7"])
        self.assertEqual(fields, ["email", "first_name", "name", "send_at"])
        times = self.times(rows)
        self.assertEqual(times[0], dt.datetime(2025, 1, 15, 9))
        self.assertEqual(len(times), 5)
        for timestamp in times:
            self.assertEqual(timestamp.date(), times[0].date())
            self.assertGreaterEqual(timestamp.time(), dt.time(9))
            self.assertLessEqual(timestamp.time(), dt.time(19))
        for previous, current in zip(times, times[1:]):
            gap = (current - previous).total_seconds() / 60
            self.assertGreaterEqual(gap, 30)
            self.assertLessEqual(gap, 90)

    def test_overnight_rollover_to_next_window(self):
        _, _, rows = self.send(self.reviewed(count=3),
            ["--gap", "30", "--hours", "9-19", "--start", "2025-01-15 18:50", "--seed", "7"])
        first, second, third = self.times(rows)
        self.assertEqual(first, dt.datetime(2025, 1, 15, 18, 50))
        self.assertEqual(second.date(), dt.date(2025, 1, 16))
        self.assertGreaterEqual(second.time(), dt.time(9))
        self.assertLessEqual(second.time(), dt.time(9, 15))
        self.assertEqual(third - second, dt.timedelta(minutes=30))

    def test_start_outside_hours_moves_to_opening_with_jitter(self):
        source = self.reviewed(count=1)
        for start, expected_day in (("2025-01-16 08:00", dt.date(2025, 1, 16)),
                                    ("2025-01-15 20:00", dt.date(2025, 1, 16))):
            with self.subTest(start=start):
                _, _, rows = self.send(source, ["--gap", "30-90", "--hours", "9-19",
                                                "--start", start, "--seed", "11"])
                timestamp = self.times(rows)[0]
                self.assertEqual(timestamp.date(), expected_day)
                self.assertGreaterEqual(timestamp.time(), dt.time(9))
                self.assertLessEqual(timestamp.time(), dt.time(9, 15))

    def test_seed_reproducibility(self):
        source = self.reviewed(count=10)
        args = ["--gap", "30-90", "--hours", "9-19", "--start", "2025-01-15 09:00"]
        one, _, _ = self.send(source, args + ["--seed", "42"], "one.csv")
        two, _, _ = self.send(source, args + ["--seed", "42"], "two.csv")
        other, _, _ = self.send(source, args + ["--seed", "43"], "other.csv")
        self.assertEqual(one.read_bytes(), two.read_bytes())
        self.assertNotEqual(one.read_bytes(), other.read_bytes())

    def test_default_start_uses_frozen_clock_and_five_minute_rounding(self):
        _, _, rows = self.send(self.reviewed(count=1),
                               ["--gap", "30-90", "--hours", "7-19", "--seed", "1"])
        self.assertEqual(rows[0]["send_at"], "2025-01-15 08:35")

    def test_past_or_current_start_is_rejected_without_output(self):
        source = self.reviewed(count=1)
        destination = self.root / "send.csv"
        for start in ("2025-01-14 09:00", "2025-01-15 08:02"):
            with self.subTest(start=start):
                with self.assertRaises(SystemExit) as error:
                    rank_correspondents.send_list_main([str(source), "--out", str(destination),
                                                        "--gap", "30-90", "--start", start])
                self.assertEqual(error.exception.code, 2)
                self.assertFalse(destination.exists())
        self.assertIn("--start is in the past", self.stderr.getvalue())

    def test_narrow_window_opening_jitter_can_exceed_close_baseline(self):
        # baseline behaviour (P1 pin); P2 may change
        times = rank_correspondents.make_schedule(1, dt.datetime(2025, 1, 16, 8), 30, 90,
                                                  dt.time(9), dt.time(9, 5), random.Random(0))
        self.assertEqual(times, [dt.datetime(2025, 1, 16, 9, 12)])

    def test_empty_selection_is_rejected_without_output(self):
        source = self.reviewed([{"rank": "1", "notify": "", "send_to": ALICE}])
        destination = self.root / "send.csv"
        with self.assertRaises(SystemExit) as error:
            rank_correspondents.send_list_main([str(source), "--out", str(destination)])
        self.assertEqual(error.exception.code, 2)
        self.assertFalse(destination.exists())
        self.assertIn("no rows are marked y", self.stderr.getvalue())


if __name__ == "__main__":
    unittest.main()
