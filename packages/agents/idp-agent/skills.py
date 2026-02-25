"""Skills registry builder."""

import logging
from pathlib import Path

logger = logging.getLogger(__name__)

SKILLS_DIR = Path(__file__).parent / ".skills"


def parse_skill_frontmatter(skill_md_path: Path) -> dict[str, str]:
    """SKILL.md frontmatter에서 name, description 추출."""
    result = {}
    with open(skill_md_path, "r") as f:
        in_frontmatter = False
        for line in f:
            if line.strip() == "---":
                in_frontmatter = not in_frontmatter
                continue
            if in_frontmatter and ":" in line:
                key, value = line.split(":", 1)
                result[key.strip()] = value.strip().strip('"')
    return result


def build_skills_registry() -> str:
    """스킬 디렉토리를 스캔해서 레지스트리 XML 생성."""
    if not SKILLS_DIR.exists():
        return ""

    registry = []
    for skill_md in SKILLS_DIR.glob("*/SKILL.md"):
        frontmatter = parse_skill_frontmatter(skill_md)
        skill_name = frontmatter.get("name", skill_md.parent.name)
        description = frontmatter.get("description", "")
        when_to_use = frontmatter.get("whenToUse", "")

        logger.info(f"Registered skill: {skill_name}")
        skill_xml = (
            f"<skill>\n"
            f"  <name>{skill_name}</name>\n"
            f"  <description>{description}</description>\n"
        )
        if when_to_use:
            skill_xml += f"  <whenToUse>{when_to_use}</whenToUse>\n"
        skill_xml += (
            f"  <location>{skill_md.resolve()}</location>\n"
            f"  <base_directory>{skill_md.parent.resolve()}</base_directory>\n"
            f"</skill>"
        )
        registry.append(skill_xml)

    return "\n".join(registry)


def load_skill_content(skill_name: str) -> str | None:
    """스킬의 SKILL.md 내용을 반환 (frontmatter 제외)."""
    skill_md = SKILLS_DIR / skill_name / "SKILL.md"
    if not skill_md.exists():
        return None

    with open(skill_md, "r") as f:
        content = f.read()

    # frontmatter 제거
    parts = content.split("---", 2)
    if len(parts) >= 3:
        return parts[2].strip()
    return content.strip()
