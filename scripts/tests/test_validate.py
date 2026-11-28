"""校验器测试：这些用例是词表质量的底线，改动 validate.py 必须先过这里。"""

import unittest

from scripts.daily_words import validate as vd

BODY = (
    'Initiated by the China International Communications Group in 2022, the Orchid Awards honor '
    'non-Chinese individuals and institutions for promoting cultural exchanges. '
    'He said the orchid was also a flower preferred by French writer Marcel Proust. '
    '"Through the image of flowers, Chinese literature has expressed a harmonious society," she said. '
    'Foster transformed a family legacy into friendship across generations. '
    'The diplomat endured years of hardship during his service abroad. '
)


def entry(word, **kw):
    data = {
        "word": word,
        "phonetic": "/ˈtest/",
        "pos": "v.",
        "meaning": "测试释义",
        "example": "Initiated by the China International Communications Group in 2022.",
        "exampleCn": "由中国国际传播集团于2022年发起。",
    }
    data.update(kw)
    return data


class BodyIndexTest(unittest.TestCase):
    def setUp(self):
        self.index = vd.BodyIndex.build(BODY)

    def test_exact_match_returns_original_quotes(self):
        # 模型把双引号改成单引号，仍应命中，并且最终例句是正文原句（含原引号）
        got = self.index.exact_original(
            "'Through the image of flowers, Chinese literature has expressed a harmonious society,' she said."
        )
        self.assertIsNotNone(got)
        snapped = self.index.snap_to_sentence(got)
        self.assertIn('"Through the image', snapped)
        self.assertIn("harmonious society", snapped)

    def test_snap_fragment_to_full_sentence(self):
        got = self.index.exact_original("Initiated by the China International Communications Group in 2022")
        snapped = self.index.snap_to_sentence(got)
        self.assertTrue(snapped.endswith("cultural exchanges."), snapped)
        self.assertIn("Initiated by", snapped)

    def test_family_forms(self):
        cases = {
            "promote": "promoting",   # 去 e 加 ing
            "prefer": "preferred",    # 双写辅音
            "harmony": "harmonious",  # y → ious
            "transform": "transformed",
            "endure": "endured",
            "initiate": "initiated",
            "diplomat": "diplomat",
        }
        for word, expected in cases.items():
            with self.subTest(word=word):
                self.assertEqual(self.index.find_form(word), expected)

    def test_absent_word_returns_none(self):
        self.assertIsNone(self.index.find_form("photosynthesis"))

    def test_no_false_family(self):
        # transfer 不应被当成 transform 的出现形式
        self.assertIsNone(self.index.find_form("transfer"))


S1 = ("Initiated by the China International Communications Group in 2022, the Orchid Awards honor "
      "non-Chinese individuals and institutions for promoting cultural exchanges.")
S2 = "He said the orchid was also a flower preferred by French writer Marcel Proust."
S3 = '"Through the image of flowers, Chinese literature has expressed a harmonious society," she said.'
S4 = "Foster transformed a family legacy into friendship across generations."
S5 = "The diplomat endured years of hardship during his service abroad."


class ValidateWordsTest(unittest.TestCase):
    def setUp(self):
        self.index = vd.BodyIndex.build(BODY)
        # 每个词各自独占一句，满足「一句一词」
        self.good = [
            entry("promote", example=S1, meaning="促进"),
            entry("prefer", phonetic="/prɪˈfɜː/", example=S2, meaning="更喜欢"),
            entry("harmony", phonetic="/ˈhɑːməni/", pos="n.", example=S3, meaning="和谐"),
            entry("legacy", phonetic="/ˈleɡəsi/", pos="n.", example=S4, meaning="遗产"),
            entry("diplomat", phonetic="/ˈdɪpləmæt/", pos="n.", example=S5, meaning="外交官"),
        ]

    def test_min_count_error(self):
        words, errors, _, _ = vd.validate_words(self.good, self.index, count_min=10)
        self.assertEqual(len(words), 5)
        self.assertTrue(errors and "少于下限" in errors[0])

    def test_ok_with_lower_min(self):
        words, errors, warnings, dropped = vd.validate_words(self.good, self.index, count_min=5)
        self.assertEqual(errors, [])
        self.assertEqual(len(words), 5)
        self.assertEqual(dropped, [])
        self.assertEqual(words[0]["word"], "promote")

    def test_phrase_rejected(self):
        bad = [entry("keep to themselves")]
        _, errors, _, dropped = vd.validate_words(bad, self.index, count_min=1)
        self.assertIn("不是单个英文单词", dropped[0]["reason"])

    def test_proper_noun_rejected(self):
        _, _, _, dropped = vd.validate_words([entry("china")], self.index, count_min=1)
        self.assertIn("专名", dropped[0]["reason"])

    def test_meaning_too_long(self):
        bad = [entry("promote", meaning="促" * 41)]
        _, _, _, dropped = vd.validate_words(bad, self.index, count_min=1)
        self.assertIn("超过", dropped[0]["reason"])

    def test_phonetic_keeps_ash(self):
        words, errors, _, _ = vd.validate_words(
            [entry("diplomat", phonetic="/ˈdɪpləmæt/", pos="n.",
                   example="The diplomat endured years of hardship during his service abroad.", meaning="外交官")],
            self.index, count_min=1,
        )
        self.assertEqual(errors, [])
        self.assertEqual(words[0]["phonetic"], "/ˈdɪpləmæt/")

    def test_phonetic_garbage_rejected(self):
        _, _, _, dropped = vd.validate_words(
            [entry("promote", phonetic="音标缺失")], self.index, count_min=1
        )
        self.assertIn("音标", dropped[0]["reason"])

    def test_fabricated_example_rejected(self):
        _, _, _, dropped = vd.validate_words(
            [entry("promote", example="The government promoted the new policy yesterday.")],
            self.index, count_min=1,
        )
        self.assertIn("对不上", dropped[0]["reason"])

    def test_same_sentence_cap(self):
        three = [
            entry("promote", example=S1),
            entry("initiate", example=S1),
            entry("honor", example=S1),
        ]
        words, _, _, dropped = vd.validate_words(three, self.index, count_min=1)
        self.assertEqual(len(words), vd.MAX_WORDS_PER_EXAMPLE)
        self.assertIn("同一句", dropped[0]["reason"])

    def test_common_word_rejected(self):
        _, _, _, dropped = vd.validate_words(
            [entry("world", pos="n.", example=S4, meaning="世界")], self.index, count_min=1
        )
        self.assertIn("过于基础", dropped[0]["reason"])

    def test_pos_joined_by_space(self):
        words, errors, _, _ = vd.validate_words(
            [entry("promote", pos="v. n.", example=S1, meaning="促进")], self.index, count_min=1
        )
        self.assertEqual(errors, [])
        self.assertEqual(words[0]["pos"], "v./n.")

    def test_invalid_pos_rejected(self):
        _, _, _, dropped = vd.validate_words(
            [entry("promote", pos="名词")], self.index, count_min=1
        )
        self.assertIn("词性", dropped[0]["reason"])

    def test_truncate_over_max(self):
        words_list = [f"word{chr(ord('a') + i)}" for i in range(20)]
        sentences = [f"Sentence {i} contains {w} and enough other filler text here." for i, w in enumerate(words_list)]
        index = vd.BodyIndex.build(" ".join(sentences))
        raw = [entry(w, example=s) for w, s in zip(words_list, sentences)]
        words, errors, warnings, _ = vd.validate_words(raw, index, count_min=1, count_max=15)
        self.assertEqual(errors, [])
        self.assertEqual(len(words), 15)
        self.assertTrue(any("截断" in w for w in warnings))

    def test_dedupe(self):
        words, _, warnings, _ = vd.validate_words(
            [self.good[0], dict(self.good[0])], self.index, count_min=1
        )
        self.assertEqual(len(words), 1)
        self.assertTrue(any("重复" in w for w in warnings))


