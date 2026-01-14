from kiwipiepy import Kiwi

kiwi = Kiwi()


def extract_keywords(text: str) -> str:
    """
    텍스트에서 키워드를 추출합니다.

    - 명사, 고유명사, 외국어, 숫자, 한자 등 의미있는 토큰만 추출
    - 접미사는 앞 단어에 붙임 (예: 생성+형 -> 생성형)
    - 1글자 불용어 필터링
    """
    results: list[str] = []

    # normalize_coda: 'ㅋㅋㅋ' 같은 구어체 정규화
    tokens = kiwi.tokenize(text, normalize_coda=True)

    for token in tokens:
        # 1. 접미사(XSN) 처리: 앞 단어에 붙임 (예: 생성+형 -> 생성형)
        if token.tag == "XSN":
            if results:
                results[-1] += token.form
            continue

        # 2. 범용적인 태그 허용 정책
        # NNG(일반명사), NNP(고유명사), NR(수사), NP(대명사)
        # SL(외국어), SN(숫자), SH(한자)
        if token.tag in ["NNG", "NNP", "NR", "NP", "SL", "SN", "SH"]:
            # 3. 1글자 필터링 로직
            # - 영어(SL), 숫자(SN), 한자(SH)는 1글자라도 의미가 크므로 유지
            # - 한글 1글자 중 불용어만 제외
            if (
                token.tag not in ["SL", "SN", "SH"]
                and len(token.form) == 1
                and token.form in ["것", "수", "등", "때", "곳"]
            ):
                continue

            results.append(token.form)

    return " ".join(results)
