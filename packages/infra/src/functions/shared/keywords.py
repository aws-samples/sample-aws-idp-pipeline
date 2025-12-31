from typing import List, cast

from kiwipiepy import Kiwi, Token

_kiwi = None


def get_kiwi():
    global _kiwi
    if _kiwi is None:
        _kiwi = Kiwi()
    return _kiwi


def extract_keywords(text: str) -> str:
    kiwi = get_kiwi()
    results = []

    tokens: List[Token] = cast(List[Token], kiwi.tokenize(text, normalize_coda=True))

    for token in tokens:
        if token.tag == 'XSN':
            if results:
                results[-1] += token.form
            continue

        if token.tag in ['NNG', 'NNP', 'NR', 'NP', 'SL', 'SN', 'SH']:
            if token.tag not in ['SL', 'SN', 'SH'] and len(token.form) == 1:
                if token.form in ['것', '수', '등', '때', '곳']:
                    continue

            results.append(token.form)

    return ' '.join(results)


def extract_keywords_detailed(text: str) -> str:
    kiwi = get_kiwi()
    results = []
    tokens: List[Token] = cast(List[Token], kiwi.tokenize(text))

    for token in tokens:
        if token.tag == 'XSN':
            if results:
                results[-1] += token.form
            continue

        if token.tag.startswith('N'):
            results.append(token.form)

        if token.tag.startswith('W'):
            results.append(token.form)

        if token.tag in ['SL', 'SH', 'SN']:
            results.append(token.form)

        if token.tag in ['VV', 'VA', 'VX']:
            results.append(token.form)

    return ' '.join(results)