class ValidateNotesTest(unittest.TestCase):
    def test_notes_filtered(self):
        notes, warnings = vd.validate_notes(
            [
                {"word": "promote", "text": "promote 后常接名词。"},
                {"word": "absent", "text": "不在选词里。"},
                {"word": "promote", "text": "太短"},
            ],
            ["promote"],
        )
        self.assertEqual(len(notes), 1)
        self.assertEqual(notes[0]["word"], "promote")
        self.assertTrue(warnings)

    def test_notes_cap(self):
        notes, _ = vd.validate_notes(
            [{"word": "promote", "text": f"第 {i} 条讲解内容"} for i in range(5)], ["promote"]
        )
        self.assertLessEqual(len(notes), 3)


class LemmaTest(unittest.TestCase):
    VOCAB = {"pit", "tie", "exclude", "foreclose", "underscore", "stipulate", "restrict", "carry", "endure"}

    def test_reduces_to_base(self):
        cases = {
            "pitted": "pit", "tied": "tie", "excluded": "exclude",
            "forecloses": "foreclose", "underscores": "underscore",
            "stipulates": "stipulate", "restricting": "restrict",
            "carrying": "carry", "endured": "endure",
        }
        for word, base in cases.items():
            with self.subTest(word=word):
                self.assertEqual(vd.lemma_of(word, self.VOCAB), base)

    def test_unknown_base_left_alone(self):
        self.assertIsNone(vd.lemma_of("glorped", self.VOCAB))

    def test_exceptions_not_reduced(self):
        for word in ("united", "biased", "sophisticated"):
            with self.subTest(word=word):
                self.assertIsNone(vd.lemma_of(word, self.VOCAB))

    def test_inflected_headword_rejected_with_hint(self):
        index = vd.BodyIndex.build(
            "The case pitted two firms against each other and excluded rivals from the market."
        )
        bad = [entry("pitted", example="The case pitted two firms against each other and excluded rivals from the market.",
                     pos="v.", meaning="使竞争")]
        words, _, _, dropped = vd.validate_words(bad, index, count_min=1, vocab=self.VOCAB)
        self.assertEqual(words, [])
        self.assertIn("原形 pit", dropped[0]["reason"])

    def test_base_form_accepted(self):
        index = vd.BodyIndex.build(
            "The case pitted two firms against each other and excluded rivals from the market."
        )
        ok = [entry("pit", example="The case pitted two firms against each other and excluded rivals from the market.",
                    pos="v.", meaning="使竞争")]
        words, errors, _, _ = vd.validate_words(ok, index, count_min=1, vocab=self.VOCAB)
        self.assertEqual(errors, [])
        self.assertEqual(words[0]["word"], "pit")


class FullValidateTest(unittest.TestCase):
    def test_metadata_overridden(self):
        obj = {
            "date": "1999-01-01",
            "source": "模型自己写的标题",
            "url": "https://evil.example/x",
            "words": [entry("promote", example=S1, meaning="促进")],
            "notes": [],
        }
        res = vd.validate(
            obj, body=BODY, date="2026-11-21", source="真实标题",
            url="https://real.example/a", count_min=1,
        )
        self.assertTrue(res.ok, res.errors)
        self.assertEqual(res.book["date"], "2026-11-21")
        self.assertEqual(res.book["source"], "真实标题")
        self.assertEqual(res.book["url"], "https://real.example/a")


if __name__ == "__main__":
    unittest.main()
