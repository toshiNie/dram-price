import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]

class ChineseUiTest(unittest.TestCase):
    def test_page_declares_simplified_chinese_and_uses_chinese_title(self):
        html = (ROOT / 'web' / 'index.html').read_text(encoding='utf-8')
        self.assertIn('<html lang="zh-CN"', html)
        self.assertIn('<title>DRAM 价格每日仪表盘</title>', html)
        self.assertIn('数据源', html)
        self.assertNotIn('lang="ko"', html)

    def test_web_assets_have_no_korean_user_facing_copy(self):
        for path in (ROOT / 'web').glob('*'):
            if path.suffix not in {'.html', '.js', '.css'}:
                continue
            text = path.read_text(encoding='utf-8')
            self.assertFalse(any('\uac00' <= char <= '\ud7a3' for char in text), path.name)

    def test_runtime_labels_are_simplified_chinese(self):
        js = (ROOT / 'web' / 'app.js').read_text(encoding='utf-8')
        self.assertIn("contract: '合约价'", js)
        self.assertIn("spot: '现货价'", js)
        self.assertIn("toLocaleString('zh-CN'", js)
        self.assertIn("DateTimeFormat('zh-CN'", js)
        self.assertNotIn("toLocaleString('ko-KR'", js)
        self.assertNotIn("DateTimeFormat('ko-KR'", js)

if __name__ == '__main__':
    unittest.main()
