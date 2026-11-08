"""Offline tests for cleanup_correspondents.py: a scripted fake client, no network, no SDK."""

from __future__ import annotations

import contextlib
import csv
import json
import stat
import sys
import threading
import unittest
from types import SimpleNamespace
from unittest import mock

import cleanup_correspondents as cc
import rank_correspondents as rc
from test_rank_correspondents import ALICE, BOB, OWNER, TempTestCase, headers

ENVELOPE = b"From owner@example.com Tue Jan  2 12:00:00 2024\n"
GUIDANCE = """# Synthetic family guidance

The parents lived at a fictional residence.

domains: residence.example.org
- care.example.net
"""


def mbox_bytes(messages):
    """messages: (header bytes, body bytes) pairs."""
    return b"".join(ENVELOPE + h + b"\n" + body + b"\n\n" for h, body in messages)


def default_messages():
    return [
        (headers(message_id="a1", sender=OWNER, to="Alice Example <alice@example.com>"), b"Dear Alice,\nHello."),
        (headers(message_id="a2", sender=OWNER, to="Alice Example <alice@example.com>"), b"Hi again."),
        (headers(message_id="a3", sender="Alice Example <alice@example.com>", to=OWNER),
         b"Hi Owner,\n\nLovely day at the beach.\nSee you soon.\nAlice\n\nOn Tue, Owner wrote:\n> secret quoted"),
        (headers(message_id="b1", sender=OWNER, to="Bob Sample <bob@example.com>"), b"Hi Bob,"),
        (headers(message_id="b2", sender=OWNER, to="Bobby Sample <bsample@example.net>"), b"Hi Bobby,"),
        (headers(message_id="s1", sender="Shop Desk <custserv@shop.example.com>", to=OWNER), b"Your order."),
        (headers(message_id="s2", sender="Shop Desk <custserv@shop.example.com>", to=OWNER), b"Shipped."),
        (headers(message_id="f1", sender="Front Desk <frontdesk@residence.example.org>", to=OWNER), b"Parcel."),
        (headers(message_id="c1", sender=OWNER, to="Carol Fiction <carol@example.com>"), b"Hello Carol,"),
    ]


def person(addresses, keep=True, first="", last="", relationship="friend", notify="likely",
           confidence="high", claims=(), question=None, why="synthetic reason"):
    return {"addresses": list(addresses), "keep": keep, "first_name": first, "last_name": last,
            "display_name": f"{first} {last}".strip(), "relationship": relationship,
            "suggested_notify": notify, "confidence": confidence, "why": why,
            "evidence": [{"message_id": 1, "note": "synthetic note"}],
            "question_for_family": question, "possible_duplicate_ranks": list(claims)}


def answer(*people, escalate=False):
    return {"people": list(people), "escalate": escalate, "escalate_reason": "synthetic" if escalate else None}


def usage(input_tokens=1000, output_tokens=100, write=0, read=0, iterations=None):
    return SimpleNamespace(input_tokens=input_tokens, output_tokens=output_tokens,
                           cache_creation_input_tokens=write, cache_read_input_tokens=read,
                           cache_creation=None, iterations=iterations)


class Block(SimpleNamespace):
    pass


class FakeMessage:
    role = "assistant"

    def __init__(self, content, stop_reason, model, used=None):
        self.content, self.stop_reason, self.model = content, stop_reason, model
        self.usage = used or usage()

    def to_param(self):
        return {"role": "assistant", "content": [dict(vars(b)) for b in self.content]}


def final(value, model=cc.HAIKU_MODEL, used=None, stop="end_turn"):
    text = value if isinstance(value, str) else json.dumps(value)
    return FakeMessage([Block(type="thinking", thinking=""), Block(type="text", text=text)], stop, model, used)


def tool_call(name, model=cc.HAIKU_MODEL, used=None, **arguments):
    return FakeMessage([Block(type="tool_use", id="toolu_" + name, name=name, input=arguments)],
                       "tool_use", model, used)


class FakeRunner:
    def __init__(self, turns, tools, max_iterations):
        self.turns, self.max_iterations = list(turns), max_iterations
        self.tools = {t.name: t for t in tools}
        self.cached = self.last = None
        self.closed = False

    def __iter__(self):
        used = 0
        while self.turns and used < self.max_iterations and not self.closed:
            self.last, self.cached = self.turns.pop(0), None
            used += 1
            yield self.last
            if self.last.stop_reason != "tool_use":
                return
            self.generate_tool_call_response()

    def generate_tool_call_response(self):
        if self.cached is not None:
            return self.cached
        calls = [b for b in self.last.content if b.type == "tool_use"]
        if not calls:
            return None
        self.cached = {"role": "user", "content": [
            {"type": "tool_result", "tool_use_id": b.id, "content": self.tools[b.name].fn(**b.input)}
            for b in calls]}
        return self.cached

    def close(self):
        self.closed = True


class FakeAPIError(Exception):
    pass


class FakeClient:
    """script(payload, params) -> turns for one tool_runner call."""

    def __init__(self, script, counted_tokens=2000):
        self.script, self.counted_tokens = script, counted_tokens
        self.calls, self.counts = [], 0
        self.lock = threading.Lock()
        self.beta = SimpleNamespace(messages=SimpleNamespace(tool_runner=self.tool_runner,
                                                             count_tokens=self.count_tokens))

    def tool_runner(self, *, tools, max_iterations, **params):
        payload = json.loads(params["messages"][0]["content"].split("\n\n", 1)[1])
        with self.lock:
            self.calls.append((payload["task"], payload["cluster"]["ranks"], max_iterations, params))
        return FakeRunner(self.script(payload, params), tools, max_iterations)

    def count_tokens(self, **params):
        with self.lock:
            self.counts += 1
        return SimpleNamespace(input_tokens=self.counted_tokens)


def fake_sdk(client):
    return cc.Sdk(client, lambda spec: spec, (FakeAPIError,), "fake-sdk-1")


class CleanupCase(TempTestCase):
    def setUp(self):
        super().setUp()
        self.out = self.root / "private"
        self.contexts.enter_context(mock.patch.object(cc, "real_sdk", side_effect=AssertionError("network")))
        self.contexts.enter_context(mock.patch.object(cc, "installed_sdk_version", return_value="fake-sdk-1"))
        self.contexts.enter_context(mock.patch.object(cc, "git_head", return_value="test-head"))

    def build(self, messages=None, guidance=GUIDANCE):
        self.box = self.write("mail/Inbox", mbox_bytes(messages or default_messages()))
        self.assertEqual(rc.rank_main([str(self.box), "--self", OWNER, "--min-received", "1",
                                       "--out", str(self.out)]), 0)
        if guidance is not None:
            (self.out / "cleanup-guidance.md").write_text(guidance, encoding="utf-8")
        self.assertEqual(cc.main(["index", str(self.box), "--out", str(self.out)]), 0)
        self.assertEqual(cc.main(["prepare", "--out", str(self.out)]), 0)
        self.paths = cc.Paths(self.out)
        self.rows = cc.load_correspondents(self.paths.correspondents)
        return self.paths

    def rank(self, address):
        return next(r["rank"] for r in self.rows if address in r["addresses"])

    def review(self, script, **options):
        client = FakeClient(script)
        code = cc.run_review(self.paths, cc.ReviewOptions(**options), sdk=fake_sdk(client))
        return code, client

    def apply(self, *extra):
        return cc.main(["apply", "--out", str(self.out)] + list(extra))

    def read(self, path):
        with path.open(encoding="utf-8-sig", newline="") as stream:
            reader = csv.DictReader(stream)
            return reader.fieldnames, list(reader)

    def assert_private_console(self):
        output = self.stdout.getvalue() + self.stderr.getvalue()
        for secret in ("@", "Alice", "Bob", "Carol", "Sample", "Example", "Fiction", "Shop", "Front",
                       "beach", "secret", str(self.root)):
            self.assertNotIn(secret, output)


