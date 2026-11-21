"""正文抽取与选文解析测试（纯离线，不访问网络）。"""

import unittest

from scripts.daily_words import article, htmltext

PAGE = """
<html><head><title>Test Headline - Chinadaily.com.cn</title></head>
<body>
<nav><p>Home | China | World | Business | Opinion | Culture</p></nav>
<div class="main_art">
  <h1>Test Headline</h1>
  <div id="Content">
    <p>First real paragraph with enough words to pass the length filter easily.</p>
    <p>Second real paragraph, also long enough to be treated as article body text.</p>
    <p>Third real paragraph that mentions the word resilience in passing.</p>
    <p>Fourth real paragraph closes out the story with a quote from an official.</p>
    <script>var x = "<p>not a paragraph</p>";</script>
    <iframe src="https://video.example/x"></iframe>
    <p>Copyright 2026 China Daily. All rights reserved.</p>
  </div>
  <div class="selectpage"><p>Related reading should never be included in body text.</p></div>
</div>
<div class="footer"><p>Follow us on social media for more news updates every day.</p></div>
</body></html>
"""

LINKS_PAGE = """
<a href="//www.chinadaily.com.cn/a/202611/21/WS6b00f9e4e4b03ebf8519dd22.html">A</a>
<a href="https://www.chinadaily.com.cn/a/202611/20/WS6aff2529e4b03ebf8519d88c.html">B</a>
<a href="//www.chinadaily.com.cn/a/202611/21/WS6b00f9e4e4b03ebf8519dd22.html">dup</a>
<a href="/china">nav</a>
<a href="//www.chinadaily.com.cn/a/202611/21/WSxyz.html">short id</a>
"""


class ExtractTest(unittest.TestCase):
    def setUp(self):
        self.parsed = htmltext.extract(PAGE)

    def test_title_cleaned(self):
        self.assertEqual(self.parsed["title"], "Test Headline")

    def test_only_content_paragraphs(self):
        body = self.parsed["body"]
        self.assertIn("First real paragraph", body)
        self.assertIn("Fourth real paragraph", body)
        self.assertNotIn("Related reading", body)
        self.assertNotIn("Follow us on", body)
        self.assertNotIn("Copyright", body)
        self.assertNotIn("not a paragraph", body)
        self.assertNotIn("Home | China", body)

    def test_used_content_div(self):
        self.assertTrue(self.parsed["used_content_div"])

    def test_fallback_without_container(self):
        html = "<html><body>" + "".join(
            f"<p>Paragraph {i} without any content container but long enough to keep.</p>"
            for i in range(6)
        ) + "</body></html>"
        parsed = htmltext.extract(html)
        self.assertFalse(parsed["used_content_div"])
        self.assertGreaterEqual(len(parsed["paragraphs"]), 4)
        self.assertIn("Paragraph 0", parsed["body"])

    def test_survives_broken_html(self):
        parsed = htmltext.extract(
            "<div id='Content'><p>unclosed paragraph that still carries enough words to be kept as body text"
        )
        self.assertIn("unclosed paragraph", parsed["body"])


class LinkParseTest(unittest.TestCase):
    def test_parse_links(self):
        links = article.parse_links(LINKS_PAGE)
        urls = [u for u, _ in links]
        # 相对链接、重复链接都会被过滤/去重
        self.assertEqual(len(urls), 3)
        self.assertTrue(all(u.startswith("https://www.chinadaily.com.cn/a/") for u in urls))
        self.assertEqual(links[0][1], "2026-11-21")
        self.assertEqual(len(set(urls)), len(urls))

    def test_skip_title_patterns(self):
        for title in ("Photos: spring in Beijing", "[Video] the week ahead", "Live: press briefing"):
            with self.subTest(title=title):
                self.assertTrue(article._SKIP_TITLE_RE.search(title))
        self.assertFalse(article._SKIP_TITLE_RE.search("Foreigners win 2026 Orchid Awards"))


if __name__ == "__main__":
    unittest.main()
