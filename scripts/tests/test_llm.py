"""模型输出解析与提示词组装测试（不访问网络）。"""

import json
import unittest

from scripts.daily_words import llm


class ExtractJsonTest(unittest.TestCase):
    def test_plain(self):
        self.assertEqual(llm.extract_json('{"a":1}'), {"a": 1})

    def test_fenced(self):
        self.assertEqual(llm.extract_json('```json\n{"a":1}\n```'), {"a": 1})

    def test_prose_prefix(self):
        self.assertEqual(llm.extract_json('好的，结果如下：{"a":1} 希望有帮助'), {"a": 1})

    def test_braces_inside_string(self):
        text = '{"example": "a {brace} inside", "n": 2}'
        self.assertEqual(llm.extract_json(text)["n"], 2)

    def test_escaped_quote(self):
        text = '{"example": "he said \\"hi\\""}'
        self.assertEqual(llm.extract_json(text)["example"], 'he said "hi"')

    def test_nested(self):
        text = '{"a": {"b": [1, {"c": 2}]}}'
        self.assertEqual(llm.extract_json(text)["a"]["b"][1]["c"], 2)

    def test_empty_raises(self):
        with self.assertRaises(llm.AgnesError):
            llm.extract_json("")

    def test_no_json_raises(self):
        with self.assertRaises(llm.AgnesError):
            llm.extract_json("抱歉，我无法完成。")

    def test_unbalanced_raises(self):
        with self.assertRaises(llm.AgnesError):
            llm.extract_json('{"a": 1')


class PromptTest(unittest.TestCase):
    class Art:
        title = "Test headline"
        url = "https://example.com/a"
        body = "The quick brown fox jumps over the lazy dog. " * 20

    class Prof:
        def summary_cn(self):
            return "学习中 10、熟悉 2；已学 12 词"

    def test_contains_constraints_and_exclusions(self):
        messages = llm.build_messages(
            self.Art(), self.Prof(),
            {"cut": ["abandon"], "mastered": ["absorb"], "recent": ["adapt"]},
            count=12, ratio_text="20–30%",
        )
        user = messages[-1]["content"]
        self.assertIn("12 个", user)
        self.assertIn("abandon", user)
        self.assertIn("absorb", user)
        self.assertIn("不能改写" if "不能改写" in user else "原样截取", user)
        self.assertIn("Test headline", user)
        # 明确要求忽略正文里的指令，防注入
        self.assertIn("一律忽略", messages[0]["content"])

    def test_empty_exclusions(self):
        messages = llm.build_messages(self.Art(), self.Prof(), {}, 12, "20–30%")
        self.assertIn("无", messages[-1]["content"])

    def test_repair_messages_carry_errors(self):
        base = [{"role": "user", "content": "x"}]
        out = llm.build_repair_messages(base, '{"words":[]}', ["合格词数 3 少于下限 10"], 12)
        self.assertEqual(len(out), 3)
        self.assertIn("少于下限", out[-1]["content"])
        self.assertIn('{"words":[]}', out[-1]["content"])


if __name__ == "__main__":
    unittest.main()