def default_script(payload, params):
    """Synthetic answers for the default fixture, keyed by the cluster's addresses."""
    addresses = {a for row in payload["cluster"]["rows"] for a in row["addresses"]}
    task = payload["task"]
    model = params["model"]
    if task == "second_review":
        if "frontdesk@residence.example.org" in addresses:
            return [final(answer(person(["frontdesk@residence.example.org"], keep=False, relationship=
                          "staff_where_they_lived", notify="unlikely")), model)]
        return [final(answer(person(sorted(addresses), first="Alice", last="Example")), model)]
    if task == "joint_review":
        return [final(answer(person(sorted(addresses), first="Alice", last="Example")), model)]
    if addresses == {ALICE}:
        return [tool_call("names_used", address=ALICE), tool_call("list_messages", address=ALICE,
                direction="them_to_household", limit=5), final(answer(person([ALICE], first="Alice",
                                                                               last="Example")))]
    if addresses == {BOB, "bsample@example.net"}:
        return [final(answer(person(sorted(addresses), first="Bobby", last="Sample")))]
    if addresses == {"custserv@shop.example.com"}:
        return [final(answer(person(addresses, keep=False, relationship="business_or_vendor",
                                    notify="unlikely")))]
    if addresses == {"frontdesk@residence.example.org"}:
        return [final(answer(person(addresses, keep=False, relationship="staff_where_they_lived",
                                    notify="unlikely", confidence="medium")))]
    if addresses == {"carol@example.com"}:
        return [final(answer(person(addresses, first="Carol", last="Fiction")))]
    raise AssertionError("unexpected cluster")


# ---- prepare --------------------------------------------------------------------------------
def row(rank, first="", last="", addresses=None, name=None, she_wrote="1", direct="0", score="1.0"):
    return {"rank": rank, "first_name": first, "last_name": last,
            "name": name if name is not None else f"{first} {last}".strip(),
            "addresses": addresses or [f"person{rank}@example.com"], "she_wrote": she_wrote,
            "she_wrote_direct": direct, "score": score, "flags": ""}


class PrepareTests(unittest.TestCase):
    def kinds(self, rows, typed=None):
        return {(a, b): kind for a, b, kind in cc.candidate_edges(rows, typed or {})}

    def test_blank_or_one_word_names_never_merge(self):
        rows = [row(1), row(2), row(3, first="Alice"), row(4, first="Alice"), row(5, last="Example"),
                row(6, last="Example"), row(7, first="A", last="Example"), row(8, first="B", last="Example")]
        edges = self.kinds(rows)
        self.assertNotIn((1, 2), edges)
        self.assertNotIn((3, 4), edges)
        self.assertNotIn((5, 6), edges)
        self.assertNotIn((7, 8), edges)  # different initials

    def test_real_exact_names_merge_and_nickname_initial_edges(self):
        rows = [row(1, "Alice", "Example"), row(2, "ALICE", "example"), row(3, "Robert", "Fiction"),
                row(4, "Bob", "Fiction"), row(5, "R.", "Fiction"), row(6, "Mary", "Fiction")]
        edges = self.kinds(rows)
        self.assertEqual(edges[(1, 2)], "exact_name")
        self.assertEqual(edges[(3, 4)], "nickname")
        self.assertEqual(edges[(3, 5)], "initial")
        self.assertNotIn((3, 6), edges)
        self.assertNotIn((4, 6), edges)

    def test_bare_address_edge_needs_last_name_and_an_initial(self):
        rows = [row(1, "Bob", "Melfiction"), row(2, addresses=["melfictionr@example.com"], name="melfictionr"),
                row(3, addresses=["rmelfiction@example.net"]), row(4, addresses=["xmelfiction@example.org"]),
                row(5, "Al", "Fox"), row(6, addresses=["afox@example.com"])]
        edges = self.kinds(rows)
        self.assertEqual(edges[(1, 2)], "bare_address")  # Bob -> Robert's initial r
        self.assertEqual(edges[(1, 3)], "bare_address")
        self.assertNotIn((1, 4), edges)
        self.assertNotIn((5, 6), edges)  # surnames under 4 letters never match

    def test_household_typed_name_edge(self):
        rows = [row(1, "Robert", "Fiction"), row(2, addresses=["rf@example.com"])]
        edges = self.kinds(rows, {"rf@example.com": {"Robert Fiction": 3}})
        self.assertEqual(edges[(1, 2)], "household_typed")

    def test_cap_split_by_first_name_and_singletons(self):
        roberts = [row(i, first, "Sample") for i, first in enumerate(
            ("Robert", "Bob", "Rob", "Bobby", "Robbie", "Robert"), 1)]
        marys = [row(i, "Mary", "Sample") for i in range(7, 11)]
        bridge = row(11, addresses=["rsample@example.com"])
        typed = {"person1@example.com": {"Mary Sample": 1}}
        clusters, counts = cc.build_clusters(roberts + marys + [bridge], typed, [])
        self.assertEqual(sorted(len(c["rows"]) for c in clusters), [1, 4, 6])
        self.assertTrue(all("split from a larger group" in " ".join(c["notes"]) for c in clusters))
        self.assertEqual(counts["oversize components"], 1)
        nine = [row(i, "Ann", "Sample") for i in range(1, 10)]
        clusters, counts = cc.build_clusters(nine, {}, [])
        self.assertEqual(len(clusters), 9)
        self.assertTrue(all(c["notes"] == ["needs_rob: too many possible duplicates to review together"]
                            for c in clusters))

    def test_guidance_domains_and_hints(self):
        self.assertEqual(cc.parse_guidance_domains(GUIDANCE), ["residence.example.org", "care.example.net"])
        self.assertEqual(cc.parse_guidance_domains("**Domains:** `a.example.org`, @b.example.org\n"),
                         ["a.example.org", "b.example.org"])
        hints = cc.cluster_hints([row(1, addresses=["ｉｎｆｏ@example.com",
                                                    "x@desk.residence.example.org"], she_wrote="0")],
                                 ["residence.example.org"])
        self.assertEqual(sorted(h["hint"] for h in hints), [
            "domain listed in the family guidance", "look-alike address", "role or automated address",
            "the household never wrote to this row"])


