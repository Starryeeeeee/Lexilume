"""学情分析与难度阶梯测试。分档阈值必须和前端 src/srs.js 完全一致。"""

import unittest

from scripts.daily_words import learner

NOW = 1_800_000_000_000  # 固定毫秒时间戳，避免用例随时钟漂移
DAY = 86400000


def state(s, last_days_ago=0, n=1, lapses=0, cut=None, p=None):
    ch = {"r": {"s": s, "d": 4.0, "last": NOW - last_days_ago * DAY, "due": 0, "n": n}}
    if p is not None:
        ch["p"] = {"s": p, "d": 4.0, "last": NOW - last_days_ago * DAY, "due": 0, "n": n}
    st = {"ch": ch, "seen": 0, "reps": n, "lapses": lapses, "born": NOW}
    if cut:
        st["cut"] = cut
    return st


class BandTest(unittest.TestCase):
    def test_new(self):
        self.assertEqual(learner.band_of(None, NOW), "new")

    def test_untested_is_learning(self):
        self.assertEqual(learner.band_of({"ch": {"r": {"s": 1, "last": 0, "n": 0}}}, NOW), "learning")

    def test_learning_threshold(self):
        self.assertEqual(learner.band_of(state(20.9), NOW), "learning")
        self.assertEqual(learner.band_of(state(21.0), NOW), "familiar")

    def test_mastered_threshold(self):
        self.assertEqual(learner.band_of(state(179.9), NOW), "familiar")
        self.assertEqual(learner.band_of(state(180.0), NOW), "mastered")

    def test_risk_overrides_mastered(self):
        # S=200，逾期 700 天 → R = 1/(1+700/1800) ≈ 0.72 < 0.75
        self.assertEqual(learner.band_of(state(200, last_days_ago=700), NOW), "risk")

    def test_fresh_mastered_not_risk(self):
        self.assertEqual(learner.band_of(state(200, last_days_ago=10), NOW), "mastered")

    def test_weakest_channel_wins(self):
        # r 很稳、p 很弱 → 取更弱的 p
        self.assertEqual(learner.band_of(state(200, p=5), NOW), "learning")

    def test_untested_channel_ignored(self):
        st = state(200)
        st["ch"]["p"] = {"s": 1, "d": 4.0, "last": 0, "due": 0, "n": 0}
        self.assertEqual(learner.band_of(st, NOW), "mastered")


class ProfileTest(unittest.TestCase):
    def test_counts_and_sets(self):
        progress = {
            "books": {
                "gk": {
                    "gk-0": state(300),
                    "gk-1": state(5),
                    "gk-2": state(50, lapses=2),
                    "gk-3": state(1, cut=123),
                }
            }
        }
        index = {"gk-0": "abandon", "gk-1": "absorb", "gk-2": "arise", "gk-3": "tease"}
        prof = learner.build_profile(progress, index, NOW)
        self.assertEqual(prof.learned, 4)
        self.assertEqual(prof.bands["mastered"], 1)
        self.assertEqual(prof.bands["learning"], 2)
        self.assertEqual(prof.bands["familiar"], 1)
        self.assertIn("abandon", prof.mastered)
        self.assertIn("tease", prof.cut)
        self.assertEqual(prof.weak[0][0], "arise")
        self.assertIn("已掌握 1", prof.summary_cn())

    def test_missing_index_degrades(self):
        progress = {"books": {"gk": {"gk-0": state(300)}}}
        prof = learner.build_profile(progress, {}, NOW)
        self.assertEqual(prof.bands["mastered"], 1)
        self.assertEqual(prof.mastered, set())


class LadderTest(unittest.TestCase):
    def batch(self, date, shift=0, seen=5, lapsed=0):
        b = learner.DailyBatch(date=date, words=[], shift=shift)
        b.seen, b.lapsed = seen, lapsed
        return b

    def test_no_history(self):
        self.assertEqual(learner.decide_ladder([]), (0, 12, "20–30%"))

    def test_downgrade_on_heavy_lapses(self):
        hist = [self.batch("2026-11-18", 0, seen=10, lapsed=4)]
        shift, count, _ = learner.decide_ladder(hist)
        self.assertEqual(shift, -1)
        self.assertEqual(count, 10)

    def test_upgrade_after_two_clean_batches(self):
        hist = [self.batch("2026-11-19", 0), self.batch("2026-11-20", 0)]
        shift, count, _ = learner.decide_ladder(hist)
        self.assertEqual(shift, 1)
        self.assertEqual(count, 14)

    def test_no_upgrade_with_single_batch(self):
        hist = [self.batch("2026-11-20", 0)]
        self.assertEqual(learner.decide_ladder(hist)[0], 0)

    def test_clamped(self):
        hist = [self.batch("2026-11-19", 1), self.batch("2026-11-20", 1)]
        self.assertEqual(learner.decide_ladder(hist)[0], 1)

    def test_stays_when_mixed(self):
        hist = [self.batch("2026-11-18", 0, seen=10, lapsed=1), self.batch("2026-11-20", 0, seen=10, lapsed=0)]
        self.assertEqual(learner.decide_ladder(hist)[0], 0)


class HistoryTest(unittest.TestCase):
    """网站把时文词并进一本《时文积累》（id=daily），历史统计要能顺着新书找到复习记录。"""

    def _dir(self, words):
        import json
        import pathlib
        import tempfile
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        base = pathlib.Path(tmp.name)
        (base / "2026-11-28.json").write_text(
            json.dumps({"date": "2026-11-28", "words": [{"word": w} for w in words]}, ensure_ascii=False),
            encoding="utf-8",
        )
        return base

    def test_reads_merged_book(self):
        base = self._dir(["abuse", "verdict"])
        progress = {"books": {"daily": {
            "daily-2026-11-28-0": state(5, lapses=1),
            "daily-2026-11-28-1": state(5, lapses=0),
        }}}
        hist = learner.read_daily_history(base, progress)
        self.assertEqual(len(hist), 1)
        self.assertEqual(hist[0].seen, 2)
        self.assertEqual(hist[0].lapsed, 1)

    def test_compat_with_per_day_book(self):
        base = self._dir(["abuse"])
        progress = {"books": {"daily-2026-11-28": {"daily-2026-11-28-0": state(5, lapses=1)}}}
        hist = learner.read_daily_history(base, progress)
        self.assertEqual(hist[0].seen, 1)
        self.assertEqual(hist[0].lapsed, 1)

    def test_no_progress_is_ignored(self):
        base = self._dir(["abuse"])
        hist = learner.read_daily_history(base, {"books": {}})
        self.assertEqual(hist[0].seen, 0)


class ExclusionTest(unittest.TestCase):
    def test_only_words_in_body(self):
        body = "The government promoted new policies, but the artist stayed quiet."
        self.assertEqual(learner.words_in_body({"promote", "abandon"}, body), ["promote"])

    def test_inflected_match(self):
        self.assertEqual(learner.words_in_body({"policy"}, "New policies were announced."), [])

    def test_build_exclusions_shape(self):
        prof = learner.Profile(cut={"promote"}, mastered={"policy"})
        hist = [learner.DailyBatch(date="2026-11-20", words=["quiet"], shift=0)]
        out = learner.build_exclusions(prof, hist, "They promote policy and quiet reform.")
        self.assertEqual(out["cut"], ["promote"])
        self.assertEqual(out["mastered"], ["policy"])
        self.assertEqual(out["recent"], ["quiet"])


if __name__ == "__main__":
    unittest.main()
