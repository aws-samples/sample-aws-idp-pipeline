"""Tests for deduplicate_entities and normalize_entities.

Usage:
    python -m pytest test_normalizer.py -v
    ENTITY_NORMALIZATION_MODEL_ID=global.anthropic.claude-sonnet-5 python -m pytest test_normalizer.py -v -s
"""
import json
import sys
import os

import pytest

sys.path.insert(0, os.path.dirname(__file__))

from normalizer import deduplicate_entities, normalize_entities


PAGE1_ENTITIES = [
    {'name': 'Prototype', 'mentioned_in': [
        {'segment_index': 0, 'qa_index': 0, 'context': '소프트웨어 개발 단계의 세 번째 단계'},
    ]},
    {'name': 'AWS', 'mentioned_in': [
        {'segment_index': 0, 'qa_index': 0, 'context': '슬라이드 출처 및 발행사'},
    ]},
    {'name': 'Production', 'mentioned_in': [
        {'segment_index': 0, 'qa_index': 0, 'context': '소프트웨어 개발 최종 단계'},
    ]},
]

PAGE2_ENTITIES = [
    {'name': 'AWS Prototyping', 'mentioned_in': [
        {'segment_index': 1, 'qa_index': 0, 'context': '문서 주제'},
    ]},
    {'name': 'Innovation Flywheel', 'mentioned_in': [
        {'segment_index': 1, 'qa_index': 0, 'context': '핵심 개념'},
    ]},
    {'name': 'aws', 'mentioned_in': [
        {'segment_index': 1, 'qa_index': 0, 'context': '저작권자'},
    ]},
    {'name': 'Production', 'mentioned_in': [
        {'segment_index': 1, 'qa_index': 0, 'context': '최종 배포 단계'},
    ]},
]


def test_merges_same_name():
    """'AWS'와 'aws'가 하나로 합쳐지고 mentioned_in이 병합된다."""
    result = deduplicate_entities(PAGE1_ENTITIES + PAGE2_ENTITIES)
    aws_entities = [e for e in result if e['name'].lower() == 'aws']
    assert len(aws_entities) == 1
    assert len(aws_entities[0]['mentioned_in']) == 2


def test_keeps_first_casing():
    """먼저 나온 'AWS'의 대소문자가 유지된다."""
    result = deduplicate_entities(PAGE1_ENTITIES + PAGE2_ENTITIES)
    aws_entity = next(e for e in result if e['name'].lower() == 'aws')
    assert aws_entity['name'] == 'AWS'


def test_different_names_not_merged():
    """'Prototype'과 'AWS Prototyping'은 별개로 유지된다."""
    result = deduplicate_entities(PAGE1_ENTITIES + PAGE2_ENTITIES)
    names = {e['name'] for e in result}
    assert 'Prototype' in names
    assert 'AWS Prototyping' in names


def test_exact_duplicate_merged():
    """'Production'이 양쪽에 있으면 하나로 합쳐지고 mentioned_in 2개."""
    result = deduplicate_entities(PAGE1_ENTITIES + PAGE2_ENTITIES)
    prod = next(e for e in result if e['name'] == 'Production')
    assert len(prod['mentioned_in']) == 2


def test_total_count():
    """7개 입력 중 AWS/aws, Production/Production 병합으로 5개가 된다."""
    result = deduplicate_entities(PAGE1_ENTITIES + PAGE2_ENTITIES)
    assert len(result) == 5


def test_empty():
    assert deduplicate_entities([]) == []


# --- normalize_entities (LLM 호출) ---