class PrepareCommandTests(CleanupCase):
    def test_prepare_writes_private_clusters_and_prints_counts_only(self):
        paths = self.build()
        clusters = cc.load_clusters(paths)
        self.assertEqual(sorted(len(c["rows"]) for c in clusters), [1, 1, 1, 1, 2])
        bobs = next(c for c in clusters if len(c["rows"]) == 2)
        self.assertEqual(bobs["edges"][0]["kind"], "nickname")
        self.assertEqual(bobs["cluster_id"], cc.cluster_id(bobs["ranks"]))
        for c in clusters:
            self.assertNotIn("notify", c["rows"][0])
        self.assertEqual(stat.S_IMODE(paths.clusters.stat().st_mode), 0o600)
        self.assertEqual(stat.S_IMODE(paths.offsets.stat().st_mode), 0o600)
        self.assertEqual(stat.S_IMODE(paths.cleanup.stat().st_mode), 0o700)
        self.assertIn("2 guidance domains", self.stdout.getvalue())
        self.assertIn("0 messages of mail.sqlite are not in the index", self.stdout.getvalue())
        self.assert_private_console()

    def test_refuses_output_inside_git_and_symlinked_outputs(self):
        repo = self.root / "repo"
        (repo / ".git").mkdir(parents=True)
        with self.assertRaises(SystemExit):
            cc.main(["prepare", "--out", str(repo / "private")])
        self.assertFalse((repo / "private").exists())
        self.build()
        target = self.write("elsewhere", b"outside\n")
        self.paths.clusters.unlink()
        self.paths.clusters.symlink_to(target)
        with self.assertRaises(SystemExit):
            cc.main(["prepare", "--out", str(self.out)])
        self.assertEqual(target.read_bytes(), b"outside\n")


# ---- snippets and tools -----------------------------------------------------------------------
class SnippetTests(unittest.TestCase):
    def test_quoted_text_and_reply_tails_are_removed(self):
        for tail in ("On Tue, Jan 2, 2024 at 9:00 AM Owner Example wrote:\n> quoted",
                     "On Tue, Jan 2, 2024 at 9:00 AM Owner Example\n<owner@example.com> wrote:\nquoted",
                     "-----Original Message-----\nFrom: x\nquoted",
                     "From: Owner Example\nSent: Tuesday\nTo: Alice\nquoted",
                     "________________________________\nFrom: Owner\nquoted"):
            with self.subTest(tail=tail.split("\n")[0]):
                greeting, snippet = cc.make_snippet("Dear Owner,\n\n> inline quote\nThanks!\n\n" + tail)
                self.assertEqual(greeting, "Dear Owner,")
                self.assertEqual(snippet, "Dear Owner,\nThanks!")

    def test_head_tail_and_character_cap(self):
        text = "\n".join("line %d" % i for i in range(40))
        _, snippet = cc.make_snippet(text)
        lines = snippet.split("\n")
        self.assertEqual(lines[:2], ["line 0", "line 1"])
        self.assertEqual(lines[15], "[...]")
        self.assertEqual(lines[-1], "line 39")
        self.assertEqual(len(lines), 15 + 1 + 8)
        _, long = cc.make_snippet("\n".join("x" * 200 for _ in range(30)))
        self.assertLessEqual(len(long), cc.SNIPPET_CHARS)

    def test_html_body_fallback_drops_quotes_and_styles(self):
        message = (headers(extra=[("Content-Type", "text/html; charset=utf-8"), ("MIME-Version", "1.0")])
                   + b"\n<html><head><style>p{}</style></head><body><p>Hi Owner,</p><p>See you</p>"
                     b"<blockquote>secret quote</blockquote><div class=\"gmail_quote\">old <div>nested</div>"
                     b"</div><p>Alice</p></body></html>")
        text = cc.body_text(message)
        greeting, snippet = cc.make_snippet(text)
        self.assertEqual(greeting, "Hi Owner,")
        self.assertEqual(snippet, "Hi Owner,\nSee you\nAlice")

    def test_plain_part_is_preferred(self):
        message = (headers(extra=[("MIME-Version", "1.0"),
                                  ("Content-Type", 'multipart/alternative; boundary="b"')])
                   + b"\n--b\nContent-Type: text/plain\n\nplain words\n--b\nContent-Type: text/html\n\n"
                     b"<p>html words</p>\n--b--\n")
        self.assertEqual(cc.body_text(message).strip(), "plain words")


class ToolTests(CleanupCase):
    def tools(self, addresses):
        cluster = next(c for c in cc.load_clusters(self.paths)
                       if set(cc.cluster_addresses(c)) == set(addresses))
        tools = cc.AgentTools(cluster, self.paths, cc.people_index(self.rows))
        self.addCleanup(tools.close)
        return tools, {spec.name: spec for spec in tools.specs()}

    def call(self, specs, name, **arguments):
        return json.loads(specs[name].fn(**arguments))

    def test_read_message_snippet_guard_and_cap(self):
        self.build()
        tools, specs = self.tools([ALICE])
        listed = self.call(specs, "list_messages", address=ALICE, direction="them_to_household", limit=5)
        self.assertEqual([m["direction"] for m in listed["items"]], ["them_to_household"])
        mid = listed["items"][0]["message_id"]
        read = self.call(specs, "read_message", message_id=mid)
        self.assertEqual(read["greeting"], "Hi Owner,")
        self.assertNotIn("secret", read["snippet"])
        self.assertIn("Lovely day", read["snippet"])
        with contextlib.closing(rc.open_readonly_db(self.paths.mail)) as conn:
            carol_mid = conn.execute("SELECT m.id FROM messages m JOIN participants p ON p.message_id = m.id "
                                     "WHERE p.addr = 'carol@example.com'").fetchone()[0]
        self.assertIn("not to or from this cluster", self.call(specs, "read_message", message_id=carol_mid)["error"])
        self.assertIn("not in this cluster", self.call(specs, "list_messages", address="carol@example.com",
                                                        direction="any", limit=5)["error"])
        for _ in range(3):
            self.assertIn("snippet", self.call(specs, "read_message", message_id=mid))
        self.assertIn("at most 4", self.call(specs, "read_message", message_id=mid)["error"])
        self.assertEqual(tools.reads, 4)

    def test_read_message_refuses_a_moved_message(self):
        self.build()
        _, specs = self.tools([ALICE])
        mid = self.call(specs, "list_messages", address=ALICE, direction="them_to_household", limit=1)["items"][0][
            "message_id"]
        data = self.box.read_bytes()
        self.box.write_bytes(b"From x Tue Jan  2 12:00:00 2024\nSubject: padding\n\n" + data)
        self.assertIn("changed since it was indexed", self.call(specs, "read_message", message_id=mid)["error"])

    def test_names_search_and_tool_output_budget(self):
        self.build()
        tools, specs = self.tools([ALICE])
        names = self.call(specs, "names_used", address=ALICE)
        self.assertEqual(names["household_typed"], [{"name": "Alice Example", "count": 2}])
        self.assertEqual(names["they_used"], [{"name": "Alice Example", "count": 1}])
        found = self.call(specs, "search_people", query="sample")
        self.assertEqual({p["email"] for p in found["items"]}, {BOB, "bsample@example.net"})
        self.assertIn("error", self.call(specs, "search_people", query="s"))
        tools.used_chars = cc.TOOL_TOTAL_CHARS - 10
        self.assertIn("budget", self.call(specs, "names_used", address=ALICE)["error"])
        self.assertIn("budget", self.call(specs, "names_used", address=ALICE)["error"])

    def test_results_fit_the_per_result_cap(self):
        big = {"items": [{"subject": "x" * 300} for _ in range(20)]}
        text = cc.AgentTools.fit(big)
        self.assertLessEqual(len(text), cc.TOOL_RESULT_CHARS)
        self.assertTrue(json.loads(text)["truncated"])


