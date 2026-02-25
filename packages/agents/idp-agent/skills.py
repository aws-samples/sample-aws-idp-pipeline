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