ALL_ENTITIES = [
    # Page 1
    {'name': 'Demo', 'mentioned_in': [
        {'segment_index': 0, 'qa_index': 0, 'context': '소프트웨어 개발 단계 버블 차트의 첫 단계'},
        {'segment_index': 0, 'qa_index': 1, 'context': '버블 차트에서 가장 작은 버블로 표현된 개발 단계'},
    ]},
    {'name': 'Proof of Concept', 'mentioned_in': [
        {'segment_index': 0, 'qa_index': 0, 'context': '소프트웨어 개발 단계의 두 번째 단계'},
        {'segment_index': 0, 'qa_index': 1, 'context': '버블 차트에서 Days 초반에 위치하는 개발 단계'},
    ]},
    {'name': 'Prototype', 'mentioned_in': [
        {'segment_index': 0, 'qa_index': 0, 'context': '소프트웨어 개발 단계의 세 번째 단계 및 슬라이드 주제'},
        {'segment_index': 0, 'qa_index': 1, 'context': '주황색 테두리로 강조된 핵심 단계'},
    ]},
    {'name': 'Pilot', 'mentioned_in': [
        {'segment_index': 0, 'qa_index': 0, 'context': '소프트웨어 개발 단계의 네 번째 단계'},
        {'segment_index': 0, 'qa_index': 1, 'context': 'Weeks~Months 범위의 개발 단계'},
    ]},
    {'name': 'Production', 'mentioned_in': [
        {'segment_index': 0, 'qa_index': 0, 'context': '소프트웨어 개발 단계의 최종 단계'},
        {'segment_index': 0, 'qa_index': 1, 'context': '가장 큰 버블로 표현된 최종 개발 단계'},
    ]},
    {'name': 'Minimum Viable Product', 'mentioned_in': [
        {'segment_index': 0, 'qa_index': 0, 'context': 'Pilot과 Production 사이의 중간 이정표'},
        {'segment_index': 0, 'qa_index': 1, 'context': 'Pilot과 Production 경계에 표시된 개발 마일스톤'},
    ]},
    {'name': 'AWS', 'mentioned_in': [
        {'segment_index': 0, 'qa_index': 0, 'context': '슬라이드 출처 및 발행사'},
    ]},
    # Page 2
    {'name': 'AWS Prototyping', 'mentioned_in': [
        {'segment_index': 1, 'qa_index': 0, 'context': '문서 주제'},
    ]},
    {'name': 'Innovation Flywheel', 'mentioned_in': [
        {'segment_index': 1, 'qa_index': 0, 'context': '핵심 개념'},
    ]},
    {'name': 'Experiment', 'mentioned_in': [
        {'segment_index': 1, 'qa_index': 0, 'context': 'Innovation Flywheel 단계'},
    ]},
    {'name': 'Feedback', 'mentioned_in': [
        {'segment_index': 1, 'qa_index': 0, 'context': 'Innovation Flywheel 단계'},
    ]},
    {'name': 'Ideas', 'mentioned_in': [
        {'segment_index': 1, 'qa_index': 0, 'context': 'Innovation Flywheel 단계'},
    ]},
    {'name': 'Accelerate adoption', 'mentioned_in': [
        {'segment_index': 1, 'qa_index': 0, 'context': '프로토타이핑 4대 가치'},
    ]},
    {'name': 'Elevate customer thinking', 'mentioned_in': [
        {'segment_index': 1, 'qa_index': 0, 'context': '프로토타이핑 4대 가치'},
    ]},
    {'name': 'Create long term value', 'mentioned_in': [
        {'segment_index': 1, 'qa_index': 0, 'context': '프로토타이핑 4대 가치'},
    ]},
    {'name': 'Demystify technology', 'mentioned_in': [
        {'segment_index': 1, 'qa_index': 0, 'context': '프로토타이핑 4대 가치'},
    ]},
    {'name': 'Amazon Web Services', 'mentioned_in': [
        {'segment_index': 1, 'qa_index': 0, 'context': '저작권자'},
    ]},
]


@pytest.fixture
def require_normalization_model():
    if not os.environ.get('ENTITY_NORMALIZATION_MODEL_ID'):
        pytest.skip('ENTITY_NORMALIZATION_MODEL_ID not set')


def test_normalize_entities(require_normalization_model):
    """normalize_entities가 관련 엔티티를 그룹핑한다."""
    result = normalize_entities(ALL_ENTITIES)

    assert isinstance(result, list)
    assert len(result) < len(ALL_ENTITIES)

    names = {e['name'] for e in result}
    print(f'\n--- Normalized: {len(ALL_ENTITIES)} -> {len(result)} ---')
    print(json.dumps(result, indent=2, ensure_ascii=False))
    print(f'Names: {names}')