# ---- answers and escalation -------------------------------------------------------------------
CLUSTER = {"ranks": [1, 2], "rows": [row(1, "Alice", "Example", [ALICE, "alice-old@example.com"], direct="6"),
                                     row(2, "Alice", "Example", ["ae@example.net"])]}
ALL = [ALICE, "alice-old@example.com", "ae@example.net"]


class ValidatorTests(unittest.TestCase):
    def test_coverage_foreign_duplicate_and_first_name(self):
        cases = [
            (answer(person([ALICE], first="Alice")), "missing"),
            (answer(person(ALL + [BOB], first="Alice")), "not in this cluster"),
            (answer(person(ALL, first="Alice"), person([ALICE], first="Alice")), "more than one person"),
            (answer(person(ALL)), "without a first_name"),
            (answer(person(ALL, first="Alice", relationship="pen_pal")), "invalid relationship"),
            ({"people": []}, "non-empty"),
            ("not an object", "non-empty"),
        ]
        for value, message in cases:
            with self.subTest(message=message):
                decision, errors = cc.validate_answer(value, CLUSTER)
                self.assertIsNone(decision)
                self.assertTrue(any(message in e for e in errors), errors)

    def test_normalizes_case_lengths_and_claims(self):
        raw = answer(person([a.upper() for a in ALL], first="Alice", why="w" * 500, claims=[1, 2, 7]))
        raw["people"][0]["confidence"] = "High"
        raw["people"][0]["evidence"] = [{"message_id": i, "note": "n" * 300} for i in range(6)]
        decision, errors = cc.validate_answer(raw, CLUSTER)
        self.assertEqual(errors, [])
        p = decision["people"][0]
        self.assertEqual((p["confidence"], len(p["why"]), len(p["evidence"]), len(p["evidence"][0]["note"])),
                         ("high", cc.WHY_CHARS, cc.EVIDENCE_ITEMS, cc.NOTE_CHARS))
        self.assertEqual(p["addresses"], ALL)
        self.assertEqual(p["possible_duplicate_ranks"], [7])  # own ranks are dropped

    def test_unknown_person_without_name_is_fine_below_high(self):
        decision, errors = cc.validate_answer(answer(person(ALL, confidence="medium",
                                                            question="Who is this?")), CLUSTER)
        self.assertEqual(errors, [])
        self.assertEqual(decision["people"][0]["question_for_family"], "Who is this?")

    def test_output_schema_is_strict_and_within_limits(self):
        def walk(schema):
            if schema.get("type") == "object":
                self.assertIs(schema["additionalProperties"], False)
                self.assertEqual(set(schema["required"]), set(schema["properties"]))
                for value in schema["properties"].values():
                    walk(value)
            if schema.get("type") == "array":
                walk(schema["items"])
            for forbidden in ("maxLength", "minLength", "maxItems", "minimum", "maximum"):
                self.assertNotIn(forbidden, schema)

        walk(cc.OUTPUT_SCHEMA)
        for tool in cc.tool_params():
            walk(tool["input_schema"])
            self.assertIs(tool["strict"], True)
        self.assertEqual([t["name"] for t in cc.tool_params()], sorted(cc.TOOL_SCHEMAS))


class EscalationTests(unittest.TestCase):
    def reasons(self, decision, status="ok", disagree=False):
        return cc.escalation_reasons(CLUSTER, status, decision and cc.validate_answer(decision, CLUSTER)[0],
                                     disagree)

    def test_triggers(self):
        clean = answer(person(ALL, first="Alice"))
        self.assertEqual(self.reasons(clean), [])
        self.assertIn("confidence below high", self.reasons(answer(person(ALL, first="Alice", confidence="medium"))))
        self.assertIn("the first reviewer asked for a second opinion",
                      self.reasons(answer(person(ALL, first="Alice"), escalate=True)))
        self.assertEqual(self.reasons(None, "invalid"), ["the first answer was invalid after a retry"])
        self.assertEqual(self.reasons(None, "refused"), ["the first reviewer declined"])
        row_split = answer(person([ALICE, "ae@example.net"], first="Alice"),
                           person(["alice-old@example.com"], keep=False, relationship="business_or_vendor"))
        self.assertIn("a row or a same-name group was split into two or more people", self.reasons(row_split))
        same_name_split = answer(person([ALICE, "alice-old@example.com"], first="Alice"),
                                 person(["ae@example.net"], first="Alice"))
        self.assertIn("a row or a same-name group was split into two or more people",
                      self.reasons(same_name_split))
        removal = answer(person(ALL, keep=False, relationship="business_or_vendor"))
        self.assertIn("removes someone the household wrote to directly", self.reasons(removal))
        self.assertIn("the clusters reviewed together had disagreeing first answers", self.reasons(clean, disagree=True))
        self.assertEqual(self.reasons(None, "budget"), [])


