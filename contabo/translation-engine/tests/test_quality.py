from __future__ import annotations

import unittest

from quality import StructuredTranslationError, normalize_target_candidates, translate_structured_lines


class QualityShellTests(unittest.TestCase):
    def test_locale_normalization_prefers_exact_then_base(self) -> None:
        self.assertEqual(normalize_target_candidates("ja-JP"), ["ja-jp", "ja"])
        self.assertEqual(normalize_target_candidates("PT_BR"), ["pt-br", "pt"])
        self.assertEqual(normalize_target_candidates(" yue "), ["yue"])
        self.assertEqual(normalize_target_candidates(""), [])

    def test_line_strategy_preserves_markdown_prefixes_tables_and_protected_tokens(self) -> None:
        source = "# Hello\n- World __ASTERA_PROTECTED_000000__\n| Name | Value |\n| --- | --- |\n| Apple | 10 |\n> Quote"

        def translate_many(values):
            mapping = {
                "Hello": "こんにちは",
                "World __ASTERA_PROTECTED_000000__": "世界 __ASTERA_PROTECTED_000000__",
                "Name": "名前",
                "Value": "値",
                "Apple": "りんご",
                "10": "10",
                "Quote": "引用",
            }
            return [mapping.get(value, value) for value in values]

        translated = translate_structured_lines(source, translate_many)
        self.assertEqual(
            translated,
            "# こんにちは\n- 世界 __ASTERA_PROTECTED_000000__\n| 名前 | 値 |\n| --- | --- |\n| りんご | 10 |\n> 引用",
        )

    def test_line_strategy_rejects_model_newline_in_single_slot(self) -> None:
        with self.assertRaises(StructuredTranslationError):
            translate_structured_lines("# Hello", lambda values: ["こんにちは\n破壊"])

    def test_protected_only_line_never_reaches_model(self) -> None:
        called = False

        def translate_many(values):
            nonlocal called
            called = True
            return list(values)

        source = "__ASTERA_PROTECTED_000000__"
        self.assertEqual(translate_structured_lines(source, translate_many), source)
        self.assertFalse(called)


if __name__ == "__main__":
    unittest.main()
