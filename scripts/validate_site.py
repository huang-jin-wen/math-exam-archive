"""学习小站的零依赖静态检查脚本。"""

from __future__ import annotations

import json
import re
import sys
from html.parser import HTMLParser
from pathlib import Path
from urllib.parse import unquote, urlsplit


ROOT = Path(__file__).resolve().parents[1]
DATA_DIR = ROOT / "data"
ALLOWED_TYPES = {"单选题", "多选题", "判断题", "填空题"}


class AnchorNestingChecker(HTMLParser):
    """检查 HTML 中是否出现嵌套链接。"""

    def __init__(self) -> None:
        super().__init__()
        self.anchor_depth = 0
        self.nested_lines: list[int] = []

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        if tag == "a":
            if self.anchor_depth:
                self.nested_lines.append(self.getpos()[0])
            self.anchor_depth += 1

    def handle_endtag(self, tag: str) -> None:
        if tag == "a" and self.anchor_depth:
            self.anchor_depth -= 1


def load_json(path: Path):
    with path.open(encoding="utf-8") as file:
        return json.load(file)


def validate_subjects(errors: list[str]) -> None:
    config_path = DATA_DIR / "subjects.json"
    subjects = load_json(config_path)
    seen_ids: set[str] = set()

    for subject in subjects:
        subject_id = subject.get("id", "")
        if not subject_id or subject_id in seen_ids:
            errors.append(f"subjects.json：科目标识为空或重复：{subject_id!r}")
        seen_ids.add(subject_id)

        data_path = ROOT / subject.get("file", "")
        if not data_path.is_file():
            errors.append(f"subjects.json：题库文件不存在：{data_path}")
            continue

        questions = load_json(data_path)
        if len(questions) != subject.get("count"):
            errors.append(
                f"{data_path.name}：配置题数 {subject.get('count')}，实际 {len(questions)}"
            )

        for number, question in enumerate(questions, start=1):
            question_type = question.get("type")
            for field in ("chapter", "type", "stem", "answer"):
                if question.get(field) in (None, ""):
                    errors.append(f"{data_path.name} 第{number}题：缺少 {field}")

            if question_type not in ALLOWED_TYPES:
                errors.append(f"{data_path.name} 第{number}题：未知题型 {question_type!r}")

            options = question.get("options") or []
            if question_type in {"单选题", "多选题"}:
                labels = {str(option.get("label", "")) for option in options}
                answer_labels = set(str(question.get("answer", "")))
                if not answer_labels <= labels:
                    errors.append(f"{data_path.name} 第{number}题：答案不在选项标签中")

                option_texts = [str(option.get("text", "")) for option in options]
                if len(option_texts) != len(set(option_texts)):
                    errors.append(f"{data_path.name} 第{number}题：存在完全相同的选项")


def validate_html(errors: list[str]) -> None:
    resource_pattern = re.compile(r'(?:href|src)=["\']([^"\']+)', re.IGNORECASE)

    for html_path in ROOT.rglob("*.html"):
        text = html_path.read_text(encoding="utf-8")
        checker = AnchorNestingChecker()
        checker.feed(text)
        for line in checker.nested_lines:
            errors.append(f"{html_path.name} 第{line}行：出现嵌套链接 <a>")

        for resource in resource_pattern.findall(text):
            parsed = urlsplit(resource)
            if parsed.scheme or not parsed.path:
                continue
            target = html_path.parent / unquote(parsed.path)
            if not target.exists():
                errors.append(f"{html_path.name}：本地资源不存在：{resource}")


def main() -> int:
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")
    errors: list[str] = []
    try:
        validate_subjects(errors)
        validate_html(errors)
    except (OSError, json.JSONDecodeError) as exc:
        errors.append(f"读取文件失败：{exc}")

    if errors:
        print("检查失败：")
        for error in errors:
            print(f"- {error}")
        return 1

    print("检查通过：科目配置、题库数据和本地链接均正常。")
    return 0


if __name__ == "__main__":
    sys.exit(main())