# ---- pricing and budgets ------------------------------------------------------------------------
class PricingTests(unittest.TestCase):
    def test_iterations_price_each_attempt_at_its_model(self):
        refused = SimpleNamespace(type="message", model=cc.JUDGE_MODEL, input_tokens=1000, output_tokens=0,
                                  cache_creation_input_tokens=0, cache_read_input_tokens=0, cache_creation=None)
        fallback = SimpleNamespace(type="fallback_message", model="claude-opus-5", input_tokens=1000,
                                   output_tokens=100, cache_creation_input_tokens=0, cache_read_input_tokens=0,
                                   cache_creation=None)
        attempts = cc.attempts_from_usage(usage(5, 5, iterations=[refused, fallback]), cc.JUDGE_MODEL)
        self.assertEqual([(a.kind, a.model) for a in attempts],
                         [("message", cc.JUDGE_MODEL), ("fallback_message", "claude-opus-5")])
        costs = [cc.attempt_cost(a) for a in attempts]
        self.assertAlmostEqual(costs[0][0], 1000 * 4.0 / 1e6)
        self.assertEqual(costs[1][1], "table-max")
        self.assertAlmostEqual(costs[1][0], (1000 * cc.TABLE_MAX.input + 100 * cc.TABLE_MAX.output) / 1e6)

    def test_top_level_usage_cache_split_and_long_prompt_card(self):
        cached = usage(1000, 200, write=3000, read=10000)
        cached.cache_creation = SimpleNamespace(ephemeral_1h_input_tokens=1000)
        (attempt,) = cc.attempts_from_usage(cached, cc.HAIKU_MODEL)
        cost, label = cc.attempt_cost(attempt)
        self.assertEqual(label, cc.HAIKU_MODEL)
        self.assertAlmostEqual(cost, (1000 * 0.10 + 2000 * 0.125 + 1000 * 0.20 + 10000 * 0.01 + 200 * 0.50) / 1e6)
        (big,) = cc.attempts_from_usage(usage(150_000, 0), cc.HAIKU_MODEL)
        self.assertAlmostEqual(cc.attempt_cost(big)[0], 150_000 * 0.50 / 1e6)
        (missing,) = cc.attempts_from_usage(SimpleNamespace(input_tokens=None, output_tokens=7), cc.HAIKU_MODEL)
        self.assertEqual((missing.input_tokens, missing.output_tokens, missing.kind), (0, 7, "usage"))

    def test_worst_case_formula(self):
        extra = -(-(cc.TOOL_TOTAL_CHARS + cc.FEEDBACK_CHARS) // 3)
        haiku = sum(2000 + extra + k * 6000 for k in range(6)) * 0.125 + 6 * 6000 * 0.50
        self.assertAlmostEqual(cc.worst_case_cost("haiku", 2000), haiku / 1e6)
        judge = sum(2000 + extra + k * 10000 for k in range(8)) * 12.5 + 8 * 10000 * 50.0
        self.assertAlmostEqual(cc.worst_case_cost("judge", 2000), 2 * judge / 1e6)


class BudgetTests(unittest.TestCase):
    def test_reservations_block_over_cap_starts_under_concurrency(self):
        budget = cc.Budget("haiku", 1.0)
        start, holds = threading.Barrier(12), []

        def take():
            start.wait()
            holds.append(budget.reserve(0.3))

        threads = [threading.Thread(target=take) for _ in range(12)]
        for t in threads:
            t.start()
        for t in threads:
            t.join()
        self.assertEqual(sum(h is not None for h in holds), 3)
        self.assertEqual(budget.refused, 9)
        hold = next(h for h in holds if h)
        hold.charge(0.1)
        hold.settle()
        self.assertAlmostEqual(budget.spent, 0.1)
        self.assertAlmostEqual(budget.reserved, 0.6)
        self.assertIsNotNone(budget.reserve(0.25))
        self.assertIsNone(budget.reserve(0.25))

    def test_charge_beyond_the_reservation_marks_an_overrun(self):
        hold = cc.Budget("judge", 10.0).reserve(1.0)
        hold.charge(0.6)
        self.assertFalse(hold.overrun)
        hold.charge(0.6)
        self.assertTrue(hold.overrun)
        self.assertAlmostEqual(hold.budget.reserved, 0.0)


class JsonlTests(TempTestCase):
    def test_partial_trailing_line_is_dropped_and_repaired(self):
        path = self.write("log.jsonl", b'{"a": 1}\n{"b": 2}\n{"c":')
        entries, partial = cc.read_jsonl(path, repair=False)
        self.assertEqual((entries, partial), ([{"a": 1}, {"b": 2}], 1))
        self.assertTrue(path.read_bytes().endswith(b'{"c":'))
        log = cc.JsonlLog(path)
        self.assertEqual(path.read_bytes(), b'{"a": 1}\n{"b": 2}\n')
        log.append({"d": 4})
        self.assertEqual(cc.read_jsonl(path, repair=False)[0][-1], {"d": 4})
        self.assertEqual(stat.S_IMODE(path.stat().st_mode), 0o600)
        self.write("bad.jsonl", b'{"a": 1}\nnot json\n')
        with self.assertRaises(SystemExit):
            cc.read_jsonl(self.root / "bad.jsonl", repair=False)


# ---- review ------------------------------------------------------------------------------------
class ReviewTests(CleanupCase):
    def test_three_phases_spend_and_resume(self):
        self.build()
        claim = self.rank(ALICE)

        def script(payload, params):
            if payload["task"] == "review_cluster" and payload["cluster"]["ranks"] == [self.rank("carol@example.com")]:
                return [final(answer(person(["carol@example.com"], first="Carol", last="Fiction", claims=[claim])))]
            return default_script(payload, params)

        code, client = self.review(script)
        self.assertEqual(code, 0)
        tasks = [c[0] for c in client.calls]
        self.assertEqual(tasks.count("review_cluster"), 5)
        self.assertEqual(tasks.count("joint_review"), 1)
        # Front desk (medium) and the joint (one-sided claim) go to the judge.
        self.assertEqual(tasks.count("second_review"), 2)
        judge = [c[3] for c in client.calls if c[0] == "second_review"]
        self.assertTrue(all(p["model"] == cc.JUDGE_MODEL and p["fallbacks"] == "default"
                            and p["betas"] == ["server-side-fallback-2026-07-01"] for p in judge))
        haiku = [c[3] for c in client.calls if c[0] != "second_review"]
        self.assertTrue(all(p["model"] == cc.HAIKU_MODEL and "fallbacks" not in p for p in haiku))
        for params in client.calls[0][3], judge[0]:
            self.assertEqual(params["output_config"]["effort"], "medium")
            self.assertEqual(params["output_config"]["format"]["schema"], cc.OUTPUT_SCHEMA)
            self.assertNotIn("temperature", params)
            self.assertEqual(params["system"][0]["cache_control"], {"type": "ephemeral"})
        self.assertEqual(stat.S_IMODE(self.paths.decisions.stat().st_mode), 0o600)
        spend = cc.read_jsonl(self.paths.spend, repair=False)[0]
        self.assertEqual({s["phase"] for s in spend}, {"haiku", "joint", "judge"})
        manifest = json.loads(self.paths.manifest.read_text())
        self.assertEqual((manifest["anthropic"], manifest["git_head"], manifest["prompt_version"]),
                         ("fake-sdk-1", "test-head", cc.PROMPT_VERSION))
        self.assert_private_console()
        # Resume: nothing is bought again.
        code, again = self.review(script)
        self.assertEqual((code, again.calls), (0, []))
        self.assertIn("5 cached", self.stdout.getvalue())

    def test_dry_run_makes_no_call_and_reports_stale_entries_after_a_guidance_edit(self):
        self.build()
        self.review(default_script)
        self.clear()
        code = cc.run_review(self.paths, cc.ReviewOptions(dry_run=True))
        self.assertEqual(code, 0)
        self.assertIn("0 stale decisions", self.stdout.getvalue())
        self.assertIn("haiku: 0 clusters to review, 5 cached", self.stdout.getvalue())
        self.assertIn("No API call was made", self.stdout.getvalue())
        self.paths.guidance.write_text(GUIDANCE + "\nOne more synthetic rule.\n", encoding="utf-8")
        self.clear()
        before = self.paths.decisions.read_bytes()
        cc.run_review(self.paths, cc.ReviewOptions(dry_run=True))
        self.assertIn("haiku: 5 clusters to review, 0 cached", self.stdout.getvalue())
        self.assertRegex(self.stdout.getvalue(), r"[1-9]\d* stale decisions? not reused")
        self.assertEqual(self.paths.decisions.read_bytes(), before)
        self.assert_private_console()

    def clear(self):
        for stream in (self.stdout, self.stderr):
            stream.seek(0)
            stream.truncate()

    def test_validation_retry_continues_the_conversation(self):
        self.build()
        retried = []

        def script(payload, params):
            addresses = sorted({a for r in payload["cluster"]["rows"] for a in r["addresses"]})
            if addresses == [ALICE]:
                if len(params["messages"]) == 1:
                    return [tool_call("names_used", address=ALICE), final(answer(person([], first="Alice")))]
                retried.append(params["messages"])
            return default_script(payload, params)

        self.review(script, phase="haiku")
        self.assertEqual(len(retried), 1)
        roles = [m["role"] for m in retried[0]]
        self.assertEqual(roles, ["user", "assistant", "user", "assistant", "user"])
        self.assertIn("missing", retried[0][-1]["content"])
        entries = cc.read_jsonl(self.paths.decisions, repair=False)[0]
        alice = next(e for e in entries if e["ranks"] == [self.rank(ALICE)])
        self.assertEqual(alice["status"], "ok")
        self.assertEqual(alice["turns"], 2 + 3)
        retry_call = [c for c in self.last_client_calls if c[1] == [self.rank(ALICE)]][1]
        self.assertEqual(retry_call[2], cc.LIMITS["haiku"].max_iterations - 2)

    def review(self, script, **options):  # remembers the client for assertions
        code, client = super().review(script, **options)
        self.last_client_calls = client.calls
        return code, client

    def test_invalid_twice_and_refusal_escalate(self):
        self.build()

        def script(payload, params):
            addresses = {a for r in payload["cluster"]["rows"] for a in r["addresses"]}
            if payload["task"] == "review_cluster" and addresses == {ALICE}:
                return [final("{not json")]
            if payload["task"] == "review_cluster" and addresses == {"carol@example.com"}:
                return [FakeMessage([], "refusal", cc.HAIKU_MODEL)]
            if payload["task"] == "second_review" and addresses == {"carol@example.com"}:
                return [final(answer(person(["carol@example.com"], first="Carol")), cc.JUDGE_MODEL)]
            return default_script(payload, params)

        self.review(script)
        entries = {(e["phase"], tuple(e["ranks"])): e for e in cc.read_jsonl(self.paths.decisions, repair=False)[0]}
        self.assertEqual(entries[("haiku", (self.rank(ALICE),))]["status"], "invalid")
        self.assertEqual(entries[("haiku", (self.rank("carol@example.com"),))]["status"], "refused")
        self.assertEqual(entries[("judge", (self.rank("carol@example.com"),))]["status"], "ok")
        self.assertEqual(entries[("judge", (self.rank(ALICE),))]["status"], "ok")

    def test_budget_refusal_persists_across_restarts_and_is_retried(self):
        self.build()
        self.review(default_script, phase="haiku")
        spent = cc.spent_by_group(cc.read_jsonl(self.paths.spend, repair=False)[0])["haiku"]
        self.assertGreater(spent, 0)
        self.paths.guidance.write_text(GUIDANCE + "\nchanged\n", encoding="utf-8")  # new manifest
        code, client = self.review(default_script, phase="haiku", haiku_budget=spent + 0.01)
        self.assertEqual((code, client.calls), (0, []))  # every reservation is refused
        entries = cc.read_jsonl(self.paths.decisions, repair=False)[0]
        self.assertEqual(sum(e["status"] == "budget" for e in entries), 5)
        self.assertIn("5 runs refused by the cap", self.stdout.getvalue())
        code, client = self.review(default_script, phase="haiku")
        self.assertEqual(len(client.calls), 5)  # budget refusals are not cached

    def test_overrun_stops_the_run_between_turns(self):
        self.build()

        def script(payload, params):
            huge = usage(input_tokens=1_000_000)  # $0.50 on the long-prompt card
            return [tool_call("names_used", used=huge, address=payload["cluster"]["rows"][0]["addresses"][0]),
                    final(answer(person(payload["cluster"]["rows"][0]["addresses"], first="X")))]

        self.review(script, phase="haiku")
        entries = cc.read_jsonl(self.paths.decisions, repair=False)[0]
        self.assertTrue(all(e["status"] == "budget" and e["turns"] == 1 for e in entries))

    def test_first_job_runs_alone_before_the_fan_out(self):
        self.build()
        events, lock = [], threading.Lock()
        original = cc.Reviewer.review

        def recording(reviewer, phase, cluster, payload, key):
            with lock:
                events.append(("start", cluster["cluster_id"]))
            result = original(reviewer, phase, cluster, payload, key)
            with lock:
                events.append(("end", cluster["cluster_id"]))
            return result

        with mock.patch.object(cc.Reviewer, "review", recording):
            self.review(default_script, phase="haiku", concurrency=8)
        self.assertEqual(events[0][0], "start")
        self.assertEqual(events[1], ("end", events[0][1]))
        self.assertEqual(len(events), 10)

    def test_pilot_selection_is_matched_plus_stratified_and_stable(self):
        clusters = [{"cluster_id": "%03d" % i, "ranks": [i], "rows": [row(i, addresses=[f"p{i}@example.com"],
                                                                           score=str(1000 - i))]}
                    for i in range(1, 100)]
        match = ({"p50@example.com"}, {"nowhere.example.org"})
        picked = cc.select_clusters(clusters, "pilot", match)
        self.assertEqual(len(picked), 31)
        self.assertIn("050", {c["cluster_id"] for c in picked})
        ranks = sorted(c["ranks"][0] for c in picked if c["cluster_id"] != "050")
        self.assertEqual([sum(1 for r in ranks if lo <= r < hi) for lo, hi in ((1, 33), (33, 67), (67, 100))],
                         [10, 10, 10])
        self.assertEqual(picked, cc.select_clusters(clusters, "pilot", match))
        self.assertEqual(len(cc.select_clusters(clusters, "all", match)), 99)


# ---- apply ------------------------------------------------------------------------------------
class ApplyTests(CleanupCase):
    def reviewed(self, script=default_script):
        self.build()
        self.review(script)
        self.clear_console()

    def clear_console(self):
        for stream in (self.stdout, self.stderr):
            stream.seek(0)
            stream.truncate()

    def identities(self):
        rows = self.read(self.paths.identities)[1]
        people = {}
        for r in rows:
            people.setdefault(r["person_id"], []).append(r)
        return rows, people

    def overrides(self, *rows):
        fields = ["match", "action", "value", "note"]
        with open(self.paths.overrides, "w", newline="", encoding="utf-8") as f:
            writer = csv.DictWriter(f, fieldnames=fields)
            writer.writeheader()
            for r in rows:
                writer.writerow(dict(zip(fields, r)))

    def rescore(self):
        return rc.main(["rescore", "--db", str(self.paths.mail), "--self", OWNER, "--identities",
                        str(self.paths.identities), "--removed", str(self.paths.removed), "--source",
                        str(self.paths.correspondents), "--out", str(self.out)])

    def test_high_decisions_apply_and_rescore_reconciles(self):
        self.reviewed()
        self.assertEqual(self.apply(), 0)
        rows, people = self.identities()
        by_address = {r["address"]: r for r in rows}
        self.assertEqual(set(by_address), {ALICE, BOB, "bsample@example.net", "carol@example.com"})
        self.assertEqual(by_address[BOB]["person_id"], by_address["bsample@example.net"]["person_id"])
        self.assertEqual(by_address[BOB]["first_name"], "Bobby")
        self.assertEqual(by_address[ALICE]["relationship"], "friend")
        _, removed = self.read(self.paths.removed)
        self.assertEqual({(r["email"], r["removed_reason"], r["removed_source"]) for r in removed},
                         {("custserv@shop.example.com", "business_or_vendor", "model"),
                          ("frontdesk@residence.example.org", "staff_where_they_lived", "judge")})
        self.assertEqual(len(rc.reviewed_rows(self.paths.removed, marked_only=False)), 2)
        _, changes = self.read(self.paths.changes)
        self.assertIn(("merge", "applied"), {(c["kind"], c["status"]) for c in changes})
        for path in (self.paths.identities, self.paths.removed, self.paths.changes):
            self.assertEqual(stat.S_IMODE(path.stat().st_mode), 0o600)
        self.assert_private_console()
        self.assertEqual(self.rescore(), 0)
        cleaned = self.read(self.out / "correspondents_cleaned.csv")[1]
        self.assertEqual(len(cleaned), 3)
        self.assertEqual(len(rc.reviewed_rows(self.out / "correspondents_cleaned.csv", marked_only=False)), 3)

    def test_only_high_is_applied_and_needs_rob_keeps_the_harvest(self):
        def script(payload, params):
            addresses = {a for r in payload["cluster"]["rows"] for a in r["addresses"]}
            if addresses == {"frontdesk@residence.example.org"}:
                return [final(answer(person(addresses, keep=False, relationship="staff_where_they_lived",
                                            notify="unlikely", confidence="medium",
                                            question="Staff or a neighbour?")),
                              params["model"])]
            return default_script(payload, params)

        self.reviewed(script)
        self.assertEqual(self.apply(), 0)
        rows, _ = self.identities()
        desk = next(r for r in rows if r["address"] == "frontdesk@residence.example.org")
        self.assertEqual((desk["first_name"], desk["cleanup_note"]), ("Front", "review: Staff or a neighbour?"))
        self.assertEqual((desk["relationship"], desk["suggested_notify"]), ("staff_where_they_lived", "unlikely"))
        _, changes = self.read(self.paths.changes)
        self.assertIn("needs_rob", {c["kind"] for c in changes})

    def test_unreviewed_apply_keeps_everything_and_flags_missing_names(self):
        self.build(default_messages() + [(headers(message_id="n1", sender=OWNER, to="zz9@example.com"), b"x")])
        self.assertEqual(self.apply(), 0)
        rows, people = self.identities()
        self.assertEqual(len(people), 7)
        nameless = next(r for r in rows if r["address"] == "zz9@example.com")
        self.assertEqual(nameless["cleanup_note"], "review: first name missing")
        self.assertIn("No review manifest yet", self.stdout.getvalue())

    def test_overrides_win(self):
        self.reviewed()
        self.overrides((ALICE, "remove", "", "synthetic removal"),
                       ("custserv@shop.example.com", "keep", "", "a friend after all"),
                       ("carol@example.com", "merge_with", BOB, ""),
                       (BOB, "set_name", "Robert|Sample", ""),
                       ("carol@example.com", "set_primary", "", ""))
        self.assertEqual(self.apply(), 0)
        rows, people = self.identities()
        by_address = {r["address"]: r for r in rows}
        self.assertNotIn(ALICE, by_address)
        self.assertIn("custserv@shop.example.com", by_address)
        self.assertEqual(by_address["carol@example.com"]["person_id"], by_address[BOB]["person_id"])
        self.assertEqual({r["first_name"] for r in people[by_address[BOB]["person_id"]]}, {"Robert"})
        self.assertEqual(by_address["carol@example.com"]["primary"], "y")
        _, removed = self.read(self.paths.removed)
        self.assertIn((ALICE, "override", "override"), {(r["email"], r["removed_reason"], r["removed_source"])
                                                        for r in removed})
        self.assertEqual(self.apply("--no-overrides"), 0)
        self.assertIn(ALICE, {r["address"] for r in self.identities()[0]})
        self.assertEqual(self.rescore(), 0)

    def test_refusals_leave_previous_outputs(self):
        self.reviewed()
        self.assertEqual(self.apply(), 0)
        before = {p: p.read_bytes() for p in (self.paths.identities, self.paths.removed, self.paths.changes)}
        self.overrides(("nobody@example.com", "remove", "", ""))
        with self.assertRaises(SystemExit):
            self.apply()
        self.assertIn("matched no address", self.stderr.getvalue())
        self.overrides()
        self.write("private/exclude.txt", b"carol@example.com\n")
        with self.assertRaises(SystemExit):
            self.apply()
        self.assertIn("excluded", self.stderr.getvalue())
        (self.out / "exclude.txt").unlink()
        original = rc.write_people_csv
        calls = []

        def failing(path, people, columns):
            calls.append(path)
            if len(calls) == 2:
                raise OSError("synthetic Alice@example.com failure")
            return original(path, people, columns)

        with mock.patch.object(rc, "write_people_csv", side_effect=failing):
            with self.assertRaises(SystemExit):
                self.apply()
        self.assertEqual({p: p.read_bytes() for p in before}, before)
        self.assertNotIn("Alice", self.stderr.getvalue())

    def test_partition_validation(self):
        rows = [row(1, "A", "B", ["a@example.com", "b@example.com"])]
        cases = {
            "missing": ([cc.Person(["a@example.com"], "A", "B", "A B")], []),
            "doubled": ([cc.Person(["a@example.com", "b@example.com"], "A", "B", "A B")],
                        [cc.Removal(["b@example.com"], "automated", "model", "high", "")]),
            "foreign": ([cc.Person(["a@example.com", "b@example.com", "c@example.com"], "A", "B", "A B")], []),
            "household": ([cc.Person(["a@example.com", "b@example.com"], "A", "B", "A B")], []),
        }
        for name, (people, removals) in cases.items():
            with self.subTest(case=name):
                with self.assertRaises(SystemExit):
                    cc.validate_partition(rows, people, removals, (set(), set()),
                                          {"a@example.com"} if name == "household" else set())

    def test_inputs_changed_since_review_are_refused(self):
        self.reviewed()
        self.write("private/correspondents.csv", self.paths.correspondents.read_bytes() + b"\n")
        with self.assertRaises(SystemExit):
            self.apply()
        self.assertIn("changed since the last review", self.stderr.getvalue())

    def test_joint_decision_supersedes_member_decisions(self):
        def script(payload, params):
            if payload["task"] == "review_cluster" and payload["cluster"]["rows"][0]["addresses"] == ["carol@example.com"]:
                return [final(answer(person(["carol@example.com"], first="Carol", last="Fiction",
                                            claims=[self.rank(ALICE)])))]
            return default_script(payload, params)

        self.build()
        self.review(script)
        self.assertEqual(self.apply(), 0)
        rows, _ = self.identities()
        by_address = {r["address"]: r for r in rows}
        self.assertEqual(by_address["carol@example.com"]["person_id"], by_address[ALICE]["person_id"])
        self.assertEqual(by_address["carol@example.com"]["first_name"], "Alice")


class MoreReviewTests(CleanupCase):
    def test_dry_run_reports_a_missing_index_but_a_real_review_refuses(self):
        self.build()
        self.paths.offsets.unlink()
        self.assertEqual(cc.run_review(self.paths, cc.ReviewOptions(dry_run=True)), 0)
        self.assertIn("offsets.sqlite is missing", self.stdout.getvalue())
        self.assertIn("A judge run reserves up to about $", self.stdout.getvalue())
        with self.assertRaises(SystemExit):
            self.review(default_script)
        self.assertIn("run index first", self.stderr.getvalue())

    def test_judge_refused_by_its_cap_leaves_the_cluster_for_rob(self):
        self.build()
        code, client = self.review(default_script, judge_budget=1.0)
        self.assertEqual(code, 0)
        self.assertNotIn("second_review", [c[0] for c in client.calls])
        self.assertEqual(cc.main(["apply", "--out", str(self.out)]), 0)
        _, identities = self.read(self.paths.identities)
        desk = next(r for r in identities if r["address"] == "frontdesk@residence.example.org")
        self.assertTrue(desk["cleanup_note"].startswith("review: second review budget"))
        _, removed = self.read(self.paths.removed)
        self.assertEqual([r["email"] for r in removed], ["custserv@shop.example.com"])

    def test_list_messages_marks_third_party_messages(self):
        messages = default_messages() + [(headers(message_id="t1", sender="Dylan Pretend <dylan@example.com>",
                                                  to="Owner Example <owner@example.com>, alice@example.com"), b"x")]
        self.build(messages)
        cluster = next(c for c in cc.load_clusters(self.paths) if cc.cluster_addresses(c) == [ALICE])
        tools = cc.AgentTools(cluster, self.paths, [])
        self.addCleanup(tools.close)
        listed = json.loads(next(s for s in tools.specs() if s.name == "list_messages").fn(
            address=ALICE, direction="any", limit=20))
        self.assertIn("third_party", [m["direction"] for m in listed["items"]])
        third = next(m for m in listed["items"] if m["direction"] == "third_party")
        self.assertEqual(third["co_participants"], ["Dylan Pretend"])


class IndexTests(CleanupCase):
    def test_maildir_and_eml_sources_are_indexed_by_file(self):
        one = headers(message_id="md1", sender="Alice Example <alice@example.com>", to=OWNER)
        two = headers(message_id="eml1", sender=OWNER, to="Bob Sample <bob@example.com>")
        maildir = self.root / "mail/Maildir"
        for sub in ("cur", "new", "tmp"):
            (maildir / sub).mkdir(parents=True)
        self.write("mail/Maildir/cur/one", one + b"\nDear Owner,\nThanks.\n")
        eml = self.write("mail/Archive/two.eml", two + b"\nHi Bob,\nSee you.\n")
        self.assertEqual(rc.rank_main([str(self.root / "mail"), "--self", OWNER, "--min-received", "1",
                                       "--out", str(self.out)]), 0)
        self.assertEqual(cc.main(["index", str(self.root / "mail"), "--out", str(self.out)]), 0)
        with contextlib.closing(rc.open_readonly_db(cc.Paths(self.out).offsets)) as conn:
            found = dict((k, (p, s, e)) for k, p, s, e in conn.execute("SELECT * FROM offsets"))
        self.assertEqual(found["mid:eml1@example.com"], (str(eml), 0, eml.stat().st_size))
        key, data = cc.read_indexed(*found["mid:md1@example.com"])
        self.assertEqual(key, "mid:md1@example.com")
        self.assertEqual(cc.make_snippet(cc.body_text(data)), ("Dear Owner,", "Dear Owner,\nThanks."))
        self.assertIn("0 messages of mail.sqlite are not in the index", self.stdout.getvalue())
        self.assert_private_console()

    def test_index_skips_junk_drafts_and_deleted_copies_like_the_harvester(self):
        keep = headers(message_id="keep")
        self.write("mail/Inbox", mbox_bytes([(headers(message_id="gone", extra=[("X-Mozilla-Status", "0008")]),
                                              b"x"), (keep, b"y")]))
        self.write("mail/Junk", mbox_bytes([(headers(message_id="junk"), b"z")]))
        self.write("mail/Drafts", mbox_bytes([(headers(message_id="draft"), b"z")]))
        (self.out / "cleanup").mkdir(parents=True)
        self.assertEqual(cc.main(["index", str(self.root / "mail"), "--out", str(self.out)]), 0)
        with contextlib.closing(rc.open_readonly_db(cc.Paths(self.out).offsets)) as conn:
            keys = {k for (k,) in conn.execute("SELECT msg_key FROM offsets")}
        self.assertEqual(keys, {"mid:keep@example.com"})
        self.assertIn("Indexed 1 message from 4 headers read.", self.stdout.getvalue())


class SpendCommandTests(CleanupCase):
    def test_spend_prints_totals_only(self):
        self.build()
        self.review(default_script)
        self.assertEqual(cc.main(["spend", "--out", str(self.out)]), 0)
        self.assertIn("haiku claude-haiku-5-5: $", self.stdout.getvalue())
        self.assertIn("judge claude-opus-5-5: $", self.stdout.getvalue())
        self.assert_private_console()


class NoSdkTests(unittest.TestCase):
    def test_module_imports_without_the_sdk(self):
        self.assertNotIn("anthropic", sys.modules)


if __name__ == "__main__":
    unittest.main()
