from __future__ import annotations

import re
from collections.abc import Callable, Sequence

_PROTECTED_ONLY = re.compile(r"^(?:\s*__ASTERA_PROTECTED_\d{6}__\s*)+$")
_MARKDOWN_PREFIX = re.compile(r"^(\s*(?:#{1,6}\s+|[-*+]\s+|\d+[.)]\s+|>\s?))(.*)$")
_TABLE_SEPARATOR = re.compile(r"^\s*:?-{3,}:?\s*$")


class StructuredTranslationError(RuntimeError):
    pass


def normalize_target_candidates(value: str) -> list[str]:
    normalized = value.strip().lower().replace("_", "-")
    if not normalized:
        return []
    parts = [part for part in normalized.split("-") if part]
    if not parts:
        return []
    candidates = [normalized]
    if len(parts) > 1:
        candidates.append(parts[0])
    result: list[str] = []
    for candidate in candidates:
        if candidate not in result and re.fullmatch(r"[a-z0-9]{2,8}(?:-[a-z0-9]{1,8})*", candidate):
            result.append(candidate)
    return result


def _with_margins(value: str, task_index: int) -> tuple[str, int, str]:
    leading_match = re.match(r"^\s*", value)
    trailing_match = re.search(r"\s*$", value)
    leading = leading_match.group(0) if leading_match else ""
    trailing = trailing_match.group(0) if trailing_match else ""
    core_end = len(value) - len(trailing) if trailing else len(value)
    core = value[len(leading):core_end]
    if not core:
        return value, -1, ""
    return leading, task_index, trailing


def translate_structured_lines(
    source: str,
    translate_many: Callable[[Sequence[str]], Sequence[str]],
) -> str:
    """Translate only human-readable line/cell bodies while preserving Markdown structure.

    This is the deterministic fallback path. It deliberately gives up some document context
    in exchange for exact line/prefix/table stability when the primary document translation
    fails Astera's structural validation.
    """

    lines = source.split("\n")
    tasks: list[str] = []
    plans: list[list[tuple[str, str | int]]] = []

    def task_piece(raw: str) -> list[tuple[str, str | int]]:
        if not raw.strip() or _PROTECTED_ONLY.fullmatch(raw):
            return [("literal", raw)]
        leading_match = re.match(r"^\s*", raw)
        trailing_match = re.search(r"\s*$", raw)
        leading = leading_match.group(0) if leading_match else ""
        trailing = trailing_match.group(0) if trailing_match else ""
        end = len(raw) - len(trailing) if trailing else len(raw)
        core = raw[len(leading):end]
        if not core or _PROTECTED_ONLY.fullmatch(core):
            return [("literal", raw)]
        index = len(tasks)
        tasks.append(core)
        pieces: list[tuple[str, str | int]] = []
        if leading:
            pieces.append(("literal", leading))
        pieces.append(("task", index))
        if trailing:
            pieces.append(("literal", trailing))
        return pieces

    for line in lines:
        if not line.strip() or _PROTECTED_ONLY.fullmatch(line):
            plans.append([("literal", line)])
            continue

        if re.match(r"^\s*\|.*\|\s*$", line):
            parts = re.split(r"(\|)", line)
            plan: list[tuple[str, str | int]] = []
            for part in parts:
                if part == "|" or not part.strip() or _TABLE_SEPARATOR.fullmatch(part):
                    plan.append(("literal", part))
                else:
                    plan.extend(task_piece(part))
            plans.append(plan)
            continue

        prefix = _MARKDOWN_PREFIX.match(line)
        if prefix:
            plan = [("literal", prefix.group(1))]
            plan.extend(task_piece(prefix.group(2)))
            plans.append(plan)
            continue

        plans.append(task_piece(line))

    translated = list(translate_many(tasks)) if tasks else []
    if len(translated) != len(tasks):
        raise StructuredTranslationError("translation batch cardinality changed")
    if any("\n" in item or "\r" in item for item in translated):
        raise StructuredTranslationError("line strategy produced an embedded newline")

    output_lines: list[str] = []
    for plan in plans:
        chunks: list[str] = []
        for kind, value in plan:
            if kind == "literal":
                chunks.append(str(value))
            else:
                chunks.append(translated[int(value)])
        output_lines.append("".join(chunks))
    return "\n".join(output_lines)
